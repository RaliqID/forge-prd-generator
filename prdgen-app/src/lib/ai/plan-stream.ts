import {
  buildProviderCandidates,
  openProviderStream,
  parseTokenStream,
  parseAnthropicStream,
  resolveStructuredModel,
} from '@/lib/ai/providers';
import type { StreamChunk } from '@/lib/ai/providers';
import { buildEngineCandidates, type EngineRequestBody, type EngineCandidatesResult } from '@/lib/ai/engine-candidates';

export function sse(data: object) {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export type PlanRequestBody = EngineRequestBody;

/**
 * Build the ordered provider candidates for a plan request, honoring a
 * user-configured custom engine (which wins over built-ins). Keys are
 * resolved + decrypted server-side from the saved engine row.
 * Returns `{ ok: false, error }` when the request must be rejected (400).
 */
export async function planCandidates(
  userId: string,
  body: PlanRequestBody
): Promise<EngineCandidatesResult> {
  const modelId = body.model_id ?? '';
  if (!modelId) return { ok: true, candidates: [] };

  const resolved = await buildEngineCandidates(userId, body);
  if (!resolved.ok) return resolved;

  // The Struktur/Task phases emit a strict JSON document. A combo/auto alias
  // (e.g. 9Router's `Dev-Stack`) round-robins to coding-agent upstreams that
  // answer with tool calls or prose instead of JSON, which produced an empty
  // feature map and a retry storm. Point the built-in 9Router candidate at an
  // explicit instruct model for these phases; a user-supplied custom engine is
  // left exactly as configured.
  return {
    ok: true,
    candidates: resolved.candidates.map((c) =>
      c.provider.id === '9router' ? { ...c, modelString: resolveStructuredModel() } : c
    ),
  };
}

type Candidate = ReturnType<typeof buildProviderCandidates>[number];

/**
 * Run a system+user prompt against the first working provider candidate,
 * forwarding raw tokens to `onToken` and thinking pings to `onThinking`.
 * Returns the fully accumulated text. Throws if every candidate fails.
 */
export async function runPlanStream(params: {
  candidates: Candidate[];
  system: string;
  user: string;
  clientSignal?: AbortSignal;
  onToken: (text: string) => void;
  onThinking: () => void;
}): Promise<string> {
  const { candidates, system, user, clientSignal, onToken, onThinking } = params;
  let lastError: unknown = null;

  // Request-wide deadline: abort a hung/slow provider well before Vercel's
  // 300s hard kill so we can emit a clean error instead of a silent timeout.
  const deadline = Date.now() + (Number(process.env.AI_STREAM_DEADLINE_MS) || 280_000);
  // No-activity timeout: some proxies accept a streaming request then never
  // send a chunk. Abort fast instead of burning the whole deadline in silence.
  const INACTIVITY_MS = Number(process.env.AI_STREAM_INACTIVITY_MS) || 200_000;
  let stalled = false;

  for (const cand of candidates) {
    // Out of time — don't start another candidate; surface the last error.
    if (Date.now() >= deadline) {
      throw lastError ?? new Error('Model terlalu lambat — request timeout.');
    }

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

    try {
      const res = await openProviderStream({
        provider: cand.provider,
        apiKey: cand.apiKey,
        modelString: cand.modelString,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        signal: attempt.signal,
        // These phases want a JSON document, not deliberation. Reasoning costs
        // latency and, on reasoning-heavy routes, ends with the budget spent
        // and a prose/tool-call answer instead of the object. Measured ~6s and
        // valid JSON with reasoning off.
        reasoning: 'off',
        // A structure/task payload is small; a big cap only invites the model
        // to keep talking. 6k comfortably fits 8-10 features with sub-features.
        maxTokens: 6000,
      });
      touch();

      const tokenStream: AsyncGenerator<StreamChunk> =
        cand.provider.format === 'anthropic'
          ? parseAnthropicStream(res, attempt.signal)
          : parseTokenStream(res, attempt.signal);

      let acc = '';
      for await (const chunk of tokenStream) {
        touch();
        if (chunk.kind === 'thinking') {
          onThinking();
          continue;
        }
        acc += chunk.text;
        onToken(chunk.text);
      }
      return acc;
    } catch (err) {
      lastError = err;
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
  throw lastError ?? new Error('No AI provider available');
}
