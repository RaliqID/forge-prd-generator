import { describe, it, expect } from 'vitest';
import { describeHttpError, resolveModelFallbacks } from './providers';

/**
 * Error mapping for provider failures.
 *
 * The bug these guard: an exhausted credit balance arrives as **503**, which
 * mapped to "server provider sibuk/gateway error". The body that actually
 * explained it ("can only afford 2085 tokens") was discarded by a 200-character
 * cutoff, so the user saw "server busy" and kept retrying a request that could
 * never succeed.
 */

describe('describeHttpError — credit exhaustion', () => {
  const realBody = JSON.stringify({
    error: {
      message:
        '[openrouter/deepseek-v4.1-flash] [402]: {"error":{"message":"This request requires more credits, or fewer max_tokens. You requested up to 16000 tokens, but can only afford 2085. To increase, visit https://openrouter.ai/settings/credits"}}',
    },
  });

  it('names credit exhaustion instead of "server busy" on a 503', () => {
    const msg = describeHttpError('9Router', 503, realBody);
    expect(msg).toContain('kredit/kuota provider habis');
    expect(msg).not.toContain('sibuk');
  });

  it('reports the remaining token budget when the body states it', () => {
    const msg = describeHttpError('9Router', 503, realBody);
    expect(msg).toContain('2085');
  });

  it('suggests a way forward', () => {
    const msg = describeHttpError('9Router', 402, realBody);
    expect(msg).toMatch(/isi ulang|turunkan max_tokens|ganti model/i);
  });

  it('detects quota/billing wording from other gateways', () => {
    expect(describeHttpError('P', 429, 'insufficient_quota: exceeded your current quota')).toContain(
      'kredit/kuota'
    );
    expect(describeHttpError('P', 400, 'billing hard limit reached')).toContain('kredit/kuota');
  });
});

describe('describeHttpError — other specific causes', () => {
  it('identifies context-length overflow', () => {
    const msg = describeHttpError('P', 400, 'This model has a maximum context length of 8192 tokens');
    expect(msg).toContain('context window');
  });

  it('identifies a missing model', () => {
    const msg = describeHttpError('P', 404, 'The model does not exist');
    expect(msg).toContain('model tidak tersedia');
  });
});

describe('describeHttpError — generic mapping', () => {
  it('still maps plain statuses when the body says nothing useful', () => {
    expect(describeHttpError('P', 503, '')).toContain('sibuk');
    expect(describeHttpError('P', 500, '')).toContain('server provider error');
    expect(describeHttpError('P', 401, '')).toContain('API key ditolak');
  });

  it('appends a readable excerpt instead of dropping long bodies', () => {
    const long = 'x'.repeat(900);
    const msg = describeHttpError('P', 500, long);
    // The old 200-char cap dropped the whole excerpt; now it is kept, bounded.
    expect(msg).toContain('x'.repeat(50));
    expect(msg.length).toBeLessThan(500);
  });

  it('never leaks raw HTML', () => {
    const msg = describeHttpError('P', 502, '<!DOCTYPE html><html><body>Bad gateway</body></html>');
    expect(msg).not.toContain('<');
    expect(msg).toContain('sibuk');
  });

  it('collapses whitespace in the excerpt', () => {
    const msg = describeHttpError('P', 500, 'line one\n\n\n   line two');
    expect(msg).toContain('line one line two');
  });
});

describe('resolveModelFallbacks', () => {
  const original = process.env.NINE_ROUTER_MODEL;
  const originalFallbacks = process.env.NINE_ROUTER_MODEL_FALLBACKS;

  function restore() {
    if (original === undefined) delete process.env.NINE_ROUTER_MODEL;
    else process.env.NINE_ROUTER_MODEL = original;
    if (originalFallbacks === undefined) delete process.env.NINE_ROUTER_MODEL_FALLBACKS;
    else process.env.NINE_ROUTER_MODEL_FALLBACKS = originalFallbacks;
  }

  it('falls back to NINE_ROUTER_MODEL (the combo alias) by default', () => {
    delete process.env.NINE_ROUTER_MODEL_FALLBACKS;
    process.env.NINE_ROUTER_MODEL = 'Dev-Stack';
    expect(resolveModelFallbacks('deepseek-v4.1-flash')).toEqual(['Dev-Stack']);
    restore();
  });

  it('never includes the primary model (retrying it is pointless)', () => {
    process.env.NINE_ROUTER_MODEL = 'deepseek-v4.1-flash';
    expect(resolveModelFallbacks('deepseek-v4.1-flash')).not.toContain('deepseek-v4.1-flash');
    restore();
  });

  it('honours an explicit comma-separated list', () => {
    process.env.NINE_ROUTER_MODEL_FALLBACKS = 'a, b ,, c';
    expect(resolveModelFallbacks('primary')).toEqual(['a', 'b', 'c']);
    restore();
  });

  it('de-duplicates', () => {
    process.env.NINE_ROUTER_MODEL_FALLBACKS = 'a,a,b';
    expect(resolveModelFallbacks('primary')).toEqual(['a', 'b']);
    restore();
  });

  it('defaults to Dev-Stack when nothing is configured', () => {
    delete process.env.NINE_ROUTER_MODEL_FALLBACKS;
    delete process.env.NINE_ROUTER_MODEL;
    expect(resolveModelFallbacks('primary')).toEqual(['Dev-Stack']);
    restore();
  });
});
