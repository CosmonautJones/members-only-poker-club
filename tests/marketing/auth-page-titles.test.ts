/**
 * Site audit 2026-05-15, P2 item #10: per-page titles for /signup and /login.
 *
 * Both pages currently fall through to the root layout default title.
 * Adding `export const metadata` with a distinct `title` field fills the
 * layout's `%s · Members Only Poker Social Club` template properly.
 *
 * Source-grep approach: the auth pages import `./actions.ts` server
 * actions which transitively pull in `server-only`, so a dynamic
 * import() under vitest throws "module cannot be imported from a Client
 * Component module." Asserting the metadata export structurally avoids
 * the import path entirely. Mirrors `tests/auth/auth-layout.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const SIGNUP = path.resolve(__dirname, '..', '..', 'app', '(auth)', 'signup', 'page.tsx');
const LOGIN = path.resolve(__dirname, '..', '..', 'app', '(auth)', 'login', 'page.tsx');

describe('auth-page metadata (audit P2 #10)', () => {
  it.each([
    ['signup', SIGNUP, /title:\s*['"]Apply for Membership['"]/],
    ['login', LOGIN, /title:\s*['"]Member Sign In['"]/],
  ])('/%s declares `export const metadata` with a non-empty title', (_name, file, titleRe) => {
    const src = readFileSync(file, 'utf8');
    expect(src).toMatch(/export\s+const\s+metadata\s*:/);
    expect(src).toMatch(titleRe);
  });
});
