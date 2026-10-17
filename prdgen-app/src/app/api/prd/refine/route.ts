import {
  openProviderStream,
  parseTokenStream,
  parseAnthropicStream,
} from '@/lib/ai/providers';
import { getAuthUser } from '@/lib/auth/get-auth-user';
import type { StreamChunk } from '@/lib/ai/providers';
import type { PRDSectionKey } from '@/types';
import { getFewShotExamples } from '@/lib/ai/prompts';
import { buildEngineCandidates, type ResolvedEngineCandidate } from '@/lib/ai/engine-candidates';
import { parseBody, refineSchema } from '@/lib/validation/schemas';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function sse(data: object) {
  return `data: ${JSON.stringify(data)}\n\n`;
}

function buildRefineSystemPrompt(): string {
  return `You are a PRD editor assistant. The user gives you a single PRD section in markdown and an instruction to refine it.

Rules:
- Rewrite ONLY the section provided. Output the complete revised section in markdown.
- Do not add commentary, preamble, or closing remarks. Output the section content only.
- Preserve the overall structure (headings/table IDs) unless the instruction asks to change them.
- Keep the same language as the input (Bahasa Indonesia).
- If a code block exists, keep fenced code blocks intact and tidy.
- Be specific and actionable — no vague suggestions; give concrete edits.`;
}

function buildAskSystemPrompt(): string {
  return `You are a helpful product assistant answering questions about a PRD.
The user gives you the PRD content as context and asks a question.

Rules:
- ANSWER the question conversationally. DO NOT rewrite, edit, or output a revised version of the document.
- You are read-only: your reply is shown in a chat, it never changes the document.
- Be concise, well-structured, and easy to read.
- Format your answer in clean GitHub-Flavored Markdown: use "- " bullets on their OWN lines (never inline), **bold** for emphasis, and blank lines between paragraphs and list items. Do NOT cram everything into one paragraph.
- NEVER output <think> tags or any internal reasoning — only the final answer.
- Keep the same language as the user (Bahasa Indonesia by default).
- If asked for suggestions, describe them briefly — do not produce a full rewritten section.`;
}

interface RefineRequest {
  model_id: string;
  section_key: PRDSectionKey;
  content: string;
  instruction: string;
  selection?: string;
  /** 'edit' rewrites the section (default); 'ask' just answers, no changes. */
  mode?: 'edit' | 'ask';
  /** Saved CustomEngine id — key resolved + decrypted server-side. */
  engine_id?: string;
  /** Ad-hoc (unsaved) engine — base_url is SSRF-guarded before use. */
  base_url?: string;
  api_key?: string;
  compat?: string;
}

export async function POST(req: Request) {
  const user = await getAuthUser();
  if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  const encoder = new TextEncoder();
  // Validate rather than blindly casting: a non-string `instruction` used to
  // reach the prompt builder and fail there, far from the actual cause.
  const parsed = await parseBody(req, refineSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data as Partial<RefineRequest>;
  const { model_id, section_key, content, instruction, selection, mode, engine_id, base_url, api_key, compat } = body;
  const isAsk = mode === 'ask';
  // Custom engine (saved → server-side key resolution; ad-hoc → SSRF guard)
  // wins — built-ins stay as failover.
  const resolved = model_id
    ? await buildEngineCandidates(user.id, { model_id, engine_id, base_url, api_key, compat })
    : ({ ok: true as const, candidates: [] as ResolvedEngineCandidate[] });
  if (!resolved.ok) {
    return new Response(JSON.stringify({ error: resolved.error }), { status: 400 });
  }
  const candidates = resolved.candidates;
  const useRealAI = Boolean(candidates.length > 0 && content && instruction);

  const stream = new ReadableStream({
    async start(controller) {
      const startedAt = Date.now();
      try {
        if (!useRealAI) {
          controller.enqueue(encoder.encode(sse({ type: 'error', message: 'Request tidak valid atau provider tidak tersedia.' })));
          return;
        }

        // Few-shot grounding from the user's OWN completed PRDs (owner-scoped).
        const examples = await getFewShotExamples(user.id, 1);
        const exCtx = examples.length > 0
          ? `\n\nReference PRD context (from a previously completed PRD titled "${examples[0].title}"):\n${examples[0].executive_summary}\n\nMaintain similar specificity and rigor.`
          : '';
        const systemPrompt = (isAsk ? buildAskSystemPrompt() : buildRefineSystemPrompt()) + exCtx;

        let lastError: unknown = null;
        // Request-wide deadline: abort a hung/slow provider before Vercel's
        // 300s hard kill so we can emit a clean error event.
        const deadline = Date.now() + (Number(process.env.AI_STREAM_DEADLINE_MS) || 280_000);
        // No-activity timeout: some proxies accept a streaming request then
        // never send a chunk. Abort fast instead of waiting out the deadline.
        const INACTIVITY_MS = Number(process.env.AI_STREAM_INACTIVITY_MS) || 200_000;
        let stalled = false;
        for (const cand of candidates) {
          // Out of time — don't start another candidate.
          if (Date.now() >= deadline) break;

          const attempt = new AbortController();
          const onClientAbort = () => attempt.abort();
          req.signal?.addEventListener('abort', onClientAbort, { once: true });
          const timer = setTimeout(() => attempt.abort('timeout'), Math.max(0, deadline - Date.now()));
          let inactivity: ReturnType<typeof setTimeout> | undefined;
          const touch = () => {
            clearTimeout(inactivity);
            inactivity = setTimeout(() => {
              stalled = true;
              attempt.abort('timeout');
            }, INACTIVITY_MS);
          };

          try {
            const msg = isAsk
              ? [
                  `Section: ${section_key}.`,
                  selection ? `\nBagian yang disorot user:\n> ${selection}\n` : '',
                  `\n--- ISI SECTION (konteks) ---\n${content}\n--- AKHIR SECTION ---`,
                  `\nPertanyaan user: ${instruction}`,
                  `\nJawab pertanyaan tanpa mengubah atau menulis ulang section.`,
                ].join('\n')
              : [
                  `Section key: ${section_key}.`,
                  selection ? `\nPerhatian khusus pada kutipan ini:\n> ${selection}\n` : '',
                  `\nInstruksi user: ${instruction}`,
                  `\n--- SECTION SAAT INI ---\n${content}\n--- AKHIR SECTION ---`,
                  `\nTulis ulang section ini mengikuti instruksi. Output hanya konten section.`,
                ].join('\n');

            const res = await openProviderStream({
              provider: cand.provider,
              apiKey: cand.apiKey,
              modelString: cand.modelString,
              messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: msg },
              ],
              signal: attempt.signal,
            });
            touch();

            const tokenStream: AsyncGenerator<StreamChunk> =
              cand.provider.format === 'anthropic'
                ? parseAnthropicStream(res, attempt.signal)
                : parseTokenStream(res, attempt.signal);

            // Strip any leaked <think>…</think> reasoning at the start of the
            // content stream before forwarding tokens to the client.
            let sawContent = false;
            for await (const chunk of tokenStream) {
              touch();
              if (chunk.kind === 'thinking') continue;
              let out = chunk.text;
              if (!sawContent) {
                out = out.replace(/<\/?think>/gi, '');
                if (out.trim().length > 0) sawContent = true;
              }
              if (!out) continue;
              controller.enqueue(encoder.encode(sse({ type: 'token', content: out })));
            }
            controller.enqueue(encoder.encode(sse({ type: 'done' })));
            return;
          } catch (err) {
            lastError = err;
            attempt.abort();
          } finally {
            clearTimeout(timer);
            clearTimeout(inactivity);
            req.signal?.removeEventListener('abort', onClientAbort);
            attempt.abort();
          }
        }

        if (stalled) {
          throw new Error(
            `Model tidak merespons — tidak ada token selama ${INACTIVITY_MS / 1000} detik. Coba lagi atau ganti model.`
          );
        }
        // Map opaque abort errors to a user-readable timeout message.
        if (lastError instanceof Error && /abort/i.test(lastError.message)) {
          throw new Error('Model terlalu lambat — coba lagi atau pakai model lebih cepat.');
        }
        throw lastError ?? new Error('No AI provider available');
      } catch (err) {
        // Log server-side so silent-stream failures are diagnosable in Vercel logs.
        const elapsed = Math.round((Date.now() - startedAt) / 1000);
        console.error(`[prd/refine] failed after ${elapsed}s (section: ${section_key}, mode: ${isAsk ? 'ask' : 'edit'}):`, err);
        controller.enqueue(
          encoder.encode(sse({ type: 'error', message: err instanceof Error ? err.message : 'Unknown error' }))
        );
      } finally {
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
