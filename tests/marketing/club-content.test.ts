/**
 * Site audit 2026-05-15, P0 item #1 (content follow-up): /club.
 *
 * Replace the stub with The Room / House Rules / Dress Code content.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const PAGE = path.resolve(__dirname, '..', '..', 'app', '(marketing)', 'club', 'page.tsx');

describe('/club content (audit P0 #1 follow-up)', () => {
  const src = readFileSync(PAGE, 'utf8');

  it('does NOT advertise itself as under construction', () => {
    expect(src).not.toMatch(/under construction/i);
  });

  it('describes the room (15 tables, Copag cards, trained dealers)', () => {
    // Owner correction 2026-05-15: 15 tables, not 12. Asserting the
    // spelled-out word ("fifteen") rather than the digits — the page
    // styles use raw numbers like `fontSize: 15` that would false-positive
    // a `/15/` regex. Brand voice spells out small numbers anyway.
    expect(src).toMatch(/fifteen/i);
    expect(src).toMatch(/copag/i);
    expect(src).toMatch(/dealer/i);
  });

  it('declares a dress code section', () => {
    expect(src).toMatch(/dress code/i);
  });

  it('declares a house rules section (mentioning TDA)', () => {
    expect(src).toMatch(/house rules/i);
    expect(src).toMatch(/TDA/);
  });

  it('mentions the venue location (North Houston / North Freeway)', () => {
    expect(src).toMatch(/(North Freeway|North Houston|77090)/i);
  });

  it('mentions BYOB policy and the kitchen', () => {
    // Owner correction 2026-05-15: no liquor license yet — site reflects
    // BYOB policy until TABC approves. The canonical voice for the
    // policy lives in app/(marketing)/faq/page.tsx ("Is the bar BYOB?").
    expect(src).toMatch(/BYOB/);
    expect(src).toMatch(/(kitchen|menu)/i);
  });

  it('links to /terms for the full house rules', () => {
    expect(src).toMatch(/href=["']\/terms["']/);
  });
});
