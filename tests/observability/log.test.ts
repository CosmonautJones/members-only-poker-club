import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { log } from '@/lib/observability/log';

let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function lastLogLine(): Record<string, unknown> {
  const calls = logSpy.mock.calls;
  const last = calls[calls.length - 1];
  if (!last) throw new Error('no log call');
  const arg = last[0];
  if (typeof arg !== 'string') throw new Error('expected string log line');
  return JSON.parse(arg) as Record<string, unknown>;
}

function lastErrorLine(): Record<string, unknown> {
  const calls = errorSpy.mock.calls;
  const last = calls[calls.length - 1];
  if (!last) throw new Error('no error call');
  const arg = last[0];
  if (typeof arg !== 'string') throw new Error('expected string error line');
  return JSON.parse(arg) as Record<string, unknown>;
}

describe('log / output shape', () => {
  it('emits a one-line JSON object on info', () => {
    log.info('hello');
    const line = lastLogLine();
    expect(line.level).toBe('info');
    expect(line.msg).toBe('hello');
    expect(typeof line.ts).toBe('string');
  });

  it('routes error to stderr', () => {
    log.error('boom');
    const line = lastErrorLine();
    expect(line.level).toBe('error');
  });

  it('routes warn to stdout (same channel as info)', () => {
    log.warn('careful');
    const line = lastLogLine();
    expect(line.level).toBe('warn');
  });
});

describe('log / PII redaction', () => {
  it('redacts known PII keys in fields', () => {
    log.info('login', { email: 'a@example.com', profile_id: 'p1' });
    const line = lastLogLine();
    const fields = line.fields as Record<string, unknown>;
    expect(fields.email).toBe('[redacted]');
    expect(fields.profile_id).toBe('p1');
  });

  it('redacts nested PII', () => {
    log.info('event', { user: { name: 'Alice', phone: '512-555' }, n: 5 });
    const line = lastLogLine();
    const fields = line.fields as Record<string, unknown>;
    expect((fields.user as Record<string, unknown>).phone).toBe('[redacted]');
    expect((fields.user as Record<string, unknown>).name).toBe('Alice');
  });

  it('omits fields when none provided', () => {
    log.info('plain');
    const line = lastLogLine();
    expect('fields' in line).toBe(false);
  });
});
