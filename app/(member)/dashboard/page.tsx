/**
 * Member dashboard (ADR-0002, AC8).
 *
 * Server component. The (member) layout already redirects to /login
 * when there's no profile; this page assumes a profile exists but
 * narrows defensively for TypeScript.
 *
 * Logout is a `<form method="post" action="/logout">` — NOT an `<a>`
 * link — to require a same-origin POST and defend against CSRF link
 * attacks (ADR-0002 logout contract; see app/(auth)/logout/route.ts).
 */

import { getCurrentProfile } from '@/lib/auth/getCurrentProfile';

export default async function DashboardPage() {
  const profile = await getCurrentProfile();
  // The (member) layout already redirected if profile is null,
  // but TypeScript doesn't know that. Defensive narrow:
  if (!profile) return null;

  return (
    <div>
      <h1>Hello {profile.full_name}, member number pending verification</h1>
      <form method="post" action="/logout">
        <button type="submit">Sign out</button>
      </form>
    </div>
  );
}
