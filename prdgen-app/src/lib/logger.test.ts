import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createLogger, requestLogger } from './logger';

/**
 * The logger writes JSON lines to stdout/stderr. These tests pin the contract
 * that matters operationally: one line per call, machine-parsable, carrying the
 * base fields, and — critically — never throwing into a request even when a
 * field is circular.
 */

describe('createLogger', () => {
  let out: string[];
  let err: string[];
  // Inferred from the assignments below. `ReturnType<typeof vi.spyOn>` resolves
  // to the generic default (…args: unknown[]) which the real overloaded
  // process.stdout.write signature does not satisfy.
  let outSpy: { mockRestore(): void };
  let errSpy: { mockRestore(): void };

  beforeEach(() => {
    out = [];
    err = [];
    outSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      out.push(String(chunk));
      return true;
    });
    errSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      err.push(String(chunk));
      return true;
    });
    delete process.env.LOG_LEVEL;
  });

  afterEach(() => {
    outSpy.mockRestore();
    errSpy.mockRestore();
  });

  it('emits a single JSON line per call', () => {
    createLogger({ route: '/api/x' }).info('hello', { n: 1 });
    expect(out).toHaveLength(1);
    const parsed = JSON.parse(out[0]);
    expect(parsed.msg).toBe('hello');
    expect(parsed.level).toBe('info');
    expect(parsed.route).toBe('/api/x');
    expect(parsed.n).toBe(1);
    expect(typeof parsed.ts).toBe('string');
  });

  it('sends info/debug to stdout and warn/error to stderr', () => {
    const log = createLogger();
    log.info('i');
    log.debug('d');
    log.warn('w');
    log.error('e');
    // debug is below the default info level, so it is dropped.
    expect(out).toHaveLength(1);
    expect(err).toHaveLength(2);
  });

  it('honours LOG_LEVEL=debug', () => {
    process.env.LOG_LEVEL = 'debug';
    createLogger().debug('d');
    expect(out).toHaveLength(1);
  });

  it('drops lines below LOG_LEVEL', () => {
    process.env.LOG_LEVEL = 'error';
    const log = createLogger();
    log.info('i');
    log.warn('w');
    expect(out).toHaveLength(0);
    expect(err).toHaveLength(0);
  });

  it('expands an Error field to message + stack', () => {
    createLogger().error('boom', { err: new Error('kaboom') });
    const parsed = JSON.parse(err[0]);
    expect(parsed.err.message).toBe('kaboom');
    expect(parsed.err.stack).toContain('kaboom');
  });

  it('does not throw on a circular field (the whole point of the guard)', () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    expect(() => createLogger().info('circular', { circular })).not.toThrow();
    // Still emitted a valid line.
    expect(out).toHaveLength(1);
    expect(() => JSON.parse(out[0])).not.toThrow();
  });

  it('child() merges base fields into later lines', () => {
    const child = createLogger({ requestId: 'r1' }).child({ route: '/y' });
    child.info('hi', { extra: true });
    const parsed = JSON.parse(out[0]);
    expect(parsed.requestId).toBe('r1');
    expect(parsed.route).toBe('/y');
    expect(parsed.extra).toBe(true);
  });
});

describe('requestLogger', () => {
  let out: string[];
  let spy: { mockRestore(): void };

  beforeEach(() => {
    out = [];
    spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      out.push(String(chunk));
      return true;
    });
  });
  afterEach(() => spy.mockRestore());

  it('reuses an inbound x-request-id', () => {
    const req = new Request('http://t.local/api', { headers: { 'x-request-id': 'from-proxy' } });
    requestLogger(req, '/api/x').info('hi');
    expect(JSON.parse(out[0]).requestId).toBe('from-proxy');
  });

  it('generates an id when none is supplied', () => {
    const req = new Request('http://t.local/api');
    requestLogger(req, '/api/x').info('hi');
    const parsed = JSON.parse(out[0]);
    expect(parsed.requestId).toBeTruthy();
    expect(parsed.route).toBe('/api/x');
    expect(parsed.method).toBe('GET');
  });
});
