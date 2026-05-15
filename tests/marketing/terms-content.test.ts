/**
 * Site audit 2026-05-15, P0 item #1 (content follow-up): /terms.
 *
 * Replace the stub with the Member Agreement: membership terms, code of
 * conduct, house rules, expulsion grounds, dispute resolution, liability.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const PAGE = path.resolve(__dirname, '..', '..', 'app', '(marketing)', 'terms', 'page.tsx');

describe('/terms content (audit P0 #1 follow-up)', () => {
  const src = readFileSync(PAGE, 'utf8');

  it('does NOT advertise itself as under construction', () => {
    expect(src).not.toMatch(/under construction/i);
  });

  it('contains a Membership article', () => {
    expect(src).toMatch(/membership/i);
    expect(src).toMatch(/dues|auto-renew/i);
  });

  it('contains a Code of Conduct section', () => {
    expect(src).toMatch(/code of conduct/i);
  });

  it('contains an Expulsion / grounds-for-removal section', () => {
    expect(src).toMatch(/(expulsion|expel|termination|grounds)/i);
    expect(src).toMatch(/cheating/i);
    expect(src).toMatch(/collusion/i);
  });

  it('contains a Dispute Resolution section with Texas venue', () => {
    expect(src).toMatch(/dispute/i);
    expect(src).toMatch(/(arbitration|harris county|texas)/i);
  });

  it('contains a liability / assumption-of-risk section', () => {
    expect(src).toMatch(/(liability|assumption of risk|premises)/i);
  });

  it('links to /privacy for the full privacy policy', () => {
    expect(src).toMatch(/href=["']\/privacy["']/);
  });

  it('mentions TDA (Tournament Directors Association)', () => {
    expect(src).toMatch(/TDA|Tournament Directors Association/);
  });
});
