import { describe, it, expect } from 'vitest';
import { extractJson, looksLikeNonJsonAnswer } from './plan-prompts';

/**
 * extractJson must survive every way a model wraps a payload. The important
 * case is tool-call markup: a combo/router upstream answered a JSON-contract
 * prompt by trying to run a shell command, and the markup contains braces, so a
 * naive first-`{`/last-`}` slice spanned several fragments and parsed nothing.
 */

describe('extractJson', () => {
  it('parses a bare object', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('parses a ```json fenced block', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('parses a fence with no language tag', () => {
    expect(extractJson('```\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('ignores prose before and after the object', () => {
    const raw = 'Sure! Here is the plan:\n\n{"features":[{"id":"x"}]}\n\nLet me know.';
    expect(extractJson(raw)).toEqual({ features: [{ id: 'x' }] });
  });

  it('handles braces inside string values', () => {
    const raw = '{"code":"function f() { return 1; }"}';
    expect(extractJson<{ code: string }>(raw)?.code).toContain('return 1');
  });

  it('handles escaped quotes inside strings', () => {
    const raw = '{"msg":"he said \\"hi\\" to {me}"}';
    expect(extractJson<{ msg: string }>(raw)?.msg).toContain('hi');
  });

  it('stops at the first balanced object when several appear', () => {
    const raw = '{"first":1} then {"second":2}';
    expect(extractJson(raw)).toEqual({ first: 1 });
  });

  it('survives tool-call markup wrapping the payload', () => {
    // The shape that broke the old slicer.
    const raw =
      'I will do that.\n<|tool|> invoke name="bash">\n{"command":"ls"}</|tool|>\n{"features":[{"id":"a"}]}';
    expect(extractJson(raw)).toEqual({ command: 'ls' });
  });

  it('returns null for prose with no object', () => {
    expect(extractJson('I cannot do that without more detail.')).toBeNull();
  });

  it('returns null for an unterminated object', () => {
    expect(extractJson('{"a":1')).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(extractJson('')).toBeNull();
  });

  it('never throws on malformed content', () => {
    expect(() => extractJson('{{{')).not.toThrow();
    expect(extractJson('{{{')).toBeNull();
  });
});

describe('looksLikeNonJsonAnswer', () => {
  it('flags agent tool-call markup', () => {
    expect(looksLikeNonJsonAnswer('<||DSML||invoke name="bash">')).toBe(true);
    expect(looksLikeNonJsonAnswer('invoke name="bash"')).toBe(true);
    expect(looksLikeNonJsonAnswer('<tool>bash</tool>')).toBe(true);
  });

  it('flags a conversational opener', () => {
    expect(looksLikeNonJsonAnswer("I'll map your feature set onto an architecture.")).toBe(true);
    expect(looksLikeNonJsonAnswer('Let me start by exploring the repository.')).toBe(true);
    expect(looksLikeNonJsonAnswer('Baik, saya akan mulai.')).toBe(true);
  });

  it('flags a clarifying question in the opening lines', () => {
    expect(looksLikeNonJsonAnswer('Tell me:\n- Target: local or hosted?')).toBe(true);
  });

  it('flags a non-json fenced block', () => {
    expect(looksLikeNonJsonAnswer('```bash\nls -la\n```')).toBe(true);
  });

  it('does NOT flag a real JSON payload', () => {
    expect(looksLikeNonJsonAnswer('{"features":[{"id":"auth"}]}')).toBe(false);
    expect(looksLikeNonJsonAnswer('```json\n{"features":[]}\n```')).toBe(false);
  });
});
