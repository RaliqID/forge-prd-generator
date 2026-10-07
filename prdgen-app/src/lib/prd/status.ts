import { PRD_SECTIONS } from '@/types';
import type { PRDContent, PRDSectionKey, PRDStatus } from '@/types';

/**
 * PRD completeness and status — the single source of truth.
 *
 * Why this module exists
 * ----------------------
 * Status used to be a free-standing flag that callers set by hand, and two of
 * them disagreed with reality:
 *
 *  - `POST /api/prd` defaulted a missing status to `'completed'`, so any save
 *    that forgot the field was recorded as finished.
 *  - The workspace flow wrote `'completed'` the moment the PRD *phase* ran, not
 *    when its sections actually held content. A run that produced 1 of 17
 *    sections was stored — and displayed — as complete, with an empty Executive
 *    Summary under a green "PRD" checkmark.
 *
 * The fix is to stop treating status as an independent input. It is DERIVED
 * from the content, here, and every writer calls this. A row whose status
 * disagrees with its content is by definition wrong, and re-deriving on read
 * repairs historical rows for free.
 */

/** A section counts as done when it holds non-whitespace text. */
export function isSectionFilled(content: Partial<PRDContent> | null | undefined, key: PRDSectionKey): boolean {
  const value = content?.[key];
  return typeof value === 'string' && value.trim().length > 0;
}

/** Keys still missing content, in canonical PRD order. */
export function missingSectionKeys(
  content: Partial<PRDContent> | null | undefined
): PRDSectionKey[] {
  return PRD_SECTIONS.filter((s) => !isSectionFilled(content, s.key)).map((s) => s.key);
}

/** How many sections hold content. */
export function filledSectionCount(content: Partial<PRDContent> | null | undefined): number {
  return PRD_SECTIONS.length - missingSectionKeys(content).length;
}

/**
 * Derive the correct status from content alone.
 *
 * - No content at all  → `'draft'`  (nothing has been produced yet)
 * - Every section filled → `'completed'`
 * - Some but not all   → `'generating'` (resumable — the UI offers "Lanjutkan")
 *
 * `'failed'` is intentionally NOT derived: it records that the last attempt
 * errored, which content cannot express. Callers that know about a failure pass
 * it through `override`, and it only survives while the content is incomplete —
 * a failure whose sections all landed is a success.
 */
export function deriveStatus(
  content: Partial<PRDContent> | null | undefined,
  override?: PRDStatus
): PRDStatus {
  const missing = missingSectionKeys(content);

  // Every section present: complete, whatever an earlier attempt signalled.
  if (missing.length === 0) return 'completed';

  // Nothing generated yet.
  if (missing.length === PRD_SECTIONS.length) {
    // A failure before any content is worth surfacing.
    return override === 'failed' ? 'failed' : 'draft';
  }

  // Partially generated — resumable.
  return override === 'failed' ? 'failed' : 'generating';
}

/** Progress as a 0-1 fraction, for progress UI. */
export function completionRatio(content: Partial<PRDContent> | null | undefined): number {
  if (PRD_SECTIONS.length === 0) return 0;
  return filledSectionCount(content) / PRD_SECTIONS.length;
}

/**
 * Human label for a status, used by the dashboard and workspace headers.
 * Kept here so the wording matches the derivation rules.
 */
export function statusLabel(status: PRDStatus): string {
  switch (status) {
    case 'completed':
      return 'Selesai';
    case 'generating':
      return 'Belum lengkap';
    case 'failed':
      return 'Gagal';
    case 'draft':
    default:
      return 'Draft';
  }
}
