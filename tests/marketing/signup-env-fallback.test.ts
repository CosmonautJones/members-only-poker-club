/**
 * Owner bug report 2026-05-15: production /signup throws "Application
 * error: a server-side exception has occurred" (digest 3888338328) when
 * the form is submitted. Root cause: `NEXT_PUBLIC_SUPABASE_URL` /
 * `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` are not
 * configured on Vercel yet (the project's external-trigger blocker
 * tracked in memory:project_implementation_queue). `lib/supabase/server.ts`
 * and `lib/supabase/admin.ts` throw on missing env — those throws
 * bubble out of the server action and Next.js renders the production
 * error fallback.
 *
 * Pre-config fix: detect missing env at SSR time on /signup and render
 * a graceful "Applications opening soon" panel instead of the form.
 * The form is non-functional without Supabase anyway — showing it lets
 * users fill in a form that will only crash on submit.
 *
 * Real fix: configure the Supabase env vars on Vercel. Once they're
 * present, the page automatically reverts to rendering the form.
 *
 * Source-grep contract: the page module must
 *  (a) read `process.env.NEXT_PUBLIC_SUPABASE_URL` at SSR,
 *  (b) branch on whether it's set / non-placeholder,
 *  (c) render an "opening soon" / "not yet accepting" message when not set.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const SIGNUP_PAGE = path.resolve(
  __dirname,
  '..',
  '..',
  'app',
  '(auth)',
  'signup',
  'page.tsx',
);

describe('/signup graceful fallback when Supabase env is unconfigured', () => {
  const src = readFileSync(SIGNUP_PAGE, 'utf8');

  it('reads NEXT_PUBLIC_SUPABASE_URL at render time', () => {
    expect(src).toMatch(/process\.env\.(?:\[['"])?NEXT_PUBLIC_SUPABASE_URL/);
  });

  it('renders a fallback panel that does NOT include the signup form when env is missing', () => {
    // Cheap structural assertion: when the page detects missing/
    // placeholder env, it should NOT include the <form action={signupAction}>
    // markup in that branch. Easiest pin: a literal copy string that
    // only appears in the fallback branch.
    expect(src).toMatch(/Applications opening soon|opening soon|not yet accepting/i);
  });

  it('still references signupAction (live form path preserved)', () => {
    // The live-form path must remain available; this guards against a
    // future PR that accidentally deletes the form branch entirely.
    expect(src).toMatch(/signupAction/);
  });
});
