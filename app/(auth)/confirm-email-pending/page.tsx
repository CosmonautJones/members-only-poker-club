/**
 * `/confirm-email-pending` — post-signup "check your email" landing (ADR-0002, AC4).
 *
 * Server component. Redirected here from `signupAction` after Supabase
 * accepts the new account and emits the confirmation email. Reads the
 * `?email=` query param so we can echo it back to the user as a
 * reassurance ("we sent the link to <strong>x@y.com</strong>"). No
 * server-side state — purely informational.
 *
 * Next 14.2.x: `searchParams` is sync (plain object), not a Promise.
 */

type Props = {
  searchParams?: { email?: string };
};

export default function ConfirmEmailPendingPage({ searchParams }: Props) {
  const email = searchParams?.email ?? 'your inbox';
  return (
    <div>
      <h1>Check your email</h1>
      <p>
        We sent a confirmation link to <strong>{email}</strong>. Click it to finish signing up.
      </p>
    </div>
  );
}
