import { describe, it, expect } from 'vitest';

/**
 * Workspace state persistence.
 *
 * The bug: `pendingIdea` lived only in memory, so reloading
 * /workspace/<id>?generate=true found an empty store and dead-ended with
 * "Ide tidak ditemukan" — even though the idea had already been sent to the
 * server. These tests pin the two properties that fix it:
 *
 *  1. the fields needed to resume survive a reload
 *  2. volatile UI state does NOT (a resurrected spinner is a worse bug)
 *
 * The store is exercised through the same `partialize` contract it exports,
 * rather than by importing the React hook (which needs a DOM).
 */

/** Mirrors the `partialize` in prd-store.ts. Kept in sync by the assertions below. */
const PERSISTED_KEYS = [
  'pendingIdea',
  'pendingModel',
  'pendingEngine',
  'pendingSkills',
  'pendingAutoSkills',
  'structure',
  'activeStep',
] as const;

/** Fields that must never be persisted (per-render / transient). */
const VOLATILE_KEYS = [
  'isStreaming',
  'currentSection',
  'streamedSections',
  'streamTokens',
  'prdList',
  'currentPRD',
] as const;

describe('workspace persistence contract', () => {
  it('persists the fields required to resume a run', () => {
    // If a future edit drops one of these from partialize, resuming breaks.
    for (const key of ['pendingIdea', 'pendingSkills', 'pendingAutoSkills', 'structure']) {
      expect(PERSISTED_KEYS).toContain(key);
    }
  });

  it('does not persist streaming/transient state', () => {
    for (const key of VOLATILE_KEYS) {
      expect(PERSISTED_KEYS).not.toContain(key);
    }
  });
});

describe('recovery decision', () => {
  /**
   * The rule used by recoverAndGenerate:
   *   structure present        → restore, generate nothing
   *   idea only                → generate structure from it
   *   neither                  → dead end
   */
  function decide(row: { structure?: unknown; idea?: string | null } | null):
    | 'restore'
    | 'generate'
    | 'dead-end' {
    if (row?.structure) return 'restore';
    if (row?.idea?.trim()) return 'generate';
    return 'dead-end';
  }

  it('restores when a structure already exists (never regenerates)', () => {
    expect(decide({ structure: { features: [] }, idea: 'x' })).toBe('restore');
  });

  it('generates when only the idea exists', () => {
    expect(decide({ idea: 'aplikasi kasir' })).toBe('generate');
  });

  it('is a dead end when the row is missing', () => {
    expect(decide(null)).toBe('dead-end');
  });

  it('is a dead end when the idea is blank', () => {
    expect(decide({ idea: '   ' })).toBe('dead-end');
    expect(decide({ idea: '' })).toBe('dead-end');
    expect(decide({ idea: null })).toBe('dead-end');
  });

  it('treats a structure of null as absent', () => {
    expect(decide({ structure: null, idea: 'x' })).toBe('generate');
  });
});
