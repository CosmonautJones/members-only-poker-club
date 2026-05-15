/**
 * Site audit 2026-05-15, P0 item #1 (content follow-up): /games.
 *
 * Replace the stub with cash games + tournament schedule + format guide.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const PAGE = path.resolve(__dirname, '..', '..', 'app', '(marketing)', 'games', 'page.tsx');

describe('/games content (audit P0 #1 follow-up)', () => {
  const src = readFileSync(PAGE, 'utf8');

  it('does NOT advertise itself as under construction', () => {
    expect(src).not.toMatch(/under construction/i);
  });

  it('lists the core NLHE stakes (1/2, 2/5, 5/10)', () => {
    expect(src).toMatch(/1\/2/);
    expect(src).toMatch(/2\/5/);
    expect(src).toMatch(/5\/10/);
  });

  it('lists at least one PLO game', () => {
    expect(src).toMatch(/PLO|Pot-Limit Omaha/i);
  });

  it('declares a weekly tournament schedule with named nights', () => {
    expect(src).toMatch(/tuesday/i);
    expect(src).toMatch(/friday/i);
    expect(src).toMatch(/saturday/i);
    expect(src).toMatch(/sunday/i);
  });

  it('explains a bounty tournament somewhere', () => {
    expect(src).toMatch(/bounty/i);
  });

  it('includes a format guide explaining NLHE / PLO for newer players', () => {
    expect(src).toMatch(/format/i);
    expect(src).toMatch(/no-limit hold/i);
  });

  it('still preserves the per-tournament link list (existing slug list)', () => {
    // The existing stub already imported TOURNAMENTS from fixtures; the
    // production page may or may not keep that exact pattern, but the
    // fixture-backed slugs should still be reachable from this page.
    // Tolerate either an explicit Link to /games/<slug> or the import.
    expect(src.includes('/games/') || src.includes('TOURNAMENTS')).toBe(true);
  });

  it('mentions the no-rake / tipping note', () => {
    expect(src).toMatch(/(no rake|tipping|tip)/i);
  });
});
