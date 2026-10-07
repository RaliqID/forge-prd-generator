/**
 * Request size limits, in one place.
 *
 * These were previously inline numbers in the zod schemas. They are pulled out
 * here because the numbers encode real product decisions and provider
 * capabilities, and one of them (the idea length) was wrong in a way users hit
 * immediately: a 20 000-character cap rejected a detailed 50 000-word brief with
 * "Too big", which reads as a bug, not a limit.
 *
 * Sizing rationale
 * ----------------
 * The structured providers in use expose a ~1M-token context with a 384K-token
 * completion budget, so a long brief is not the constraint. The caps exist to
 * bound memory, reject abusive payloads, and keep a single request from turning
 * into a multi-minute generation the user did not intend. They are set well
 * above real usage, not just above it.
 *
 * Characters are the unit everywhere, because that is what the wire carries.
 * A rough conversion for reference: Bahasa Indonesia/English prose averages
 * ~6 characters per word including the separating space, so
 *   IDEA_MAX_CHARS 300_000  ≈ 50 000 words
 *   FIELD_MAX_CHARS 20_000  ≈  3 300 words
 */

/** Prose input — the free-text idea a plan is generated from. ~50k words. */
export const IDEA_MAX_CHARS = 300_000;

/** Long-form narrative fields on the structured PRD form. ~3.3k words. */
export const FIELD_MAX_CHARS = 20_000;

/** Short identifier/title fields (product name, timeline, platform names). */
export const LABEL_MAX_CHARS = 600;

/** A single feature or tech-stack entry. */
export const LIST_ITEM_MAX_CHARS = 2_000;

/** Model ids, engine ids, PRD ids. */
export const ID_MAX_CHARS = 200;

/** One generated PRD section, held in the prompt as cross-section context. */
export const SECTION_CONTENT_MAX_CHARS = 200_000;

/** A refine/chat instruction. */
export const INSTRUCTION_MAX_CHARS = 20_000;

/** Base URLs and API keys for custom engines. */
export const URL_MAX_CHARS = 2_000;
export const SECRET_MAX_CHARS = 2_000;

// ── Collection sizes ──

export const FEATURES_MAX = 200;
export const TECH_STACK_MAX = 100;
export const PLATFORM_MAX = 40;
export const SUB_FEATURES_MAX = 100;
export const PLAN_FEATURES_MAX = 100;
export const TASKS_MAX = 500;
export const SECTIONS_MAX = 64;
