import { describe, it, expect } from 'vitest';
import { suggestSkills } from './suggest';
import type { SkillMeta } from './loader';

/**
 * Suggestions exist to solve a discovery problem — a catalogue of hundreds of
 * skills is unusable if the user has to read them all. Each suggestion must
 * carry a reason so a wrong one is obviously wrong rather than mysterious.
 */

const CATALOGUE: SkillMeta[] = [
  'requirements-engineering',
  'feature-planning',
  'product-strategy',
  'api-design',
  'security-review',
  'accessibility',
  'clean-architecture',
  'design-system',
  'ai-structured-output-and-tool-calling',
  'ai-agent-reliability-and-guardrails',
  'ai-llm-observability-and-cost',
  'domain-driven-design',
  'architecture-decision',
  'documentation-and-adrs',
].map((id) => ({ id, name: id, description: '', size: 100, restricted: false }));

describe('suggestSkills', () => {
  it('suggests AI-output skills for an LLM product', () => {
    const got = suggestSkills('Aplikasi chatbot berbasis LLM untuk customer service', CATALOGUE);
    expect(got.map((s) => s.id)).toContain('ai-structured-output-and-tool-calling');
  });

  it('suggests security for a payments product', () => {
    const got = suggestSkills('Platform pembayaran dengan login dan data keuangan', CATALOGUE);
    expect(got.map((s) => s.id)).toContain('security-review');
  });

  it('suggests api-design for a developer-facing product', () => {
    const got = suggestSkills('Public API dan SDK untuk developer', CATALOGUE);
    expect(got.map((s) => s.id)).toContain('api-design');
  });

  it('always includes the requirements baseline', () => {
    const got = suggestSkills('Aplikasi catatan sederhana', CATALOGUE);
    expect(got.map((s) => s.id)).toContain('requirements-engineering');
  });

  it('is case-insensitive', () => {
    const got = suggestSkills('PLATFORM PEMBAYARAN', CATALOGUE);
    expect(got.map((s) => s.id)).toContain('security-review');
  });

  it('gives every suggestion a reason', () => {
    const got = suggestSkills('chatbot llm dengan api dan payment', CATALOGUE);
    for (const s of got) {
      expect(s.reason.length).toBeGreaterThan(0);
    }
  });

  it('respects the limit', () => {
    const got = suggestSkills('chatbot llm api payment architecture design system', CATALOGUE, 3);
    expect(got.length).toBeLessThanOrEqual(3);
  });

  it('never suggests a skill that is not installed', () => {
    // Catalogue deliberately missing `security-review`.
    const partial = CATALOGUE.filter((s) => s.id !== 'security-review');
    const got = suggestSkills('platform pembayaran', partial);
    expect(got.map((s) => s.id)).not.toContain('security-review');
  });

  it('does not repeat a skill', () => {
    const got = suggestSkills('llm ai agent chatbot inference', CATALOGUE);
    const ids = got.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('returns an empty list for an empty catalogue', () => {
    expect(suggestSkills('anything', [])).toEqual([]);
  });

  it('still returns the baseline for empty input', () => {
    const got = suggestSkills('', CATALOGUE);
    expect(got.map((s) => s.id)).toContain('requirements-engineering');
  });
});
