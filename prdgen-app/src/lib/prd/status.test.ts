import { describe, it, expect } from 'vitest';
import { PRD_SECTIONS } from '@/types';
import {
  deriveStatus,
  isSectionFilled,
  missingSectionKeys,
  filledSectionCount,
  completionRatio,
  statusLabel,
} from './status';
import type { PRDContent } from '@/types';

/**
 * Status derivation is the fix for a real production bug: a PRD holding only
 * `problem_statement` was stored (and displayed) as `completed`, because status
 * was a hand-set flag rather than a consequence of the content. These tests pin
 * the rule so no writer can reintroduce the drift.
 */

/** Build a content object with `n` sections filled, in canonical order. */
function contentWith(n: number): Partial<PRDContent> {
  const out: Partial<PRDContent> = {};
  for (const s of PRD_SECTIONS.slice(0, n)) out[s.key] = `content for ${s.key}`;
  return out;
}

const TOTAL = PRD_SECTIONS.length;

describe('isSectionFilled', () => {
  it('is false for missing, empty, and whitespace-only values', () => {
    expect(isSectionFilled({}, 'executive_summary')).toBe(false);
    expect(isSectionFilled({ executive_summary: '' }, 'executive_summary')).toBe(false);
    expect(isSectionFilled({ executive_summary: '   \n\t ' }, 'executive_summary')).toBe(false);
  });

  it('is true for real content', () => {
    expect(isSectionFilled({ executive_summary: 'Ringkasan.' }, 'executive_summary')).toBe(true);
  });

  it('tolerates null/undefined content', () => {
    expect(isSectionFilled(null, 'executive_summary')).toBe(false);
    expect(isSectionFilled(undefined, 'executive_summary')).toBe(false);
  });
});

describe('missingSectionKeys / filledSectionCount / completionRatio', () => {
  it('lists every section for empty content', () => {
    expect(missingSectionKeys({})).toHaveLength(TOTAL);
    expect(filledSectionCount({})).toBe(0);
    expect(completionRatio({})).toBe(0);
  });

  it('counts a partially filled document', () => {
    const content = contentWith(3);
    expect(filledSectionCount(content)).toBe(3);
    expect(missingSectionKeys(content)).toHaveLength(TOTAL - 3);
    expect(completionRatio(content)).toBeCloseTo(3 / TOTAL);
  });

  it('preserves canonical order in the missing list', () => {
    const missing = missingSectionKeys({ executive_summary: 'x' });
    // executive_summary is first, so it must not appear.
    expect(missing[0]).toBe(PRD_SECTIONS[1].key);
    expect(missing).not.toContain('executive_summary');
  });
});

describe('deriveStatus', () => {
  it("returns 'draft' when nothing has been generated", () => {
    expect(deriveStatus({})).toBe('draft');
    expect(deriveStatus(null)).toBe('draft');
    expect(deriveStatus(undefined)).toBe('draft');
  });

  it("returns 'completed' only when every section holds content", () => {
    expect(deriveStatus(contentWith(TOTAL))).toBe('completed');
    expect(deriveStatus(contentWith(TOTAL - 1))).toBe('generating');
  });

  it("returns 'generating' for a partial document (the reported bug)", () => {
    // The exact shape found in the database: one section, marked completed.
    const content = { problem_statement: 'x'.repeat(15144) };
    expect(deriveStatus(content)).toBe('generating');
    expect(deriveStatus(content)).not.toBe('completed');
  });

  it("keeps a 'failed' override while content is incomplete", () => {
    expect(deriveStatus({}, 'failed')).toBe('failed');
    expect(deriveStatus(contentWith(2), 'failed')).toBe('failed');
  });

  it("upgrades to 'completed' even when the attempt reported failure", () => {
    // A failure whose sections all landed IS a success — content wins.
    expect(deriveStatus(contentWith(TOTAL), 'failed')).toBe('completed');
  });

  it('ignores a bogus completed override on incomplete content', () => {
    // The regression guard: a caller claiming 'completed' cannot make it so.
    expect(deriveStatus({ problem_statement: 'x' }, 'completed')).toBe('generating');
    expect(deriveStatus({}, 'completed')).toBe('draft');
  });

  it('treats whitespace-only sections as missing', () => {
    const content = contentWith(TOTAL);
    content[PRD_SECTIONS[0].key] = '   ';
    expect(deriveStatus(content)).toBe('generating');
  });
});

describe('statusLabel', () => {
  it('labels every status', () => {
    expect(statusLabel('completed')).toBe('Selesai');
    expect(statusLabel('generating')).toBe('Belum lengkap');
    expect(statusLabel('failed')).toBe('Gagal');
    expect(statusLabel('draft')).toBe('Draft');
  });
});
