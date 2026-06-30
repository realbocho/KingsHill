/**
 * Structured JSON logger. In production this writes to stdout, which
 * Vercel automatically captures and makes searchable/alertable in its
 * log dashboard. Each call is one JSON line — easy to pipe into any
 * external log sink (Logtail, Axiom, Datadog) later without code changes.
 */

type Level = 'debug' | 'info' | 'warn' | 'error';

interface LogFields {
  [key: string]: unknown;
}

function emit(level: Level, message: string, fields?: LogFields) {
  const entry = {
    level,
    message,
    time: new Date().toISOString(),
    ...fields,
  };

  const line = JSON.stringify(entry);

  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (message: string, fields?: LogFields) => {
    if (process.env.NODE_ENV !== 'production') emit('debug', message, fields);
  },
  info:  (message: string, fields?: LogFields) => emit('info', message, fields),
  warn:  (message: string, fields?: LogFields) => emit('warn', message, fields),
  error: (message: string, fields?: LogFields) => emit('error', message, fields),
};

/** Wraps a known error or unknown thrown value into loggable fields. */
export function errorFields(err: unknown): LogFields {
  if (err instanceof Error) {
    return { error: err.message, stack: err.stack };
  }
  return { error: String(err) };
}
