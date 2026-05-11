'use server';

// All validation here is the SOURCE OF TRUTH. Do not assume any client-side
// filtering ran. The form is HTML-attribute decorated for UX hinting only;
// curl POSTs and JS-disabled clients can submit anything.
//
// FAIL-LOUD CONTRACT (ADR-0002 cycle 3 AC2 / Open Q resolution): when
// auth.signUp succeeds and the profiles INSERT fails, we log + return a
// generic FormError. We DO NOT retry, DO NOT detect, DO NOT attempt a
// second signUp. Orphan recovery is BOUND TO CYCLE 4 (ADR-0009 reaper).
// If you are tempted to "fix" the orphan window in this file, read
// .conductor/0002/dispatches/0008-premortem-t3.md Risk 4 first.

import { differenceInYears, formatISO, isValid, parseISO, startOfToday } from 'date-fns';
import { redirect } from 'next/navigation';

// eslint-disable-next-line no-restricted-imports -- per ADR-0002 AC2: signup action does the profiles INSERT via service-role admin client; the 'server-only' import is the build-time guard against client-bundle leakage.
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

export type FormError = {
  field: 'email' | 'password' | 'dob' | 'full_name' | 'form';
  message: string;
};

export async function signupAction(formData: FormData): Promise<FormError | undefined> {
  // Read inputs. Coerce explicitly — formData.get() returns
  // FormDataEntryValue | null and the action MUST handle the null shape.

  // Password is NEVER normalized (NIST 800-63B accepts trailing spaces;
  // any whitespace stripping silently weakens policy AND breaks
  // legitimate users whose real passwords end in spaces). Premortem
  // Risk 2 forbids whitespace-stripping of this value.
  const passwordEntry = formData.get('password');
  const password = typeof passwordEntry === 'string' ? passwordEntry : '';
  const dobEntry = formData.get('dob');
  const dob = typeof dobEntry === 'string' ? dobEntry : '';
  const fullNameEntry = formData.get('full_name');
  const fullName = typeof fullNameEntry === 'string' ? fullNameEntry : '';

  // Email gets lowercase + whitespace-stripped — case-insensitive
  // uniqueness is application-enforced this cycle (no functional index
  // yet) so the canonicalized value is what reaches both auth.signUp
  // and the profiles INSERT.
  const emailEntry = formData.get('email');
  const email = (typeof emailEntry === 'string' ? emailEntry : '').toLowerCase().trim();

  // DOB gate (21+). parseISO strictly parses YYYY-MM-DD; rejects
  // locale-ambiguous formats. The locale-dependent Date constructor
  // form is a TABC-license-risk footgun and is forbidden by static
  // source test (premortem Risk 1).
  const parsedDob = parseISO(dob);
  if (!isValid(parsedDob) || differenceInYears(startOfToday(), parsedDob) < 21) {
    return { field: 'dob', message: 'Members must be 21 or older.' };
  }

  // Password length (NIST 800-63B floor — 12 chars). Inline check; no
  // shared schema lib. Runs BEFORE any Supabase call.
  if (password.length < 12) {
    return { field: 'password', message: 'Password must be at least 12 characters.' };
  }

  // auth.signUp via the cookie-scoped server client. The lowercased email
  // reaches both signUp and the profiles INSERT — case-insensitive
  // uniqueness is application-enforced for this cycle.
  const supabase = createClient();
  const { data, error } = await supabase.auth.signUp({ email, password });

  if (error) {
    const code = (error as { code?: string }).code ?? '';
    const message = error.message ?? '';
    const looksLikeDuplicate =
      code === 'user_already_exists' ||
      /already|exists/i.test(code) ||
      /already|exists/i.test(message);
    if (looksLikeDuplicate) {
      // Spec ADR-0002 cycle 3 AC2 accepts that signup discloses email
      // existence via the field-level error. Do NOT add the email VALUE
      // to the message text — that converts the disclosure into a
      // confirmation oracle (premortem Risk 3).
      return { field: 'email', message: 'An account with this email already exists.' };
    }
    return { field: 'form', message: 'We could not create your account. Please try again.' };
  }

  const authUserId = data.user?.id;
  if (!authUserId) {
    // Defensive: signUp returned no error and no user. Treat as a form
    // failure rather than proceeding to a profiles INSERT with an
    // undefined id.
    return { field: 'form', message: 'We could not create your account. Please try again.' };
  }

  // TODO(cycle-4): wrap in withAudit per ADR-0006 + ADR-0009; orphan reaper handles recovery
  const admin = createAdminClient();
  const { error: insertError } = await admin.from('profiles').insert({
    id: authUserId,
    full_name: fullName,
    dob,
    email,
    role: 'member',
  });

  if (insertError) {
    // FAIL-LOUD: log structured payload with orphan auth.users.id so
    // support can manually clean up. Do NOT include email value (Sentry
    // retention is a PII concern — premortem Risk 3). Do NOT retry.
    // Do NOT redirect. Do NOT call signUp again.
    console.error({
      tag: 'signup.profile_insert_failed',
      auth_user_id: authUserId,
      supabase_error_code: insertError.code ?? 'unknown',
      timestamp: formatISO(Date.now()),
    });
    return {
      field: 'form',
      message: 'Account created, but we hit a snag finishing setup. Please contact support.',
    };
  }

  // Redirect lives OUTSIDE all try/catch. Next 14's redirect() throws the
  // NEXT_REDIRECT sentinel; wrapping it in try/catch would swallow it and
  // turn every successful signup into a false-failure (premortem Risk 10).
  // Static URL with encodeURIComponent — signup is NOT a redirect-target
  // boundary; `next` is NOT honored here (premortem Risk 9).
  redirect(`/confirm-email-pending?email=${encodeURIComponent(email)}`);
}
