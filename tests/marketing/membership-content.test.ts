/**
 * Site audit 2026-05-15, P0 item #1 (content follow-up): /membership.
 *
 * Replace the "under construction" stub with real content covering:
 *  - pricing ($25/month dues, $12/hour seat-time, $200→$300 credit bonus)
 *  - the Texas legal framing (members-only, no rake)
 *  - benefits / application steps
 *  - links to /signup, /terms, /faq
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const PAGE = path.resolve(__dirname, '..', '..', 'app', '(marketing)', 'membership', 'page.tsx');

describe('/membership content (audit P0 #1 follow-up)', () => {
  const src = readFileSync(PAGE, 'utf8');

  it('does NOT advertise itself as under construction', () => {
    expect(src).not.toMatch(/under construction/i);
  });

  it('mentions the $25 monthly dues figure', () => {
    expect(src).toMatch(/\$25/);
  });

  it('mentions the $12/hour seat-time figure', () => {
    expect(src).toMatch(/\$12/);
  });

  it('mentions the $200 → $300 seat-time credit deal', () => {
    expect(src).toMatch(/\$200/);
    expect(src).toMatch(/\$300/);
  });

  it('mentions the no-rake legal framing', () => {
    expect(src).toMatch(/no rake/i);
  });

  it('links to /signup for the application CTA', () => {
    expect(src).toMatch(/href=["']\/signup["']/);
  });

  it('links to /terms and /faq for the teasers', () => {
    expect(src).toMatch(/href=["']\/terms["']/);
    expect(src).toMatch(/href=["']\/faq["']/);
  });

  it('describes the 24-hour review step of the application flow', () => {
    expect(src).toMatch(/twenty-four|24[\s-]?hour/i);
  });
});
