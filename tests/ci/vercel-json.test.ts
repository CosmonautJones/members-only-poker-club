import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('vercel.json', () => {
  it('exists at repo root with required fields', () => {
    const path = resolve(__dirname, '..', '..', 'vercel.json');
    const data = JSON.parse(readFileSync(path, 'utf8'));
    expect(data.framework).toBe('nextjs');
    expect(typeof data.installCommand).toBe('string');
    expect(data.installCommand.length).toBeGreaterThan(0);
    expect(typeof data.buildCommand).toBe('string');
    expect(data.buildCommand.length).toBeGreaterThan(0);
  });

  it('schedules the tournament materializer once nightly', () => {
    const path = resolve(__dirname, '..', '..', 'vercel.json');
    const data = JSON.parse(readFileSync(path, 'utf8'));

    // Vercel cron is UTC-only: 08:00 UTC is 03:00 CDT / 02:00 CST.
    // The one-hour winter shift is acceptable because the 60-day horizon is date-based.
    expect(data.crons).toEqual([
      {
        path: '/api/cron/tournament-materialize',
        schedule: '0 8 * * *',
      },
    ]);
  });
});
