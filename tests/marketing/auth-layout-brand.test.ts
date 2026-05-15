/**
 * Site audit 2026-05-15, P1 item #7: branded auth layout.
 *
 * Currently `app/(auth)/layout.tsx` renders plain "Poker Club" text in
 * the corner. Replace with `<Chip />` + `<Wordmark />` so /signup and
 * /login carry the same brand mark as every other page.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const AUTH_LAYOUT = path.resolve(__dirname, '..', '..', 'app', '(auth)', 'layout.tsx');

describe('auth layout brand mark (audit P1 #7)', () => {
  const src = readFileSync(AUTH_LAYOUT, 'utf8');

  it('imports Chip and Wordmark from marketing/primitives', () => {
    expect(src).toMatch(/from\s+['"]@\/components\/marketing\/primitives['"]/);
    expect(src).toMatch(/\bChip\b/);
    expect(src).toMatch(/\bWordmark\b/);
  });

  it('still routes the home link to /', () => {
    expect(src).toMatch(/href=["']\/["']/);
  });

  it('still includes the "Back to site" escape hatch (AC8 contract)', () => {
    expect(src).toMatch(/Back to site/);
  });
});
