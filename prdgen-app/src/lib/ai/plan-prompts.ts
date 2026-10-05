import type { PlanStructure } from '@/types';

/**
 * Prompts for the Struktur → PRD → Task workspace flow.
 *
 * Structure and Task phases ask the model to emit a single fenced ```json block.
 * The API route streams raw tokens for a live "thinking" feel, then parses the
 * final JSON once the stream completes.
 */

// ── Struktur phase ──

export function buildStructureSystemPrompt(): string {
  return `You are a Principal Product Manager + Staff Software Architect. Given a short product idea in natural language, you break it down into a structured, COMPLETE project plan (a feature mindmap) that a team could actually build from.

Output ONLY a single fenced code block tagged \`json\` — no prose before or after. The JSON MUST match this exact shape:

\`\`\`json
{
  "root": {
    "title": "<short project name, max 6 words>"
  },
  "features": [
    {
      "id": "<kebab-case-id>",
      "name": "<feature name>",
      "phase": <integer 1-3, delivery phase; core features are phase 1>,
      "subFeatures": [
        { "id": "<kebab-case-id>", "name": "<sub-feature name>" }
      ],
      "tasks": []
    }
  ]
}
\`\`\`

Think first (do not output the reasoning): infer the product's domain and its implied needs. Then design a plan that covers not just the obvious core loop but also the dimensions teams forget.

Rules:
- NAMES ONLY. Emit no descriptions, no overview, no architecture — implementation detail belongs to a later phase. Every field not in the shape above must be omitted.
- Because names stand alone with no description, each "name" MUST be self-explanatory and specific, 2-6 words (e.g. "Autentikasi & Verifikasi Email", not "Auth").
- Produce 5-8 top-level features, ordered by delivery phase (phase 1 = core MVP first).
- Each feature has 2-5 sub-features.
- COMPLETENESS: beyond the core features, include (as features or sub-features) the cross-cutting concerns that apply to this product. Consider and include where relevant: authentication & account management (incl. email verification, password reset), onboarding/first-run & empty states, notifications, content moderation/safety (if user- or AI-generated content), analytics & observability (how success is measured), admin/back-office, data privacy & compliance (export, deletion/consent), internationalization (if multi-language), billing/monetization & cost control (if cost or revenue is implied), and testing/deployment (CI-CD, environments). Only include what genuinely fits THIS product — don't pad with irrelevant items, but don't omit an obviously-needed dimension either.
- Do NOT invent specific vendor names or prices as decided facts; keep features capability-level.
- Leave every "tasks" array EMPTY — tasks are generated in a later phase.
- Use kebab-case ids, unique across the whole document.
- Write every "title"/"name" in the SAME language as the user's idea (default Bahasa Indonesia).
- Do NOT wrap the JSON in extra commentary. The code block is the entire response.`;
}

export function buildStructureUserPrompt(idea: string): string {
  return `Produk / ide:\n\n${idea.trim()}\n\nBreakdown ide ini menjadi struktur fitur berjenjang sesuai format JSON yang diminta.`;
}

// ── Task phase ──

export function buildTaskSystemPrompt(): string {
  return `You are a senior engineer turning a feature plan into a granular, buildable task list for an AI coding agent.

Output ONLY a single fenced code block tagged \`json\` — no prose. Shape:

\`\`\`json
{
  "features": [
    {
      "id": "<existing feature id from the structure>",
      "tasks": [
        { "id": "<kebab-case-id>", "title": "<imperative task title>", "description": "<1-2 sentences: what to build and the acceptance signal>", "done": false }
      ]
    }
  ]
}
\`\`\`

Rules:
- Generate tasks for EVERY feature id given in the structure. Reuse the exact ids.
- 3-6 tasks per feature, small enough to complete in one focused session, ordered by build sequence.
- Task ids must be unique across the whole document (kebab-case).
- Every task starts with "done": false.
- Write titles/descriptions in the SAME language as the structure (default Bahasa Indonesia).
- The code block is the entire response.`;
}

export function buildTaskUserPrompt(structure: PlanStructure): string {
  const featureLines = structure.features
    .map((f) => {
      const subs = f.subFeatures
        .map((s) => `    - ${s.name}${s.description ? `: ${s.description}` : ''}`)
        .join('\n');
      return `- [${f.id}] ${f.name} (fase ${f.phase})${f.description ? `: ${f.description}` : ''}\n${subs}`;
    })
    .join('\n');

  // Overview/architecture only exist on older saved structures — include when present.
  const overview = structure.root.overview?.trim() ? `\n${structure.root.overview}` : '';
  const architecture = structure.root.architecture?.trim()
    ? `\n\nArsitektur:\n${structure.root.architecture}`
    : '';

  return `Konteks proyek: ${structure.root.title}${overview}${architecture}\n\nFitur:\n${featureLines}\n\nBuat daftar task per fitur mengikuti format JSON yang diminta.`;
}

// ── JSON extraction ──

/**
 * Scan for the first BALANCED `{...}` span, ignoring braces inside strings.
 *
 * A plain indexOf('{')/lastIndexOf('}') slice breaks whenever the model wraps
 * its payload in prose that itself contains braces, or emits tool-call markup
 * around the object — the slice then spans multiple candidate objects and no
 * single JSON.parse succeeds. Walking the string and tracking depth (with
 * string/escape awareness) yields the first self-contained object instead.
 * Returns null when no balanced object is found.
 */
function firstBalancedObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { if (inString) escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Pull a JSON object out of a model response that may wrap it in a ```json
 * fence or surround it with prose. Returns null if nothing parses.
 */
export function extractJson<T = unknown>(raw: string): T | null {
  if (!raw) return null;

  // Prefer a fenced ```json ... ``` block (most common, most reliable).
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const sources = fenceMatch ? [fenceMatch[1], raw] : [raw];

  for (const source of sources) {
    // Try the whole trimmed span first (fast path for a clean payload).
    const trimmed = source.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        return JSON.parse(trimmed) as T;
      } catch {
        // fall through to the balanced scan
      }
    }
    const balanced = firstBalancedObject(source);
    if (balanced) {
      try {
        return JSON.parse(balanced) as T;
      } catch {
        // continue to the next source
      }
    }
  }
  return null;
}

/**
 * Heuristic: did the model answer a JSON-contract prompt with something that is
 * NOT JSON — prose, clarifying questions, or agent tool-call markup?
 *
 * Used to turn a confusing "invalid structure" into an actionable message. A
 * combo/router alias is the usual culprit: its upstreams are coding agents that
 * try to run a command instead of emitting the requested object.
 */
export function looksLikeNonJsonAnswer(raw: string): boolean {
  if (!raw) return false;
  const head = raw.slice(0, 600);

  // Only the OPENING fence counts. A valid ```json block has a closing fence
  // too, and "```" followed by nothing looks identical to a bare bash fence —
  // matching on any fence flagged every correct payload as a refusal.
  const firstFence = head.match(/```([A-Za-z0-9_-]*)/);
  const opensNonJsonFence = Boolean(firstFence && firstFence[1].toLowerCase() !== 'json');

  return (
    /DSML|invoke name|<\/?tool|function_call|antml:/i.test(raw) ||
    /^[\s\S]{0,40}(I'?ll|I will|Let me|Sure|Baik|Tentu|Noted|Here'?s how|Saya)/i.test(head) ||
    /\?{1,2}\s*$/m.test(head) || // ends a line with a question — asking the user
    opensNonJsonFence // e.g. ```bash ... — the model wrote code, not JSON
  );
}
