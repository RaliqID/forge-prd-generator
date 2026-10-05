import { MOCK_PRD_CONTENT } from '@/lib/mock-data';
import { PRD_SECTIONS } from '@/types';
import { buildSystemPrompt, buildUserPrompt, buildUserPromptFromStructure, getFewShotExamples } from '@/lib/ai/prompts';
import { buildEngineCandidates, type ResolvedEngineCandidate } from '@/lib/ai/engine-candidates';
import { prisma } from '@/lib/db/prisma';
import {
  openProviderStream,
  parseTokenStream,
  parseAnthropicStream,
} from '@/lib/ai/providers';
import { getAuthUser } from '@/lib/auth/get-auth-user';
import { isUuid } from '@/lib/is-uuid';
import { buildHeadingIndex, matchHeading, headingTextOf } from '@/lib/ai/heading-matcher';
import { parseBody, prdGenerateSchema } from '@/lib/validation/schemas';
import { requestLogger } from '@/lib/logger';
import type { Prisma } from '@prisma/client';
import type { StreamChunk } from '@/lib/ai/providers';
import type { PRDFormInput, PlanStructure, PRDSectionKey } from '@/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function sse(data: object) {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export async function POST(req: Request) {
  const user = await getAuthUser();
  if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  // Validate before anything else: a malformed payload must fail fast with a
  // named field, not a stack trace from deep inside a prompt builder.
  const parsed = await parseBody(req, prdGenerateSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const encoder = new TextEncoder();
  const log = requestLogger(req, '/api/prd/generate');
  const modelId = body.model_id ?? '9router-auto';
  const input = body.input as PRDFormInput | undefined;
  // Struktur → PRD flow: PRD grounded in a reviewed feature structure.
  const structure = body.structure as PlanStructure | undefined;
  const idea = body.idea ?? '';

  // Batched generation: client requests a subset of sections per invocation,
  // passing previously-generated sections as consistency context.
  const validKeys = new Set<PRDSectionKey>(PRD_SECTIONS.map((s) => s.key));
  const rawSections = body.sections ?? [];
  const requestedSet = new Set(
    rawSections.filter((s): s is PRDSectionKey => validKeys.has(s as PRDSectionKey))
  );
  // Keep PRD_SECTIONS order; empty/none → all 17.
  const sections: PRDSectionKey[] = requestedSet.size > 0
    ? PRD_SECTIONS.filter((s) => requestedSet.has(s.key)).map((s) => s.key)
    : PRD_SECTIONS.map((s) => s.key);

  const PREVIOUS_CAP = 1500;
  const previous: Partial<Record<PRDSectionKey, string>> = {};
  for (const [key, val] of Object.entries(body.previous ?? {})) {
    if (validKeys.has(key as PRDSectionKey) && typeof val === 'string') {
      previous[key as PRDSectionKey] = val.slice(0, PREVIOUS_CAP);
    }
  }

  // Custom engine: saved engines are resolved + decrypted server-side from
  // `engine_id`. An explicit base_url+api_key pair (ad-hoc) still works but is
  // SSRF-guarded. User-configured engine wins — built-ins stay as failover.
  const rawBody = body as unknown as Record<string, unknown>;
  const resolved = await buildEngineCandidates(user.id, {
    model_id: modelId,
    engine_id: body.engine_id,
    base_url: rawBody.base_url as string | undefined,
    api_key: rawBody.api_key as string | undefined,
    compat: rawBody.compat as string | undefined,
  });
  if (!resolved.ok) {
    return new Response(JSON.stringify({ error: resolved.error }), { status: 400 });
  }
  const candidates = resolved.candidates;
  const useRealAI = Boolean(candidates.length > 0 && (input || structure));
  // The user asked for a real generation but no provider/key is configured.
  // Falling through to mock content here is indistinguishable from success in
  // the UI, so say so explicitly instead.
  const noProviderConfigured = candidates.length === 0 && Boolean(input || structure);

  // ── Server-side persistence ──
  // Create (or attach to) the PRD row BEFORE streaming so a client disconnect
  // can't lose finished sections. A multi-request flow (the workspace generates
  // in section groups) passes the row id back via `prd_id` so all groups
  // update ONE row instead of creating one row per request.
  let prdRowId: string | null = null;
  const contentAcc: Partial<Record<PRDSectionKey, string>> = {};
  // Keys this request regenerates: their seed from the existing row is
  // intentionally skipped so fresh stream content REPLACES (never appends to)
  // the old value.
  const requestedKeys = new Set(sections);
  if (useRealAI) {
    try {
      const rawPrdId = typeof body.prd_id === 'string' ? body.prd_id : null;
      const requestedId = isUuid(rawPrdId) ? rawPrdId : null;
      if (requestedId) {
        // Ownership-scoped attach; a foreign/missing id is ignored (create below).
        const owned = await prisma.pRD.findFirst({
          where: { id: requestedId, userId: user.id },
          select: { id: true, content: true },
        });
        if (owned) {
          prdRowId = owned.id;
          if (owned.content && typeof owned.content === 'object' && !Array.isArray(owned.content)) {
            for (const [k, v] of Object.entries(owned.content as Record<string, unknown>)) {
              if (validKeys.has(k as PRDSectionKey) && typeof v === 'string' && !requestedKeys.has(k as PRDSectionKey)) {
                contentAcc[k as PRDSectionKey] = v;
              }
            }
          }
        }
      }
      if (!prdRowId) {
        const title =
          input?.product_name?.trim() ||
          structure?.root?.title?.trim() ||
          idea.trim().slice(0, 80) ||
          'PRD Baru';
        const created = await prisma.pRD.create({
          data: {
            userId: user.id,
            title,
            status: 'generating',
            content: {},
            idea: idea || null,
            structure: (structure ?? undefined) as Prisma.InputJsonValue | undefined,
            modelUsed: modelId,
          },
          select: { id: true },
        });
        prdRowId = created.id;
      }
    } catch (err) {
      // Persistence is best-effort: the stream still works, and the client's
      // own save-to-DB flow (POST /api/prd) remains the fallback.
      log.error('could not init PRD row - continuing without server persistence', { err });
      prdRowId = null;
    }
  }

  /** Merge the accumulated sections into the row. Never throws. */
  const persistContent = async (status: 'generating' | 'completed' | 'failed') => {
    if (!prdRowId) return;
    try {
      // Read-modify-write: the workspace flow generates in groups, so an
      // earlier request may have completed sections this request knows nothing
      // about. Non-empty accumulated values win; empty/missing keys keep
      // whatever is already stored — a 'failed' persist can never wipe
      // completed sections (observed regression: 13/17 done → row emptied).
      const row = await prisma.pRD.findUnique({
        where: { id: prdRowId },
        select: { content: true },
      });
      const existing =
        row?.content && typeof row.content === 'object' && !Array.isArray(row.content)
          ? (row.content as Record<string, unknown>)
          : {};
      const merged: Record<string, string> = {};
      // Union of keys this request knows about AND keys already stored — the
      // workspace flow spans MULTIPLE requests, so an earlier group's sections
      // live in `existing` but not in validKeys. Iterating validKeys alone
      // dropped them from the write (observed: 12 completed sections wiped by
      // a later group's persist). Both-empty keys are omitted (no ghosts).
      const allKeys = new Set<string>([...validKeys, ...Object.keys(existing)]);
      for (const key of allKeys) {
        const nextVal = contentAcc[key as PRDSectionKey];
        const prevVal = existing[key];
        if (typeof nextVal === 'string' && nextVal.trim().length > 0) {
          merged[key] = nextVal;
        } else if (typeof prevVal === 'string' && prevVal.trim().length > 0) {
          merged[key] = prevVal;
        }
      }
      // Never downgrade: a merged write may ALREADY hold every section (e.g.
      // the client disconnect races the 'completed' persist — observed: poll
      // read 'completed', the abort handler then wrote 'failed' over 17/17
      // content). Complete content is the source of truth, not the signal.
      const finalStatus = PRD_SECTIONS.every((s) => (merged[s.key] ?? '').trim().length > 0)
        ? 'completed'
        : status;
      await prisma.pRD.update({
        where: { id: prdRowId },
        data: { content: merged as Prisma.InputJsonValue, status: finalStatus },
      });
    } catch (err) {
      log.error('persist failed', { status, prdRowId, err });
    }
  };

  const stream = new ReadableStream({
    async start(controller) {
      const prdId = prdRowId ?? `prd-${Date.now()}`;
      const startedAt = Date.now();

      try {
        if (useRealAI) {
          await streamRealAI(controller, encoder, candidates, { input, structure, idea }, prdId, sections, previous, req.signal, user.id, contentAcc, persistContent);
        } else if (noProviderConfigured) {
          controller.enqueue(
            encoder.encode(
              sse({
                type: 'error',
                message:
                  'Tidak ada provider AI yang aktif. Isi NINE_ROUTER_API_KEY (dan NINE_ROUTER_BASE_URL) di .env.local, lalu restart dev server — atau pilih custom engine di halaman Engine.',
              })
            )
          );
        } else {
          await streamMock(controller, encoder, prdId);
        }
        // One success line per completed request, with the numbers that matter
        // for watching cost and latency (which provider answered, how long).
        log.info('generation complete', {
          elapsedSec: Math.round((Date.now() - startedAt) / 1000),
          sections: sections.length,
          provider: candidates[0]?.provider.id ?? 'mock',
          model: candidates[0]?.modelString ?? null,
          persisted: Boolean(prdRowId),
        });
      } catch (err) {
        // Mark the row failed but keep whatever sections finished — the
        // workspace resume flow re-generates only the missing ones. Awaited
        // (not fire-and-forget) so the write lands before the function ends.
        await persistContent('failed');
        // A silent-stream failure used to leave the function logs empty, which
        // made it impossible to diagnose. Log the elapsed time, the requested
        // sections and the model so the line pins down what was attempted.
        const elapsed = Math.round((Date.now() - startedAt) / 1000);
        log.error('generation failed', { elapsedSec: elapsed, sections: sections.join(','), modelId, err });
        controller.enqueue(
          encoder.encode(
            sse({ type: 'error', message: err instanceof Error ? err.message : 'Unknown error' })
          )
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

// ── Real AI streaming ──
type ProviderCandidate = ResolvedEngineCandidate;

async function streamRealAI(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  candidates: ProviderCandidate[],
  source: { input?: PRDFormInput; structure?: PlanStructure; idea?: string },
  prdId: string,
  sections: PRDSectionKey[],
  previous: Partial<Record<PRDSectionKey, string>>,
  clientSignal?: AbortSignal,
  userId?: string,
  contentAcc?: Partial<Record<PRDSectionKey, string>>,
  persistContent?: (status: 'generating' | 'completed' | 'failed') => Promise<void>,
) {
  // Self-improvement: inject excerpts from the user's OWN completed PRDs as
  // few-shot examples (owner-scoped — never other users' content).
  const fewShotExamples = await getFewShotExamples(userId ?? null, 2);
  const systemPrompt = buildSystemPrompt(fewShotExamples, sections, previous);
  const userPrompt = source.structure
    ? buildUserPromptFromStructure(source.idea ?? '', source.structure)
    : buildUserPrompt(source.input!);

  let lastError: unknown = null;

  // Section enforcement: the model must emit ONLY the requested sections.
  // Spilling into other sections corrupts parallel per-section requests.
  const allowedKeys = new Set<PRDSectionKey>(sections);

  // Request-wide deadline: abort a hung/slow provider before the server's hard
  // kill so the outer catch can emit a clean SSE error. Vercel caps at 300s
  // (maxDuration) — locally there is no cap, so reasoning proxies that buffer
  // whole sections benefit from a longer window. Env-tunable.
  const deadline = Date.now() + (Number(process.env.AI_STREAM_DEADLINE_MS) || 280_000);
  // No-activity timeout: some proxies accept a streaming request then never
  // send a chunk. Reasoning models can also go quiet while thinking upstream,
  // and some proxy upstreams buffer the whole SSE body before the first byte —
  // 90s killed healthy-but-buffered requests that completed at ~170s. Default
  // is higher and env-tunable.
  const INACTIVITY_MS = Number(process.env.AI_STREAM_INACTIVITY_MS) || 200_000;
  let stalled = false;

  // Two passes: a stalled attempt earns ONE retry because streaming proxies
  // rotate upstreams per connection — a fresh fetch often lands on a healthier
  // path. A zero-content close ("Provider menutup koneksi tanpa konten")
  // deserves the same second pass: the connection, not the model, failed.
  // Non-retryable failures keep single-pass failover semantics.
  let emptyRetry = false;
  const attempts = candidates.length > 0 ? [...candidates, ...candidates] : candidates;
  for (let ai = 0; ai < attempts.length; ai++) {
    const cand = attempts[ai];
    // Out of time — don't start another candidate.
    if (Date.now() >= deadline) break;
    if (ai >= candidates.length && (!(stalled || emptyRetry) || Date.now() >= deadline - 30_000)) break;
    stalled = false;

    // Abort controller per attempt: kill the provider request if the client
    // disconnects or this attempt fails, so the model stops consuming tokens.
    const attempt = new AbortController();
    const onClientAbort = () => attempt.abort();
    clientSignal?.addEventListener('abort', onClientAbort, { once: true });
    const timer = setTimeout(() => attempt.abort('timeout'), Math.max(0, deadline - Date.now()));
    let inactivity: ReturnType<typeof setTimeout> | undefined;
    const touch = () => {
      clearTimeout(inactivity);
      inactivity = setTimeout(() => {
        stalled = true;
        attempt.abort('timeout');
      }, INACTIVITY_MS);
    };

    // Snapshot the accumulator so a failed attempt's PARTIAL writes can be
    // rolled back before the next try — otherwise a stall-retry appends the
    // same section twice into contentAcc (and the client, which resets a
    // section on section_start, would diverge from the server).
    const accSnapshot = contentAcc ? { ...contentAcc } : undefined;

    try {
      const res = await openProviderStream({
        provider: cand.provider,
        apiKey: cand.apiKey,
        modelString: cand.modelString,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        signal: attempt.signal,
        // Retry pass doubles the budget: reasoning models spend most of it
        // thinking, and a content-empty finish at length is a token-budget
        // failure, not a model failure.
        maxTokens: ai >= candidates.length ? 32_000 : 16_000,
      });
      touch();
      const tokenStream: AsyncGenerator<StreamChunk> =
        cand.provider.format === 'anthropic'
          ? parseAnthropicStream(res, attempt.signal)
          : parseTokenStream(res, attempt.signal);

      await streamTokens(controller, encoder, tokenStream, prdId, touch, allowedKeys, () => attempt.abort(), contentAcc, async () => {
        // Completed only when ALL 17 sections hold content — a workspace flow
        // generates in groups, and its final persist() also flips the status.
        if (!persistContent) return;
        const allFilled = contentAcc
          ? PRD_SECTIONS.every((s) => (contentAcc[s.key] ?? '').trim().length > 0)
          : false;
        await persistContent(allFilled ? 'completed' : 'generating');
      });
      return;
    } catch (err) {
      lastError = err;
      // Roll back this attempt's partial accumulator writes (see snapshot).
      if (accSnapshot) {
        for (const k of Object.keys(contentAcc!) as PRDSectionKey[]) {
          const snapVal = accSnapshot[k];
          if (snapVal === undefined) delete contentAcc![k];
          else contentAcc![k] = snapVal;
        }
      }
      // Silent-empty close marks this attempt as retry-eligible.
      if (err instanceof Error && /tanpa konten/i.test(err.message)) emptyRetry = true;
      // Abort this attempt (stops the model on the provider side), then try the next provider.
      attempt.abort();
    } finally {
      clearTimeout(timer);
      clearTimeout(inactivity);
      clientSignal?.removeEventListener('abort', onClientAbort);
      attempt.abort();
    }
  }

  if (stalled) {
    throw new Error(
      `Model tidak merespons — tidak ada token selama ${INACTIVITY_MS / 1000} detik. Coba lagi atau ganti model.`
    );
  }
  // Prefer a real HTTP/provider error message over the generic abort text — a
  // clean 530/429/5xx reason (from describeHttpError) is more useful than
  // "operation aborted" when the provider rejected us fast.
  if (lastError instanceof Error) {
    if (/rate limit|provider|HTTP \d|API key|endpoint/i.test(lastError.message)) {
      throw lastError;
    }
    // Map opaque abort errors to a user-readable timeout message.
    if (/abort/i.test(lastError.message)) {
      throw new Error('Model terlalu lambat — coba lagi atau pakai model lebih cepat.');
    }
  }
  throw lastError ?? new Error('No AI provider available');
}

// Stream tokens and detect section boundaries by watching for ## headings.
// Thinking chunks (reasoning models) become a throttled "thinking" event so the
// client can show a live indicator instead of looking frozen.
// `touch` resets the caller's no-activity timer on every chunk.
//
// Section enforcement (`allowedKeys` + `onStop`):
// - Anything before the first ALLOWED heading is buffered and discarded — models
//   often open with deliberation/meta-commentary. If no allowed heading ever
//   arrives the buffer is flushed instead, so headingless output isn't lost.
// - A heading for a known-but-NOT-requested section ends the current section and
//   stops the stream: the model has spilled into another request's territory,
//   and keeping those tokens would corrupt parallel per-section requests.
async function streamTokens(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  tokenStream: AsyncGenerator<StreamChunk>,
  prdId: string,
  touch: () => void = () => {},
  allowedKeys?: Set<PRDSectionKey>,
  onStop: () => void = () => {},
  contentAcc?: Partial<Record<PRDSectionKey, string>>,
  /** Awaited BEFORE the done event — the DB write must land before the
   *  client navigates to / reloads the persisted row. */
  onComplete?: () => Promise<void>,
) {
  let currentSection: string | null = null;
  let lineBuffer = '';
  let lastThinkingEmit = 0;
  // Guards a one-time <think> tag strip at the very start of the content.
  let sawContent = false;
  const THINKING_THROTTLE_MS = 2000;
  // Lines seen before the first allowed heading — discarded once one arrives,
  // flushed as content if the stream ends without any.
  let preambleBuffer = '';
  const PREAMBLE_CAP = 8000;
  // Set when a non-requested section heading forces an early stop.
  let stopped = false;
  // Chars of real content emitted THIS attempt (tokens + tail flushes). Zero
  // at stream end means the upstream closed silent-empty → throw so the
  // caller's retry pass engages instead of "succeeding" with nothing.
  let emittedChars = 0;

  const isAllowed = (key: PRDSectionKey) => !allowedKeys || allowedKeys.has(key);

  // Heading matcher lives in its own module (unit-tested): it must tolerate the
  // numbering/punctuation variants models produce, or no section ever starts
  // and the whole PRD comes back empty. See src/lib/ai/heading-matcher.ts.
  const titleToKey = buildHeadingIndex();

  outer: for await (const chunk of tokenStream) {
    touch();
    if (chunk.kind === 'thinking') {
      const now = Date.now();
      if (now - lastThinkingEmit >= THINKING_THROTTLE_MS) {
        lastThinkingEmit = now;
        controller.enqueue(encoder.encode(sse({ type: 'thinking' })));
      }
      continue;
    }

    // Some models leak reasoning as literal <think>…</think> tags in the
    // content stream. Strip them before section parsing so they never reach
    // the document. `sawContent` gates the cheap open-tag scan to the start.
    let text = chunk.text;
    if (!sawContent) {
      text = text.replace(/<\/?think>/gi, '');
      if (text.trim().length > 0) sawContent = true;
    }
    if (!text) continue;

    // Buffer tokens and only emit complete lines.
    // This prevents double-emission: a token would otherwise be sent immediately
    // AND again as part of a flushed line when the next '\n' arrives.
    lineBuffer += text;

    while (lineBuffer.includes('\n')) {
      const nlIdx = lineBuffer.indexOf('\n');
      const line = lineBuffer.slice(0, nlIdx);
      lineBuffer = lineBuffer.slice(nlIdx + 1);

      const raw = line.trim();
      const heading = headingTextOf(raw);
      const matchedKey = heading ? matchHeading(titleToKey, heading) : undefined;

      // ── Preamble mode: nothing emitted until the first ALLOWED heading. ──
      if (currentSection === null) {
        if (matchedKey && isAllowed(matchedKey)) {
          // First real section — drop everything buffered before it.
          preambleBuffer = '';
          currentSection = matchedKey;
          controller.enqueue(encoder.encode(sse({ type: 'section_start', section: matchedKey })));
          continue;
        }
        // Buffer everything else (including non-requested headings).
        preambleBuffer += line + '\n';
        if (preambleBuffer.length > PREAMBLE_CAP) {
          // Non-compliant model rambling without ever starting a requested
          // section — stop rather than burn the whole deadline.
          preambleBuffer = '';
          stopped = true;
          onStop();
          break outer;
        }
        continue;
      }

      if (matchedKey) {
        if (!isAllowed(matchedKey)) {
          // Spilled into another request's section — close ours and stop.
          controller.enqueue(encoder.encode(sse({ type: 'section_end', section: currentSection })));
          currentSection = null;
          lineBuffer = '';
          stopped = true;
          onStop();
          break outer;
        }
        // Section boundary — emit section events, skip emitting the heading as content.
        controller.enqueue(encoder.encode(sse({ type: 'section_end', section: currentSection })));
        currentSection = matchedKey;
        controller.enqueue(encoder.encode(sse({ type: 'section_start', section: matchedKey })));
        continue;
      }

      // Regular content line — emit with the newline.
      controller.enqueue(encoder.encode(sse({ type: 'token', content: line + '\n' })));
      emittedChars += line.length + 1;
      if (contentAcc && currentSection) {
        const key = currentSection as PRDSectionKey;
        contentAcc[key] = (contentAcc[key] ?? '') + line + '\n';
      }
    }
  }

  if (!stopped) {
    // No allowed heading ever matched: the model wrote content without usable
    // headings. Flush the buffer so the work isn't lost (the client attributes
    // it to the requested section).
    if (currentSection === null && preambleBuffer) {
      controller.enqueue(encoder.encode(sse({ type: 'token', content: preambleBuffer })));
      emittedChars += preambleBuffer.length;
    }
    if (lineBuffer) {
      controller.enqueue(encoder.encode(sse({ type: 'token', content: lineBuffer })));
      emittedChars += lineBuffer.length;
    }
    if (currentSection) {
      controller.enqueue(encoder.encode(sse({ type: 'section_end', section: currentSection })));
    }
  }
  // Flush leftover buffers into the content store too (same attribution rules
  // as the client: headingless output goes to the first requested section).
  if (contentAcc) {
    if (currentSection) {
      const key = currentSection as PRDSectionKey;
      // preambleBuffer is always '' here (cleared at the first allowed
      // heading) — included for symmetry with the token flush above.
      const tail = preambleBuffer + lineBuffer;
      if (tail) contentAcc[key] = (contentAcc[key] ?? '') + tail;
    } else if (preambleBuffer || lineBuffer) {
      // Headingless flush — attribute to the first requested section so the
      // work isn't lost, mirroring the client's fallback attribution.
      const fallback = allowedKeys ? [...allowedKeys][0] : undefined;
      if (fallback) {
        contentAcc[fallback] = (contentAcc[fallback] ?? '') + preambleBuffer + lineBuffer;
      }
    }
  }
  // Silent-empty upstream: no heading, no tokens, nothing flushed. Throw so
  // the candidate loop's retry pass (with doubled max_tokens) engages — do
  // NOT throw when partial content arrived (resume handles incomplete
  // sections; only zero-content is retryable here).
  if (emittedChars === 0 && !stopped) {
    throw new Error('Provider menutup koneksi tanpa konten');
  }
  // Persist BEFORE announcing completion: the client navigates to / reloads
  // the row on this event, and the DB write must already be visible.
  if (onComplete) await onComplete();
  // `persisted` tells the client prd_id is a real DB row id (safe to PUT,
  // share, and reload). Fake ids (mock path) are 'prd-<timestamp>'.
  controller.enqueue(encoder.encode(sse({ type: 'done', prd_id: prdId, persisted: isUuid(prdId) })));
}

// ── Mock streaming (no API key configured) ──
async function streamMock(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  prdId: string
) {
  for (const section of PRD_SECTIONS) {
    controller.enqueue(encoder.encode(sse({ type: 'section_start', section: section.key })));

    const content = MOCK_PRD_CONTENT[section.key];
    const words = content.split(' ');

    for (let i = 0; i < words.length; i++) {
      const token = (i === 0 ? '' : ' ') + words[i];
      controller.enqueue(encoder.encode(sse({ type: 'token', content: token })));
      await new Promise((r) => setTimeout(r, 10 + Math.random() * 20));
    }

    controller.enqueue(encoder.encode(sse({ type: 'section_end', section: section.key })));
    await new Promise((r) => setTimeout(r, 100));
  }

  controller.enqueue(encoder.encode(sse({ type: 'done', prd_id: prdId, persisted: false })));
}
