'use server';

// Reset-password server action (ADR-0002, AC4).
//
// Runs after the page-level verifyOtp() set the recovery session
// cookie. We DO NOT trim the password (NIST 800-63B accepts trailing
// spaces; trimming silently weakens policy). We DO server-side
// re-verify password >= 12 chars and confirmPassword equality — the
// HTML attributes on the form are UX hints only.

import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';

export type FormError = {
  field: 'password' | 'confirmPassword' | 'form';
  message: string;
};

export async function resetPasswordAction(formData: FormData): Promise<FormError | undefined> {
  const passwordEntry = formData.get('password');
  const password = typeof passwordEntry === 'string' ? passwordEntry : '';
  const confirmPasswordEntry = formData.get('confirmPassword');
  const confirmPassword = typeof confirmPasswordEntry === 'string' ? confirmPasswordEntry : '';

  // Order: confirm-match BEFORE length so a typo with a >=12-char
  // password surfaces the more useful error first.
  if (password !== confirmPassword) {
    return {
      field: 'confirmPassword',
      message: 'Passwords do not match.',
    };
  }

  if (password.length < 12) {
    return {
      field: 'password',
      message: 'Password must be at least 12 characters.',
    };
  }

  const supabase = createClient();
  const { error } = await supabase.auth.updateUser({ password });

  if (error) {
    // Don't enumerate Supabase update errors. If the recovery session
    // expired between page render and form submit, the most useful
    // next step is "request a fresh reset link".
    return {
      field: 'form',
      message: 'Could not update password. Please request a new reset link.',
    };
  }

  // Redirect lives OUTSIDE any try/catch. Next 14's redirect() throws
  // the NEXT_REDIRECT sentinel; wrapping it would swallow the
  // sentinel.
  redirect('/dashboard');
}
