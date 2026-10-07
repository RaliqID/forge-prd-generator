import { describe, it, expect } from 'vitest';
import { PRD_SECTIONS } from '@/types';
import { missingSectionKeys, filledSectionCount } from './status';
import type { PRDContent, PRDSectionKey } from '@/types';

/**
 * Resume selection.
 *
 * The resume loop must ask the model ONLY for sections that are still empty.
 * This is the behaviour the user cares about: "yang belum di-generate aja,
 * jangan yang udah di-generate diulang lagi".
 *
 * These tests pin the selection rule itself. The generation loop calls exactly
 * this (`missingKeys()`), so if the rule is right and the accumulator keeps
 * every delivered section, no finished section is ever re-requested.
 */

/** Order-preserving "what would we request next" over the canonical list. */
function nextRequest(content: Partial<PRDContent>, groupSize = 3): PRDSectionKey[][] {
  const todo = missingSectionKeys(content);
  const groups: PRDSectionKey[][] = [];
  for (let i = 0; i < todo.length; i += groupSize) groups.push(todo.slice(i, i + groupSize));
  return groups;
}

describe('resume selection', () => {
  it('requests everything when nothing is generated', () => {
    const groups = nextRequest({});
    expect(groups.flat()).toEqual(PRD_SECTIONS.map((s) => s.key));
    expect(groups).toHaveLength(Math.ceil(PRD_SECTIONS.length / 3));
  });

  it('never re-requests a section that already has content', () => {
    const content: Partial<PRDContent> = {
      executive_summary: 'done',
      problem_statement: 'done',
    };
    const requested = nextRequest(content).flat();
    expect(requested).not.toContain('executive_summary');
    expect(requested).not.toContain('problem_statement');
    expect(requested).toHaveLength(PRD_SECTIONS.length - 2);
  });

  it('requests nothing when the document is complete', () => {
    const content: Partial<PRDContent> = {};
    for (const s of PRD_SECTIONS) content[s.key] = 'x';
    expect(nextRequest(content)).toEqual([]);
    expect(filledSectionCount(content)).toBe(PRD_SECTIONS.length);
  });

  it('treats a whitespace-only section as still missing', () => {
    const content: Partial<PRDContent> = { executive_summary: '   \n ' };
    expect(nextRequest(content).flat()).toContain('executive_summary');
  });

  it('keeps canonical order across groups', () => {
    const groups = nextRequest({ executive_summary: 'done' });
    expect(groups[0][0]).toBe(PRD_SECTIONS[1].key);
    expect(groups.flat()).toEqual(
      PRD_SECTIONS.filter((s) => s.key !== 'executive_summary').map((s) => s.key)
    );
  });

  it('shrinks the work as sections land (simulated convergence)', () => {
    // Simulate a model that over-delivers more than asked each round: every
    // request fills its group PLUS two bonus sections.
    const content: Partial<PRDContent> = {};
    let requests = 0;
    for (let round = 0; round < 20; round++) {
      const todo = missingSectionKeys(content);
      if (todo.length === 0) break;
      const group = todo.slice(0, 3);
      requests++;
      for (const k of group) content[k] = 'x';
      // Bonus: the next two missing sections also arrive.
      for (const k of todo.slice(3, 5)) content[k] = 'x';
    }
    expect(missingSectionKeys(content)).toHaveLength(0);
    // Fewer requests than the naive ceil(17/3)=6 because bonuses are kept.
    expect(requests).toBeLessThan(6);
    expect(requests).toBeGreaterThan(0);
  });
});
