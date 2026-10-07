import { PRD_SECTIONS } from '@/types';
import type { PRDSectionKey, PRDSection } from '@/types';

/**
 * Heading → section-key resolution for the streaming PRD parser.
 *
 * Extracted from the generate route so it can be unit-tested and reused. The
 * behaviour it must guarantee: the model's heading text is matched to one of
 * the requested sections even though models vary the presentation — numbering
 * ("## 1. Executive Summary"), "&" vs "and", casing, punctuation, separators,
 * and LANGUAGE all differ run to run.
 *
 * Getting this wrong is not cosmetic. When no heading matches, the parser never
 * emits `section_start`, every token is buffered as preamble, the buffer hits
 * its cap and the request aborts — producing an EMPTY PRD that still reports
 * success. It has happened twice:
 *
 *   1. Numbered headings ("## 1. Executive Summary") — a leading numeral left
 *      the normalized text as "1 executive summary", which matched nothing.
 *   2. TRANSLATED headings. The prompts ask for Bahasa Indonesia output, and
 *      the model duly writes "## 1. Ringkasan Eksekutif" instead of
 *      "Executive Summary". An English-only table matched 3 of 41 headings, so
 *      most of a finished document was discarded and the run never converged.
 *
 * The lesson encoded here: match against every title a model plausibly uses,
 * in both languages, rather than assuming it mirrors our internal naming.
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

/**
 * Alternative titles per section, in BOTH languages the prompts use.
 *
 * The prompts instruct the model to write titles in the language of the user's
 * idea (default Bahasa Indonesia), so Indonesian forms are not an edge case —
 * they are the common case. Each entry is normalized like any heading.
 *
 * Keys are the internal section keys; values are extra spellings to accept
 * beyond `PRD_SECTIONS[].title`.
 */
const SECTION_ALIASES: Partial<Record<PRDSectionKey, string[]>> = {
  executive_summary: ['Ringkasan Eksekutif', 'Ringkasan', 'Executive Summary'],
  problem_statement: [
    'Latar Belakang',
    'Latar Belakang & Problem Statement',
    'Pernyataan Masalah',
    'Problem Statement',
  ],
  goals_metrics: [
    'Goals',
    'Goals & Objectives',
    'Tujuan',
    'Tujuan & Metrik',
    'Metrik Keberhasilan',
    'Success Metrics',
    'Success Metrics KPI',
    'Success Metrics (KPI)',
    'Metrik Keberhasilan KPI',
    'KPI',
  ],
  user_personas: ['Target Users', 'Target User', 'Pengguna', 'Persona Pengguna', 'User Persona'],
  glossary: ['Glosarium'],
  feature_list: [
    'Fitur',
    'Daftar Fitur',
    'Fitur & Requirements',
    'Fitur dan Requirement',
    'Requirements',
    'Feature List',
    'Prioritas Fitur',
  ],
  user_stories: ['Cerita Pengguna', 'User Story'],
  functional_requirements: ['Kebutuhan Fungsional', 'Requirement Fungsional', 'FR'],
  non_functional_requirements: [
    'Kebutuhan Non-Fungsional',
    'Kebutuhan Non Fungsional',
    'Non-Functional Requirements',
    'NFR',
  ],
  system_architecture: [
    'Arsitektur',
    'Arsitektur Sistem',
    'Arsitektur Teknis',
    'Tech Stack',
    'Tech Stack (Rekomendasi)',
    'Teknologi',
  ],
  data_model: ['Model Data', 'Skema Data', 'Struktur Data', 'Database Schema', 'Skema Database'],
  api_specification: ['Spesifikasi API', 'API', 'Endpoint API', 'Daftar API'],
  risk_assessment: ['Risiko', 'Risiko & Mitigasi', 'Risiko dan Mitigasi', 'Manajemen Risiko'],
  open_questions: ['Pertanyaan Terbuka', 'Asumsi & Pertanyaan', 'Open Question', 'Pertanyaan'],
  diagrams: [
    'Diagram',
    'Diagram & Alur',
    'Alur',
    'User Flow',
    'User Flow Alur Utama',
    'Alur Utama',
    'Flow',
    'Alur Pengguna',
    'Flow Diagram',
  ],
  roadmap: ['Peta Jalan', 'Rencana Rilis', 'Release Plan', 'Timeline', 'Milestone'],
  task_breakdown: ['Daftar Task', 'Task', 'Rincian Tugas', 'Breakdown Task', 'Tugas'],
};

export type HeadingIndex = Map<string, PRDSectionKey>;

/**
 * Build the lookup from normalized heading text → section key.
 * Includes the human title, the raw key, and every language alias.
 */
export function buildHeadingIndex(sections: readonly PRDSection[] = PRD_SECTIONS): HeadingIndex {
  const index: HeadingIndex = new Map();

  const add = (text: string, key: PRDSectionKey) => {
    const norm = normalizeHeading(text);
    // First writer wins so a specific alias cannot be shadowed by a generic
    // one added later (Map.set would otherwise overwrite).
    if (norm && !index.has(norm)) index.set(norm, key);
  };

  for (const s of sections) {
    add(s.title, s.key);
    add(s.key.endsWith('s') ? s.key.replace(/_/g, ' ') : s.key.replace(/_/g, ' '), s.key);
    for (const alias of SECTION_ALIASES[s.key] ?? []) add(alias, s.key);
  }

  return index;
}

/** Resolve a heading line to a section key, or undefined when it matches none. */
export function matchHeading(index: HeadingIndex, heading: string): PRDSectionKey | undefined {
  return index.get(normalizeHeading(heading));
}

/** Maximum heading depth treated as a SECTION boundary. */
const SECTION_HEADING_DEPTH = 2;

/**
 * Extract the text of a heading line that denotes a SECTION, or null.
 *
 * Depth matters. Models write nested structure:
 *
 *     ## 2. Latar Belakang & Problem Statement
 *     ### 2.1 Problem Statement
 *     ### 2.2 Masalah Turunan
 *
 * `###` marks a subsection INSIDE section 2. Treating it as a section boundary
 * would end `problem_statement` and immediately restart it, splitting one
 * section in two and duplicating its heading. Only `#` and `##` are section
 * level; anything deeper returns null so it flows through as ordinary content.
 */
export function headingTextOf(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('#')) return null;
  const match = trimmed.match(/^(#+)\s*(.*)$/);
  if (!match) return null;
  const depth = match[1].length;
  if (depth > SECTION_HEADING_DEPTH) return null;
  const text = match[2].trim();
  return text.length > 0 ? text : null;
}
