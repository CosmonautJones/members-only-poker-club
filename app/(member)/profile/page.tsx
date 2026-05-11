/**
 * Member profile page (ADR-0002, AC8).
 *
 * Server component. Read-only view of email + role this cycle —
 * no edit form (deferred). The (member) layout already gates
 * unauthenticated access; the null check below is a TypeScript
 * narrow, not a security boundary.
 */

import { getCurrentProfile } from '@/lib/auth/getCurrentProfile';

export default async function ProfilePage() {
  const profile = await getCurrentProfile();
  if (!profile) return null;

  return (
    <div>
      <h1>Profile</h1>
      <dl>
        <dt>Email</dt>
        <dd>{profile.email}</dd>
        <dt>Role</dt>
        <dd>{profile.role}</dd>
      </dl>
    </div>
  );
}
