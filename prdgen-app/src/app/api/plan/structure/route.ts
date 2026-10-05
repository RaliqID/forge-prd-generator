import {
  buildStructureSystemPrompt,
  buildStructureUserPrompt,
  extractJson,
  looksLikeNonJsonAnswer,
} from '@/lib/ai/plan-prompts';
import { planCandidates, runPlanStream, sse, type PlanRequestBody } from '@/lib/ai/plan-stream';
import { getAuthUser } from '@/lib/auth/get-auth-user';
import { parseBody, planStructureRequestSchema } from '@/lib/validation/schemas';
import { requestLogger } from '@/lib/logger';
import type { PlanStructure } from '@/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const THINKING_THROTTLE_MS = 1500;

export async function POST(req: Request) {
  const user = await getAuthUser();
  if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  const parsed = await parseBody(req, planStructureRequestSchema);
  if (!parsed.ok) return parsed.response;

  const encoder = new TextEncoder();
  const log = requestLogger(req, '/api/plan/structure');
  const body = parsed.data as PlanRequestBody & { idea?: string };
  const idea = (body.idea ?? '').trim();

  const resolved = await planCandidates(user.id, body);
  if (!resolved.ok) {
    return new Response(JSON.stringify({ error: resolved.error }), { status: 400 });
  }
  const candidates = resolved.candidates;
  const canRun = Boolean(candidates.length > 0 && idea);

  const stream = new ReadableStream({
    async start(controller) {
      const startedAt = Date.now();
      let sawToken = false;
      try {
        if (!canRun) {
          controller.enqueue(
            encoder.encode(sse({ type: 'error', message: 'Ide kosong atau provider AI tidak tersedia.' }))
          );
          return;
        }

        let lastThinking = 0;
        const accText = await runPlanStream({
          candidates,
          system: buildStructureSystemPrompt(),
          user: buildStructureUserPrompt(idea),
          clientSignal: req.signal,
          onToken: (text) => {
            sawToken = true;
            controller.enqueue(encoder.encode(sse({ type: 'token', content: text })));
          },
          onThinking: () => {
            const now = Date.now();
            if (now - lastThinking >= THINKING_THROTTLE_MS) {
              lastThinking = now;
              controller.enqueue(encoder.encode(sse({ type: 'thinking' })));
            }
          },
        });

        const structure = extractJson<PlanStructure>(accText);
        if (!structure || !Array.isArray(structure.features)) {
          // Distinguish "the model refused the JSON contract" from "the JSON
          // was malformed" — the fix is different (change model vs retry), so
          // the message must say which happened.
          const refused = looksLikeNonJsonAnswer(accText);
          controller.enqueue(
            encoder.encode(
              sse({
                type: 'error',
                message: refused
                  ? 'Model menjawab dengan teks/tool-call, bukan JSON. Pakai model instruct (bukan alias combo/router) — set NINE_ROUTER_STRUCTURED_MODEL.'
                  : 'Model tidak mengembalikan struktur JSON yang valid.',
              })
            )
          );
          return;
        }

        // Normalize: ensure ids, empty task arrays, numeric phases. The structure
        // phase now emits names only, so overview/architecture/description
        // default to '' (older saved structures may still carry real values).
        structure.root = {
          title: structure.root?.title || 'Perencanaan',
          overview: structure.root?.overview ?? '',
          architecture: structure.root?.architecture ?? '',
        };
        structure.features = structure.features.map((f, i) => ({
          id: f.id || `feature-${i + 1}`,
          name: f.name ?? `Fitur ${i + 1}`,
          description: f.description ?? '',
          phase: Number(f.phase) || 1,
          subFeatures: Array.isArray(f.subFeatures)
            ? f.subFeatures.map((s, j) => ({
                id: s.id || `${f.id || `feature-${i + 1}`}-sub-${j + 1}`,
                name: s.name ?? '',
                description: s.description ?? '',
              }))
            : [],
          tasks: [],
        }));

        controller.enqueue(encoder.encode(sse({ type: 'structure', structure })));
        controller.enqueue(encoder.encode(sse({ type: 'done' })));
        log.info('structure complete', {
          elapsedSec: Math.round((Date.now() - startedAt) / 1000),
          features: structure.features.length,
          provider: candidates[0]?.provider.id ?? null,
          model: candidates[0]?.modelString ?? null,
        });
      } catch (err) {
        // A silent-stream failure used to leave the logs empty, which made it
        // impossible to diagnose. `tokensReceived` distinguishes "provider
        // returned nothing" from "provider returned something unparseable".
        const elapsed = Math.round((Date.now() - startedAt) / 1000);
        log.error('structure failed', { elapsedSec: elapsed, tokensReceived: sawToken, err });
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
