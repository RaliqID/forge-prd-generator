import { describe, it, expect } from 'vitest';
import { selectSkillsForIdea } from './select';
import type { SuggestibleSkill } from './select';

/**
 * These tests run against a miniature catalogue that mirrors the real one's
 * shape (id + long description). The important properties are: relevant skills
 * outrank generic ones, an unrelated idea selects nothing, and the result is
 * deterministic.
 */

const CATALOGUE: SuggestibleSkill[] = [
  {
    id: 'auth-security',
    description:
      'Review authentication and authorization implementations. Use for login, signup, password reset, session management, OAuth, JWT, role based access control and multi tenant isolation.',
  },
  {
    id: 'security-audit',
    description:
      'Audit code for security vulnerabilities including injection, XSS, CSRF, SSRF, IDOR, authentication bypass and secrets handling.',
  },
  {
    id: 'api-design',
    description:
      'REST API design patterns including resource naming, status codes, pagination, filtering, versioning and error responses. Use when designing HTTP APIs or SDKs.',
  },
  {
    id: 'payments',
    description:
      'Integrate payments and billing: checkout flows, subscriptions, invoices, refunds, webhooks, idempotency and PCI considerations.',
  },
  {
    id: 'realtime-collaboration',
    description:
      'Design realtime collaboration features: websockets, presence, conflict resolution, CRDT, operational transform and live cursors.',
  },
  {
    id: 'ai-structured-output-and-tool-calling',
    description:
      'Get reliable structured output and tool calls from LLMs: JSON mode, constrained decoding, schema validation and retries.',
  },
  {
    id: 'accessibility',
    description:
      'Ensure interfaces are usable by everyone: keyboard navigation, screen readers, ARIA, focus management and colour contrast.',
  },
  {
    id: 'requirements-engineering',
    description:
      'Transform ambiguous requests into actionable requirements with acceptance criteria and out of scope items.',
  },
  {
    id: 'clean-architecture',
    description:
      'Structure code into layers with clear boundaries, dependency inversion and testable domain logic.',
  },
  {
    id: 'design-system',
    description:
      'Build a component library and design tokens for consistent UI across surfaces.',
  },
];

describe('selectSkillsForIdea', () => {
  it('selects payment skills for a payments product', () => {
    const got = selectSkillsForIdea('Platform pembayaran dengan checkout dan subscription bulanan', CATALOGUE);
    expect(got.map((s) => s.id)).toContain('payments');
  });

  it('selects auth-security for a login product', () => {
    const got = selectSkillsForIdea('Aplikasi dengan login, signup dan role based access control', CATALOGUE);
    expect(got.map((s) => s.id)).toContain('auth-security');
  });

  it('selects realtime for a collaborative editor', () => {
    const got = selectSkillsForIdea('Collaborative editor dengan websockets dan presence', CATALOGUE);
    expect(got.map((s) => s.id)).toContain('realtime-collaboration');
  });

  it('selects LLM output guidance for an AI product', () => {
    const got = selectSkillsForIdea('LLM agent yang harus mengembalikan JSON terstruktur', CATALOGUE);
    expect(got.map((s) => s.id)).toContain('ai-structured-output-and-tool-calling');
  });

  it('ranks the most specific skill above a generic one', () => {
    const got = selectSkillsForIdea('Payment checkout dengan invoice dan refund', CATALOGUE);
    expect(got[0]?.id).toBe('payments');
  });

  it('returns nothing for an unrelated idea', () => {
    const got = selectSkillsForIdea('Catatan harian sederhana', CATALOGUE);
    expect(got).toEqual([]);
  });

  it('returns nothing for empty input', () => {
    expect(selectSkillsForIdea('', CATALOGUE)).toEqual([]);
    expect(selectSkillsForIdea('   ', CATALOGUE)).toEqual([]);
  });

  it('returns nothing for an empty catalogue', () => {
    expect(selectSkillsForIdea('payment checkout', [])).toEqual([]);
  });

  it('respects the limit', () => {
    const got = selectSkillsForIdea(
      'payment checkout subscription login oauth api rest realtime websocket accessibility',
      CATALOGUE,
      { limit: 3 }
    );
    expect(got.length).toBeLessThanOrEqual(3);
  });

  it('reports the matched terms so a pick is explainable', () => {
    const got = selectSkillsForIdea('checkout dan invoice', CATALOGUE);
    const payments = got.find((s) => s.id === 'payments');
    expect(payments).toBeDefined();
    expect(payments!.matched.length).toBeGreaterThan(0);
  });

  it('is deterministic', () => {
    const idea = 'payment checkout login oauth api';
    const a = selectSkillsForIdea(idea, CATALOGUE);
    const b = selectSkillsForIdea(idea, CATALOGUE);
    expect(a).toEqual(b);
  });

  it('scores are normalised between 0 and 1 with the best at 1', () => {
    const got = selectSkillsForIdea('payment checkout invoice refund', CATALOGUE);
    expect(got[0].score).toBeCloseTo(1);
    for (const s of got) {
      expect(s.score).toBeGreaterThan(0);
      expect(s.score).toBeLessThanOrEqual(1);
    }
  });

  it('discounts a term that appears in every skill', () => {
    // Every description mentions "use"; it must not drive selection.
    const got = selectSkillsForIdea('use', CATALOGUE);
    expect(got).toEqual([]);
  });

  it('handles Indonesian idea text', () => {
    const got = selectSkillsForIdea(
      'Platform untuk mengelola pembayaran langganan dengan invoice otomatis',
      CATALOGUE
    );
    expect(got.map((s) => s.id)).toContain('payments');
  });
});
