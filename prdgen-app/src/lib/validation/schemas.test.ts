import { describe, it, expect } from 'vitest';
import {
  prdGenerateSchema,
  planStructureRequestSchema,
  prdFormInputSchema,
  formatIssues,
  parseBody,
} from './schemas';
import { IDEA_MAX_CHARS, FIELD_MAX_CHARS } from './limits';

/**
 * Validation exists because an unvalidated PRD payload crashed deep inside the
 * prompt builder with "Cannot read properties of undefined (reading 'join')" —
 * a 500 naming no field. These tests pin the contract: bad input is rejected
 * with a field-level message, and valid input is accepted unchanged.
 */

describe('prdFormInputSchema', () => {
  it('accepts a well-formed form', () => {
    const r = prdFormInputSchema.safeParse({
      product_name: 'ATLAS',
      description: 'observability',
      target_users: 'devs',
      problem_statement: 'no visibility',
      features: ['a', 'b'],
      tech_stack: ['Next.js'],
      project_type: 'mvp',
      timeline: '3 months',
      platform: ['web'],
      additional_notes: '',
    });
    expect(r.success).toBe(true);
  });

  it('defaults array and string fields instead of failing', () => {
    const r = prdFormInputSchema.safeParse({ product_name: 'X' });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.features).toEqual([]);
      expect(r.data.tech_stack).toEqual([]);
      expect(r.data.description).toBe('');
    }
  });

  it('rejects a missing product_name', () => {
    expect(prdFormInputSchema.safeParse({ features: [] }).success).toBe(false);
  });

  it('rejects an empty/whitespace product_name', () => {
    expect(prdFormInputSchema.safeParse({ product_name: '   ' }).success).toBe(false);
  });

  it('rejects a non-array features value', () => {
    expect(prdFormInputSchema.safeParse({ product_name: 'X', features: 'a,b' }).success).toBe(false);
  });

  it('falls back to a valid project_type rather than failing', () => {
    const r = prdFormInputSchema.safeParse({ product_name: 'X', project_type: 'nonsense' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.project_type).toBe('mvp');
  });
});

describe('prdGenerateSchema', () => {
  it('accepts a minimal idea-only request', () => {
    expect(prdGenerateSchema.safeParse({ idea: 'build a thing' }).success).toBe(true);
  });

  it('accepts a full structured request', () => {
    const r = prdGenerateSchema.safeParse({
      model_id: '9router-auto',
      input: {
        product_name: 'ATLAS',
        features: ['x'],
        tech_stack: ['y'],
        project_type: 'mvp',
      },
      structure: {
        root: { title: 'ATLAS' },
        features: [{ id: 'f1', name: 'Observer', phase: 1, subFeatures: [], tasks: [] }],
      },
      sections: ['executive_summary'],
      previous: { executive_summary: 'text' },
    });
    expect(r.success).toBe(true);
  });

  it('coerces a string phase to a number', () => {
    const r = prdGenerateSchema.safeParse({
      structure: { root: { title: 'T' }, features: [{ id: 'a', name: 'A', phase: '2' }] },
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.structure?.features[0].phase).toBe(2);
  });

  it('rejects a structure whose features is not an array', () => {
    const r = prdGenerateSchema.safeParse({ structure: { root: { title: 'T' }, features: 'no' } });
    expect(r.success).toBe(false);
  });

  it('accepts an empty body (every field optional)', () => {
    expect(prdGenerateSchema.safeParse({}).success).toBe(true);
  });
});

describe('planStructureRequestSchema', () => {
  it('accepts an idea', () => {
    expect(planStructureRequestSchema.safeParse({ idea: 'x', model_id: '9router-auto' }).success).toBe(true);
  });

  it('accepts an empty body', () => {
    expect(planStructureRequestSchema.safeParse({}).success).toBe(true);
  });
});

describe('formatIssues', () => {
  it('names the failing path for a structural mismatch', () => {
    const r = prdFormInputSchema.safeParse({ product_name: 'X', features: 'nope' });
    expect(r.success).toBe(false);
    if (!r.success) {
      const msg = formatIssues(r.error);
      expect(msg).toContain('features');
    }
  });

  it('uses the schema\'s own user-facing message for a limit violation', () => {
    const r = planStructureRequestSchema.safeParse({ idea: 'x'.repeat(IDEA_MAX_CHARS + 1) });
    expect(r.success).toBe(false);
    if (!r.success) {
      const msg = formatIssues(r.error);
      // Readable, states the cap, and does not leak Zod's "Too big" wording.
      expect(msg).toContain('Ide terlalu panjang');
      expect(msg).toContain('50.000 kata');
      expect(msg).not.toMatch(/Too big/i);
      expect(msg).not.toMatch(/Invalid input/i);
    }
  });
});

describe('idea length budget (~50k words)', () => {
  it('accepts a 50,000-word brief', () => {
    // "kata " is 5 chars, so this is 250k chars — a 50k-word brief with short
    // words, comfortably inside the 300k budget.
    const fiftyThousandWords = 'kata '.repeat(50_000);
    expect(fiftyThousandWords.length).toBeGreaterThan(200_000);
    const r = planStructureRequestSchema.safeParse({ idea: fiftyThousandWords });
    expect(r.success).toBe(true);
  });

  it('accepts a full-budget 300k-character brief', () => {
    const r = prdGenerateSchema.safeParse({ idea: 'w'.repeat(IDEA_MAX_CHARS) });
    expect(r.success).toBe(true);
  });

  it('rejects one character over the cap', () => {
    const r = prdGenerateSchema.safeParse({ idea: 'w'.repeat(IDEA_MAX_CHARS + 1) });
    expect(r.success).toBe(false);
  });

  it('no longer rejects at the old 20k boundary', () => {
    // Regression guard: 20 001 chars used to fail with "Too big".
    const r = planStructureRequestSchema.safeParse({ idea: 'w'.repeat(20_001) });
    expect(r.success).toBe(true);
  });

  it('keeps the ~3.3k-word cap on narrative form fields', () => {
    const ok = prdFormInputSchema.safeParse({
      product_name: 'X',
      description: 'w'.repeat(FIELD_MAX_CHARS),
    });
    expect(ok.success).toBe(true);

    const tooLong = prdFormInputSchema.safeParse({
      product_name: 'X',
      description: 'w'.repeat(FIELD_MAX_CHARS + 1),
    });
    expect(tooLong.success).toBe(false);
    if (!tooLong.success) {
      expect(formatIssues(tooLong.error)).toContain('Deskripsi terlalu panjang');
    }
  });
});

describe('parseBody', () => {
  function reqWith(body: unknown): Request {
    return new Request('http://test.local/api', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('returns ok + data for a valid body', async () => {
    const parsed = await parseBody(reqWith({ idea: 'hello' }), prdGenerateSchema);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.data.idea).toBe('hello');
  });

  it('returns a 422 Response naming the field for an invalid body', async () => {
    const parsed = await parseBody(reqWith({ input: { features: 'x' } }), prdGenerateSchema);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.response.status).toBe(422);
      const body = await parsed.response.json();
      expect(body.error).toContain('features');
    }
  });

  it('returns 422 with a readable reason when the idea is over budget', async () => {
    const parsed = await parseBody(
      reqWith({ idea: 'x'.repeat(IDEA_MAX_CHARS + 1) }),
      planStructureRequestSchema
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.response.status).toBe(422);
      const body = await parsed.response.json();
      expect(body.error).toContain('Ide terlalu panjang');
    }
  });

  it('returns 400 for a non-JSON body', async () => {
    const badReq = new Request('http://test.local/api', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });
    const parsed = await parseBody(badReq, prdGenerateSchema);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.response.status).toBe(400);
  });
});
