import { PRD_SECTIONS } from '@/types';
import type { PRDSectionKey, PRDSection } from '@/types';

/**
 * Heading → section-key resolution for the streaming PRD parser.
 *
 * Extracted from the generate route so it can be unit-tested and reused. The
 * behaviour it must guarantee: the model's heading text is matched to one of
 * the requested sections even though models vary the presentation — numbering
 * ("## 1. Executive Summary"), "&" vs "and", casing, punctuation and
 * separators all differ run to run.
 *
 * Getting this wrong is not cosmetic. When no heading matches, the parser never
 * emits `section_start`, every token is buffered as preamble, the buffer hits
 * its cap and the request aborts — producing an EMPTY PRD that still reports
 * success. That happened in production; these rules exist to prevent it.
 */

/**
 * Normalize a heading for comparison.
 *
 * Order matters: the enumeration prefix is stripped BEFORE punctuation is
 * collapsed, otherwise "1. Executive Summary" would already have become
 * "1 executive summary" and the prefix regex could not see the separator.
 */
export function normalizeHeading(h: string): string {
  return h
    .replace(ENUM_PREFIX, '')
    // Treat underscores as word separators: JS `\w` includes "_", so the
    // punctuation pass below would leave "executive_summary" intact and it
    // would never match the title "Executive Summary".
    .replace(/_/g, ' ')
    // "&" and the word "and" are the same conjunction.
    .replace(/\band\b|&/g, ' and ')
    // Drop remaining punctuation, collapse whitespace.
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Leading list/enumeration marker: "1. ", "2.3) ", "IV - ", "5: ".
 *
 * Two shapes must be told apart:
 *   "2.3 Data Model"        → enumeration, strip it
 *   "3-Tier Architecture"   → part of the title, KEEP it
 *
 * The dot-number form is listed first and consumes the whole numeral, so
 * "2.3 Data Model" cannot be reduced to a stray "3". A hyphen only counts as
 * enumeration when spaces surround it ("4 - Risk Assessment"); glued on
 * ("3-Tier") it is a compound word and stays.
 */
const ENUM_PREFIX =
  /^\s*(?:\d+(?:\.\d+)+\s*[.):]?\s*|\d+\s*[.):]\s*|\d+\s+|(?:\d+|[IVXLC]+)\s+[-–—]\s+|[IVXLC]+\s*[.):]\s*)/i;

export type HeadingIndex = Map<string, PRDSectionKey>;

/**
 * Build the lookup from normalized heading text → section key.
 * Includes both the human title ("Executive Summary") and the raw key
 * ("executive summary") so either form is accepted.
 */
export function buildHeadingIndex(sections: readonly PRDSection[] = PRD_SECTIONS): HeadingIndex {
  const index: HeadingIndex = new Map();
  for (const s of sections) {
    index.set(normalizeHeading(s.title), s.key);
    index.set(s.key.replace(/_/g, ' ').toLowerCase(), s.key);
  }
  return index;
}

/** Resolve a heading line to a section key, or undefined when it matches none. */
export function matchHeading(index: HeadingIndex, heading: string): PRDSectionKey | undefined {
  return index.get(normalizeHeading(heading));
}

/**
 * Strip the leading "#" run from a markdown heading line and return the text,
 * or null when the line is not a heading.
 */
export function headingTextOf(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('#')) return null;
  return trimmed.replace(/^#+\s*/, '').trim();
}
