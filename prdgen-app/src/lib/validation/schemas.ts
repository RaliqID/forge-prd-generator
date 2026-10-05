import { z } from 'zod';

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
 */

// ── Shared primitives ──

/** A non-empty trimmed string. */
const nonEmpty = z.string().trim().min(1);

/** Provider/model selector: '9router-auto', a model id, or a custom-engine ref. */
export const engineRequestSchema = z.object({
  model_id: z.string().trim().max(200).optional(),
  engine_id: z.string().trim().max(200).optional(),
  custom_engine_id: z.string().trim().max(200).optional(),
});

// ── PRD generation ──

export const prdFormInputSchema = z.object({
  product_name: nonEmpty.max(300),
  description: z.string().max(4000).default(''),
  target_users: z.string().max(4000).default(''),
  problem_statement: z.string().max(4000).default(''),
  features: z.array(z.string().max(500)).max(60).default([]),
  tech_stack: z.array(z.string().max(200)).max(40).default([]),
  project_type: z.enum(['mvp', 'full', 'feature']).catch('mvp'),
  timeline: z.string().max(200).default(''),
  platform: z.array(z.string().max(100)).max(20).default([]),
  additional_notes: z.string().max(8000).default(''),
});

/** One branch of the optional feature map (from the Struktur phase). */
const planSubFeatureSchema = z.object({
  id: z.string().max(200).optional(),
  name: z.string().max(500).default(''),
  description: z.string().max(2000).optional(),
});

const planFeatureSchema = z.object({
  id: z.string().max(200).optional(),
  name: z.string().max(500).default(''),
  description: z.string().max(2000).optional(),
  phase: z.coerce.number().int().min(1).max(10).catch(1),
  subFeatures: z.array(planSubFeatureSchema).max(30).default([]),
  tasks: z.array(z.unknown()).max(100).default([]),
});

export const planStructureSchema = z.object({
  root: z
    .object({
      title: z.string().max(300).default(''),
      overview: z.string().max(8000).optional(),
      architecture: z.string().max(8000).optional(),
    })
    .default({ title: '' }),
  features: z.array(planFeatureSchema).max(40).default([]),
});

export const prdGenerateSchema = engineRequestSchema.extend({
  /** Free-text idea (used when no structured form is supplied). */
  idea: z.string().max(20000).optional(),
  /** Structured form input (preferred when present). */
  input: prdFormInputSchema.optional(),
  /** Feature map from the Struktur phase. */
  structure: planStructureSchema.optional(),
  /** Subset of sections to generate this request. */
  sections: z.array(z.string().max(80)).max(40).optional(),
  /** Already-generated sections, for cross-section consistency. */
  previous: z.record(z.string(), z.string().max(60000)).optional(),
  /** Existing PRD to append to / revise. */
  prd_id: z.string().max(200).optional(),
});

// ── Plan phases ──

export const planStructureRequestSchema = engineRequestSchema.extend({
  idea: z.string().max(20000).optional(),
});

export const planTasksRequestSchema = engineRequestSchema.extend({
  structure: planStructureSchema.optional(),
});

// ── Refine ──

export const refineSchema = engineRequestSchema.extend({
  prd_id: z.string().max(200).optional(),
  section: z.string().max(80).optional(),
  instruction: nonEmpty.max(4000),
  content: z.string().max(60000).optional(),
});

// ── Custom engines ──

export const customEngineSchema = z.object({
  name: nonEmpty.max(120),
  model: nonEmpty.max(200),
  base_url: nonEmpty.max(500),
  api_key: z.string().max(500).default(''),
  compat: z.enum(['openai', 'anthropic']).catch('openai'),
});

/**
 * Run a schema and, on failure, produce a compact field-level message.
 *
 * The message names failing paths (`input.features: Expected array, received
 * undefined`) instead of dumping the whole ZodError, so it is safe to show a
 * client and useful in logs.
 */
export function formatIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 8)
    .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
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
      response: Response.json({ error: 'Body bukan JSON yang valid.' }, { status: 400 }),
    };
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    return {
      ok: false,
      response: Response.json(
        { error: `Permintaan tidak valid — ${formatIssues(result.error)}` },
        { status: 422 }
      ),
    };
  }
  return { ok: true, data: result.data };
}
