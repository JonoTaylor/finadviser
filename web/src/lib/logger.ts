// Minimal structured logger.
//
// Emits one JSON object per line to stdout/stderr. That's what Vercel,
// Cloud Run, CloudWatch and friends all ingest natively, and unlike pino it
// works in the Next.js Edge runtime (used by our middleware) because it
// doesn't touch Node streams. When we need richer features (log-level
// filtering, transport, sampling) we can swap the implementation without
// changing the call sites.

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogFields {
  [key: string]: unknown;
}

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function thresholdFromEnv(): number {
  const raw = (process.env.LOG_LEVEL ?? 'info').toLowerCase();
  return LEVELS[raw as LogLevel] ?? LEVELS.info;
}

function emit(level: LogLevel, message: string, fields: LogFields) {
  if (LEVELS[level] < thresholdFromEnv()) return;
  const record = {
    level,
    time: new Date().toISOString(),
    message,
    ...fields,
  };
  const line = JSON.stringify(record);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const log = {
  debug: (message: string, fields: LogFields = {}) => emit('debug', message, fields),
  info: (message: string, fields: LogFields = {}) => emit('info', message, fields),
  warn: (message: string, fields: LogFields = {}) => emit('warn', message, fields),
  error: (message: string, fields: LogFields = {}) => emit('error', message, fields),
};

export function newRequestId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
