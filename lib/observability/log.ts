/**
 * Structured logger — ADR-0014.
 *
 * One-line JSON output. PII redaction applied to `fields` via
 * `lib/observability/redact.ts` before serialization. The Vercel log
 * drain captures stdout/stderr in JSON-friendly form; this logger emits
 * lines that the drain can parse without further structuring.
 *
 * Levels: info / warn / error. Each level writes to a deterministic
 * stream so log shippers can route by severity:
 *   - info, warn → stdout
 *   - error      → stderr
 */
import { redactPii } from './redact';

export type LogLevel = 'info' | 'warn' | 'error';

interface LogLine {
  ts: string;
  level: LogLevel;
  msg: string;
  // eslint-disable-next-line @typescript-eslint/no-duplicate-type-constituents
  fields?: Record<string, unknown> | undefined;
}

function emit(level: LogLevel, msg: string, fields?: Record<string, unknown>): void {
  const line: LogLine = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...(fields !== undefined ? { fields: redactPii(fields) as Record<string, unknown> } : {}),
  };
  const serialized = JSON.stringify(line);
  if (level === 'error') {
    // eslint-disable-next-line no-console
    console.error(serialized);
  } else {
    // eslint-disable-next-line no-console
    console.log(serialized);
  }
}

export const log = {
  info(msg: string, fields?: Record<string, unknown>): void {
    emit('info', msg, fields);
  },
  warn(msg: string, fields?: Record<string, unknown>): void {
    emit('warn', msg, fields);
  },
  error(msg: string, fields?: Record<string, unknown>): void {
    emit('error', msg, fields);
  },
};
