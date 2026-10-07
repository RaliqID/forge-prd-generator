import { z } from 'zod';
import {
  IDEA_MAX_CHARS,
  FIELD_MAX_CHARS,
  LABEL_MAX_CHARS,
  LIST_ITEM_MAX_CHARS,
  ID_MAX_CHARS,
  SECTION_CONTENT_MAX_CHARS,
  INSTRUCTION_MAX_CHARS,
  URL_MAX_CHARS,
  SECRET_MAX_CHARS,
  FEATURES_MAX,
  TECH_STACK_MAX,
  PLATFORM_MAX,
  SUB_FEATURES_MAX,
  PLAN_FEATURES_MAX,
  TASKS_MAX,
  SECTIONS_MAX,
} from './limits';

/**
 * Runtime validation for API request bodies.
 *
 * Why this exists: the routes previously read `await req.json()` and trusted
 * the shape. A client sending `{ input: { product_name: 'x' } }` for a PRD
 * request crashed deep inside `buildUserPrompt` with
 * "Cannot read properties of undefined (reading 'join')" — a 500 with a stack
 * trace and no hint that the payload was wrong. Validating at the edge turns
 * that class of bug into a 422 naming the field, and keeps every downstream
 * helper free to assume its input is well-formed.
 *
 * Schemas are intentionally strict about REQUIRED fields and permissive about
 * extras, so adding a field to a client is never a breaking change.
 *
 * Limits all come from ./limits so the numbers live in one place and carry
 * their sizing rationale. See that file for why the idea cap is ~50k words.
 */

// ── Shared primitives ──

/** A non-empty trimmed string. */
const nonEmpty = z.string().trim().min(1);

/**
 * A bounded string whose error names the field AND the limit in user terms.
 *
 * Zod's default ("Too big: expected string to have <=20000 characters") leaks
 * an implementation detail and reads like a crash. The custom message states
 * the cap in words as well as characters so a user pasting a long brief knows
 * the size and the reason, not just that it failed.
 */
function boundedText(max: number, maxWords: number, label: string) {
  return z
    .string()
    .max(
      max,
      `${label} terlalu panjang: maksimal ${max.toLocaleString('id-ID')} karakter (~${maxWords.toLocaleString('id-ID')} kata). Ringkas atau pecah menjadi beberapa bagian.`
    );
}

/** Prose field with the standard long-form cap. */
const longText = (label: string) =>
  boundedText(FIELD_MAX_CHARS, 3_300, label);

/** The free-text idea; the only field with the large ~50k-word budget. */
const ideaText = boundedText(IDEA_MAX_CHARS, 50_000, 'Ide');

/** Provider/model selector: '9router-auto', a model id, or a custom-engine ref. */
export const engineRequestSchema = z.object({
  model_id: z.string().trim().max(ID_MAX_CHARS).optional(),
  engine_id: z.string().trim().max(ID_MAX_CHARS).optional(),
  custom_engine_id: z.string().trim().max(ID_MAX_CHARS).optional(),
});

// ── PRD generation ──

export const prdFormInputSchema = z.object({
  product_name: nonEmpty.max(LABEL_MAX_CHARS),
  description: longText('Deskripsi').default(''),
  target_users: longText('Target users').default(''),
  problem_statement: longText('Problem statement').default(''),
  features: z
    .array(z.string().max(LIST_ITEM_MAX_CHARS))
    .max(FEATURES_MAX, `Terlalu banyak fitur: maksimal ${FEATURES_MAX}.`)
    .default([]),
  tech_stack: z
    .array(z.string().max(LIST_ITEM_MAX_CHARS))
    .max(TECH_STACK_MAX, `Terlalu banyak tech stack: maksimal ${TECH_STACK_MAX}.`)
    .default([]),
  project_type: z.enum(['mvp', 'full', 'feature']).catch('mvp'),
  timeline: z.string().max(LABEL_MAX_CHARS).default(''),
  platform: z
    .array(z.string().max(LIST_ITEM_MAX_CHARS))
    .max(PLATFORM_MAX, `Terlalu banyak platform: maksimal ${PLATFORM_MAX}.`)
    .default([]),
  additional_notes: longText('Catatan tambahan').default(''),
});

/** One branch of the optional feature map (from the Struktur phase). */
const planSubFeatureSchema = z.object({
  id: z.string().max(ID_MAX_CHARS).optional(),
  name: z.string().max(LABEL_MAX_CHARS).default(''),
  description: z.string().max(LIST_ITEM_MAX_CHARS).optional(),
});

const planFeatureSchema = z.object({
  id: z.string().max(ID_MAX_CHARS).optional(),
  name: z.string().max(LABEL_MAX_CHARS).default(''),
  description: z.string().max(LIST_ITEM_MAX_CHARS).optional(),
  phase: z.coerce.number().int().min(1).max(20).catch(1),
  subFeatures: z.array(planSubFeatureSchema).max(SUB_FEATURES_MAX).default([]),
  tasks: z.array(z.unknown()).max(TASKS_MAX).default([]),
});

export const planStructureSchema = z.object({
  root: z
    .object({
      title: z.string().max(LABEL_MAX_CHARS).default(''),
      overview: z.string().max(FIELD_MAX_CHARS).optional(),
      architecture: z.string().max(FIELD_MAX_CHARS).optional(),
    })
    .default({ title: '' }),
  features: z.array(planFeatureSchema).max(PLAN_FEATURES_MAX).default([]),
});

export const prdGenerateSchema = engineRequestSchema.extend({
  /** Free-text idea (used when no structured form is supplied). */
  idea: ideaText.optional(),
  /** Structured form input (preferred when present). */
  input: prdFormInputSchema.optional(),
  /** Feature map from the Struktur phase. */
  structure: planStructureSchema.optional(),
  /** Subset of sections to generate this request. */
  sections: z.array(z.string().max(ID_MAX_CHARS)).max(SECTIONS_MAX).optional(),
  /** Already-generated sections, for cross-section consistency. */
  previous: z.record(z.string(), z.string().max(SECTION_CONTENT_MAX_CHARS)).optional(),
  /** Existing PRD to append to / revise. */
  prd_id: z.string().max(ID_MAX_CHARS).optional(),
});

// ── Plan phases ──

export const planStructureRequestSchema = engineRequestSchema.extend({
  idea: ideaText.optional(),
});

export const planTasksRequestSchema = engineRequestSchema.extend({
  structure: planStructureSchema.optional(),
});

// ── Refine ──

export const refineSchema = engineRequestSchema.extend({
  prd_id: z.string().max(ID_MAX_CHARS).optional(),
  section: z.string().max(ID_MAX_CHARS).optional(),
  instruction: boundedText(INSTRUCTION_MAX_CHARS, 3_300, 'Instruksi'),
  content: z.string().max(SECTION_CONTENT_MAX_CHARS).optional(),
});

// ── Custom engines ──

export const customEngineSchema = z.object({
  name: nonEmpty.max(LABEL_MAX_CHARS),
  model: nonEmpty.max(ID_MAX_CHARS),
  base_url: nonEmpty.max(URL_MAX_CHARS),
  api_key: z.string().max(SECRET_MAX_CHARS).default(''),
  compat: z.enum(['openai', 'anthropic']).catch('openai'),
});

/**
 * Run a schema and, on failure, produce a compact, field-level message.
 *
 * Two kinds of issue exist and they need different rendering:
 *
 *  - A limit violation whose schema supplies a custom, user-facing message
 *    ("Ide terlalu panjang: maksimal …"). That message already explains
 *    everything, so it is shown alone.
 *  - A structural mismatch with Zod's built-in text ("Invalid input: expected
 *    array, received string"). That one names no field, so the path is
 *    prepended to make it actionable.
 *
 * Capped at 8 issues so a deeply invalid payload cannot produce a wall of text.
 */
export function formatIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 8)
    .map((issue) => {
      const path = issue.path.join('.') || '(root)';
      // The schema's own message is only recognisable as "written for a user"
      // by shape. Zod's built-ins all begin with a known prefix or a
      // lowercase type word; anything else came from our `.max(…, message)`.
      const looksBuiltIn =
        /^(Invalid input|Too (big|small)|Required|Expected|Unrecognized|String must|Number must|Array must|Invalid (enum|option)|Invalid date)/i.test(
          issue.message
        );
      return looksBuiltIn ? `${path}: ${issue.message}` : issue.message;
    })
    .join('; ');
}

/**
 * Parse a request body and return either the typed value or a ready-to-send
 * error Response (422 with the field list). Callers do:
 *
 *   const parsed = await parseBody(req, schema);
 *   if (!parsed.ok) return parsed.response;
 *   const body = parsed.data;
 */
export async function parseBody<T extends z.ZodType>(
  req: Request,
  schema: T
): Promise<{ ok: true; data: z.infer<T> } | { ok: false; response: Response }> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return {
      ok: false,
      response: Response.json(
        { error: 'Body bukan JSON yang valid.' },
        { status: 400 }
      ),
    };
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    return {
      ok: false,
      response: Response.json(
        { error: formatIssues(result.error) },
        { status: 422 }
      ),
    };
  }
  return { ok: true, data: result.data };
}
