/**
 * Site audit 2026-05-15, P0 item #1: hero CTA destination unification.
 *
 * The home hero's "Apply for Membership" button currently points at
 * `/membership` (a stub) while the secondary CTA already points at
 * `/signup`. Both should target `/signup` so the most-clicked path is
 * never a dead end.
 *
 * Source-grep check (no Next runtime mount): the home page module's
 * source must contain `<Link href="/signup">…Apply for Membership…</Link>`
 * for the hero CTA and must NOT route the hero "Apply for Membership"
 * button to `/membership`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const HOME_PAGE = path.resolve(__dirname, '..', '..', 'app', '(marketing)', 'page.tsx');

describe('home hero CTA target (audit P0 #1)', () => {
  it('hero "Apply for Membership" link targets /signup', () => {
    const src = readFileSync(HOME_PAGE, 'utf8');
    // Find every Apply for Membership Link/href pair and assert it points at /signup.
    const matches = src.matchAll(/href=["']([^"']+)["'][^>]*>\s*Apply for Membership/gi);
    const hrefs = Array.from(matches, (m) => m[1]);
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(href).toBe('/signup');
    }
  });

  it('home page does NOT route any visible CTA at /membership', () => {
    const src = readFileSync(HOME_PAGE, 'utf8');
    // Allow `/membership` to appear in metadata or comments, but no
    // Link/anchor href should resolve to it from the home page hero.
    expect(src).not.toMatch(/href=["']\/membership["']/);
  });
});
