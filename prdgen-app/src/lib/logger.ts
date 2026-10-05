/**
 * Structured logger.
 *
 * Emits one JSON object per line so logs are greppable and machine-parsable,
 * and carries a per-request id so every line from one request can be grouped
 * (the streaming routes log several lines across seconds — provider chosen,
 * attempt failed, section persisted — and without an id those lines are
 * impossible to correlate).
 *
 * Output goes to stdout/stderr, matching what hosting platforms collect.
 * Level is controlled by LOG_LEVEL (debug|info|warn|error); default info.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function activeLevel(): LogLevel {
  const raw = (process.env.LOG_LEVEL ?? 'info').toLowerCase();
  return (raw in LEVEL_ORDER ? raw : 'info') as LogLevel;
}

/** Fields attached to every line. Values are serialized, never interpolated. */
export type LogFields = Record<string, unknown>;

/**
 * Pull a short, non-identifying prefix out of a request for correlation when
 * the caller has no explicit id. Not a real id — just enough to group lines
 * from one request in a single-process log.
 */
function fallbackRequestId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function emit(level: LogLevel, message: string, fields?: LogFields): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[activeLevel()]) return;

  const line: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...fields,
  };

  // An Error in `err` is expanded to its message + stack; everything else is
  // passed through `JSON.stringify`, which drops functions and symbols safely.
  if (fields?.err instanceof Error) {
    line.err = { name: fields.err.name, message: fields.err.message, stack: fields.err.stack };
  }

  let serialized: string;
  try {
    serialized = JSON.stringify(line);
  } catch {
    // Circular reference in fields — never let logging throw into a request.
    serialized = JSON.stringify({ ts: line.ts, level, msg: message, note: 'unserializable fields' });
  }

  if (level === 'error' || level === 'warn') process.stderr.write(serialized + '\n');
  else process.stdout.write(serialized + '\n');
}

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  /** A logger with extra fields merged into every line (e.g. requestId, route). */
  child(fields: LogFields): Logger;
}

/** Create a logger; pass base fields (requestId, route) to tag every line. */
export function createLogger(base: LogFields = {}): Logger {
  const withBase = (fields?: LogFields) => ({ ...base, ...fields });

  return {
    debug: (m, f) => emit('debug', m, withBase(f)),
    info: (m, f) => emit('info', m, withBase(f)),
    warn: (m, f) => emit('warn', m, withBase(f)),
    error: (m, f) => emit('error', m, withBase(f)),
    child: (fields) => createLogger({ ...base, ...fields }),
  };
}

/**
 * Logger bound to one request. Prefers an inbound `x-request-id` (so an
 * upstream proxy's id is preserved) and generates one otherwise.
 */
export function requestLogger(req: Request, route: string): Logger {
  const inbound = req.headers.get('x-request-id')?.slice(0, 64);
  return createLogger({ requestId: inbound || fallbackRequestId(), route, method: req.method });
}

/** Root logger for module-level use. */
export const logger = createLogger();
