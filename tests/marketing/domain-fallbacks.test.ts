/**
 * Site audit 2026-05-15, follow-up note: NEXT_PUBLIC_APP_URL fallbacks.
 *
 * `app/sitemap.ts`, `app/robots.ts`, and `app/layout.tsx` still default
 * to the retired `membersonlypoker.com` domain. The live domain (post
 * DNS cutover) is `membersonlypokersocial.com`. Update the fallback in
 * all three files.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const FILES = [
  path.join(REPO_ROOT, 'app', 'sitemap.ts'),
  path.join(REPO_ROOT, 'app', 'robots.ts'),
  path.join(REPO_ROOT, 'app', 'layout.tsx'),
];

describe('NEXT_PUBLIC_APP_URL fallback (audit follow-up)', () => {
  it.each(FILES)('%s uses membersonlypokersocial.com as fallback', (file) => {
    const src = readFileSync(file, 'utf8');
    expect(src).toMatch(/membersonlypokersocial\.com/);
  });

  it.each(FILES)('%s does NOT reference the retired domain', (file) => {
    const src = readFileSync(file, 'utf8');
    // The retired domain literal is `membersonlypoker.com` — the live
    // domain is `membersonlypokersocial.com`, which does NOT contain the
    // retired domain as a substring (the "k" is followed by "s", not ".").
    // A plain regex is sufficient.
    expect(src).not.toMatch(/membersonlypoker\.com/);
  });
});
