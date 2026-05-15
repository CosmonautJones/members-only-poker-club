/**
 * Site audit 2026-05-15, P1 item #6 + owner update 2026-05-15: /contact hours.
 *
 * Original audit asked for the hours table to be reachable from
 * `/contact` (the footer "Hours" link target). Owner correction the
 * same day: the club operates **24/7**, so the day-by-day table was
 * replaced with a single "Open. Always." block. This test pins the new
 * contract: an `id="hours"` anchor must still exist (footer link target),
 * the copy must declare 24/7 in some form, and the address block must
 * still render.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const CONTACT = path.resolve(__dirname, '..', '..', 'app', '(marketing)', 'contact', 'page.tsx');

describe('/contact hours block (audit P1 #6 + 24/7 update)', () => {
  const src = readFileSync(CONTACT, 'utf8');

  it('keeps an id="hours" anchor for the footer link target', () => {
    expect(src).toMatch(/id=["']hours["']/);
  });

  it('declares 24/7 hours in some readable form', () => {
    // Tolerate any of: "24/7", "24-7", "24 7", "always open", "never close".
    expect(src).toMatch(/24[\s/-]?7|always open|never close/i);
  });

  it('still renders the address (existing content preserved)', () => {
    expect(src).toMatch(/streetAddress|address/);
  });
});
