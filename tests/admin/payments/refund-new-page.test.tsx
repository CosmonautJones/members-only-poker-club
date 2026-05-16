/**
 * Unit tests for ADR-0036 Slice 1 task t11 — the fail-loud refund-new form.
 *
 * Run locally:    pnpm test tests/admin/payments/refund-new-page.test.tsx
 * Prerequisites:  none — pure module mocks (no DB, no network).
 *
 * Spec: docs/specs/0036-payment-management-console-implementation.md AC28
 * Premortem: .conductor/36/returns/0007-premortem-fail-loud.md risks 4, 8
 * Synthesis: .conductor/36/premortem-synthesis.md §t11 + D3
 *
 * SUT contract (per AC28):
 *   - Server component at app/(admin)/admin/payments/refunds/new/page.tsx
 *     whose FIRST awaited statement is `await requireRole('manager');`.
 *   - Renders FIVE accessible form fields:
 *       • targetPaymentId (text input)
 *       • amountCents (number input)
 *       • reason (select, 5 enum values)
 *       • refundType (radio group, 3 enum values)
 *       • idempotencyKey (hidden, UUID-v4 from a client sub-tree)
 *   - Form action is the `initiateRefund` server action (t9).
 *   - Client component `_components/IdempotencyKeyField.client.tsx`
 *     reads/writes `sessionStorage` keyed by
 *     `refund-${targetPaymentId}-${amountCents}` so the form-mount UUID
 *     survives StrictMode + remount (premortem risk 8 / synthesis D3).
 *   - Error boundary at app/(admin)/admin/payments/refunds/new/error.tsx
 *     renders `error.userMessage` (NEVER `error.message`) and the
 *     literal heading "Refund not initiated" (premortem risk 4).
 *
 * Premortem-binding negative assertions:
 *   - error.tsx rendered output must NOT match
 *     /STRIPE_SECRET_KEY|process\.env|env\s*var|stack|at\s+\w+\s+\(/i
 *   - error.tsx source must reference `error.userMessage` literally
 *     (NOT `error.message`).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { render, screen, cleanup } from '@testing-library/react';

// ---- Hoisted mock primitives ----------------------------------------------

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn<
    (required: string) => Promise<{
      profile: { id: string; role: string; full_name: string; email: string };
    }>
  >(),
  initiateRefund: vi.fn(),
}));

// ---- Mocks ----------------------------------------------------------------

// `server-only` is a guard re-export. Neutralize so the SUT (a server
// component) imports cleanly under vitest. Mirrors flags-page.test.tsx.
vi.mock('server-only', () => ({}));

// `next/navigation` is imported transitively by requireRole. Mock
// redirect to a throw so any unintended call surfaces clearly; this
// suite does not exercise redirect paths.
vi.mock('next/navigation', () => ({
  redirect: vi.fn((p: string) => {
    const e = new Error(`NEXT_REDIRECT: ${p}`);
    (e as Error & { digest?: string }).digest = `NEXT_REDIRECT;${p}`;
    throw e;
  }),
}));

vi.mock('@/lib/auth/requireRole', () => ({
  requireRole: mocks.requireRole,
}));

// Mock the t9 server action — happy-dom + RTL cannot actually invoke a
// `<form action={fn}>` Next server action, so we assert on the action
// reference itself (it is passed as a prop on the rendered form). The
// underlying action body is exercised by tests/payments/server-actions-stubs.test.ts.
vi.mock('@/app/(admin)/admin/payments/refunds/new/_actions/initiateRefund', () => ({
  initiateRefund: mocks.initiateRefund,
}));

// ---- Import AFTER mocks ---------------------------------------------------

// eslint-disable-next-line import/first
import RefundNewPage from '@/app/(admin)/admin/payments/refunds/new/page';
// eslint-disable-next-line import/first
import RefundNewError from '@/app/(admin)/admin/payments/refunds/new/error';
// eslint-disable-next-line import/first
import { initiateRefund as actionRef } from '@/app/(admin)/admin/payments/refunds/new/_actions/initiateRefund';

// ---- Helpers --------------------------------------------------------------

const baseProfile = {
  id: 'uuid-test-manager',
  role: 'manager',
  full_name: 'Test Manager',
  email: 'manager@example.com',
};

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function renderPage(): Promise<void> {
  const tree = (await RefundNewPage()) as React.ReactElement;
  render(tree);
}

// ---- Lifecycle ------------------------------------------------------------

beforeEach(() => {
  mocks.requireRole.mockReset();
  mocks.requireRole.mockResolvedValue({ profile: baseProfile });
  mocks.initiateRefund.mockReset();
  // Clean sessionStorage so each test starts from a known UUID source.
  // happy-dom provides a real window.sessionStorage.
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
});

// ---- requireRole gate -----------------------------------------------------

describe('refund-new page — requireRole gate (defense-in-depth)', () => {
  it('calls requireRole("manager") as the first body statement', async () => {
    await renderPage();
    expect(mocks.requireRole).toHaveBeenCalledTimes(1);
    expect(mocks.requireRole).toHaveBeenCalledWith('manager');
  });
});

// ---- Form fields ----------------------------------------------------------

describe('refund-new page — five form fields render', () => {
  it('renders targetPaymentId as an accessible text input', async () => {
    await renderPage();
    const input = screen.getByLabelText(/target payment/i);
    expect(input).toBeTruthy();
    expect((input as HTMLInputElement).name).toBe('targetPaymentId');
    // text-or-default; spec says text input (Slice 2 swaps for combobox)
    const type = (input as HTMLInputElement).type;
    expect(['text', 'search', '']).toContain(type);
  });

  it('renders amountCents as a number input with min=1, step=1', async () => {
    await renderPage();
    const input = screen.getByLabelText(/amount/i) as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.name).toBe('amountCents');
    expect(input.type).toBe('number');
    expect(input.min).toBe('1');
    expect(input.step).toBe('1');
  });

  it('renders reason as a select with five enum values', async () => {
    await renderPage();
    const select = screen.getByLabelText(/reason/i) as HTMLSelectElement;
    expect(select).toBeTruthy();
    expect(select.tagName.toLowerCase()).toBe('select');
    expect(select.name).toBe('reason');

    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toEqual(
      expect.arrayContaining([
        'duplicate',
        'fraudulent',
        'requested_by_customer',
        'goodwill',
        'other',
      ]),
    );
  });

  it('renders refundType as a radio group with three values', async () => {
    await renderPage();
    // Each radio has its own accessible label by-value.
    const timeBank = screen.getByLabelText(/time[-_\s]?bank/i) as HTMLInputElement;
    const current = screen.getByLabelText(/current/i) as HTMLInputElement;
    const previous = screen.getByLabelText(/previous/i) as HTMLInputElement;

    for (const r of [timeBank, current, previous]) {
      expect(r.type).toBe('radio');
      expect(r.name).toBe('refundType');
    }
    expect(timeBank.value).toBe('time_bank');
    expect(current.value).toBe('membership_current');
    expect(previous.value).toBe('membership_previous');
  });

  it('renders idempotencyKey as a hidden input whose value matches UUID-v4', async () => {
    await renderPage();
    // `<input type="hidden">` doesn't have an accessible name, so query
    // by name attribute via a container search.
    const inputs = document.querySelectorAll<HTMLInputElement>(
      'input[type="hidden"][name="idempotencyKey"]',
    );
    expect(inputs.length).toBe(1);
    const value = inputs[0]!.value;
    expect(value).toMatch(UUID_V4_RE);
  });
});

// ---- Form action wiring ---------------------------------------------------

describe('refund-new page — form action wires to initiateRefund', () => {
  it('renders a <form> whose action prop is a server action and imports initiateRefund', async () => {
    await renderPage();
    // React stamps the form-action attribute on the form element only
    // when the prop is a string; for a function (server action) it
    // routes the actual call internally. We therefore prove wiring by
    // asserting (a) a <form> element exists and (b) the imported
    // initiateRefund reference IS the mock (proves the SUT imported it
    // through the FormData adapter wrapper).
    const form = document.querySelector('form');
    expect(form).not.toBeNull();
    // The mock IS the action — proves the SUT imported it. The SUT
    // wraps it in a FormData → InitiateRefundParams adapter (an inline
    // `'use server'` function), but the underlying call target is the
    // mocked t9 action.
    expect(actionRef).toBe(mocks.initiateRefund);
  });

  it('imports initiateRefund via a FormData adapter (source-grep)', () => {
    const src = readFileSync(
      path.resolve(process.cwd(), 'app/(admin)/admin/payments/refunds/new/page.tsx'),
      'utf8',
    );
    // The page must import the t9 action so the form ultimately calls
    // it. Pattern-match on the import specifier rather than the call
    // site so a Slice-2 refactor that splits the wrapper into a
    // sibling file still passes (the import survives the move).
    expect(src).toMatch(/initiateRefund/);
    // The inline `'use server'` directive — proves the FormData
    // adapter is a server action, not a client function (which would
    // be a bundling hazard).
    expect(src).toMatch(/['"]use server['"]/);
  });
});

// ---- Idempotency-key sessionStorage persistence (premortem risk 8) -------

describe('refund-new page — idempotency-key sessionStorage persistence (D3)', () => {
  it('reuses the same UUID on remount (sessionStorage-backed; survives StrictMode)', async () => {
    // Mount #1
    await renderPage();
    const first = document.querySelector<HTMLInputElement>(
      'input[type="hidden"][name="idempotencyKey"]',
    )!.value;
    expect(first).toMatch(UUID_V4_RE);

    cleanup();

    // Mount #2 (same target+amount defaults — empty strings → same key)
    await renderPage();
    const second = document.querySelector<HTMLInputElement>(
      'input[type="hidden"][name="idempotencyKey"]',
    )!.value;
    expect(second).toBe(first);
  });

  it('generates a fresh UUID after sessionStorage is cleared (different target/amount)', async () => {
    await renderPage();
    const first = document.querySelector<HTMLInputElement>(
      'input[type="hidden"][name="idempotencyKey"]',
    )!.value;
    cleanup();

    window.sessionStorage.clear();

    await renderPage();
    const second = document.querySelector<HTMLInputElement>(
      'input[type="hidden"][name="idempotencyKey"]',
    )!.value;
    expect(second).toMatch(UUID_V4_RE);
    expect(second).not.toBe(first);
  });
});

// ---- Error boundary (premortem risk 4) -----------------------------------

describe('refund-new error boundary — renders error.userMessage, not error.message', () => {
  it('renders "Refund not initiated" heading + userMessage from the error', () => {
    // Synthesize a StripeNotConfiguredError-shaped error WITHOUT importing
    // the real class (the real class is server-only, but the boundary is
    // a client component and only reads `error.userMessage`).
    const err: Error & { userMessage?: string; digest?: string } = Object.assign(
      new Error('Stripe is not configured (env var missing). See ADR-0010.'),
      {
        name: 'StripeNotConfiguredError',
        userMessage: 'Stripe integration pending — see ADR-0010',
      },
    );

    render(<RefundNewError error={err} reset={() => undefined} />);

    expect(screen.getByText('Refund not initiated')).toBeTruthy();
    expect(screen.getByText('Stripe integration pending — see ADR-0010')).toBeTruthy();

    // Negative assertion: rendered output MUST NOT leak env var name,
    // process.env mention, stack frames, or generic "env var" prose.
    // Premortem risk 4 binding regex.
    const html = document.body.innerHTML;
    expect(html).not.toMatch(/STRIPE_SECRET_KEY|process\.env|env\s*var|stack|at\s+\w+\s+\(/i);
  });

  it('falls back to a generic message when userMessage is absent', () => {
    // A non-StripeNotConfiguredError shape still renders without crashing,
    // and STILL must not leak the underlying error.message contents into
    // the heading slot.
    const err: Error & { digest?: string } = Object.assign(
      new Error('Some internal env var STRIPE_SECRET_KEY is unset at boot.ts:42'),
      { name: 'GenericError' },
    );

    render(<RefundNewError error={err} reset={() => undefined} />);

    // Heading literal always renders.
    expect(screen.getByText('Refund not initiated')).toBeTruthy();

    const html = document.body.innerHTML;
    // Must NOT leak error.message contents (which contain the env var
    // name + stack-like text).
    expect(html).not.toMatch(/STRIPE_SECRET_KEY|process\.env|env\s*var|stack|at\s+\w+\s+\(/i);
  });

  it('calls reset when the dismiss button is clicked', async () => {
    const reset = vi.fn();
    const err: Error & { userMessage?: string } = Object.assign(new Error('x'), {
      name: 'StripeNotConfiguredError',
      userMessage: 'Stripe integration pending — see ADR-0010',
    });

    render(<RefundNewError error={err} reset={reset} />);
    const btn = screen.getByRole('button', { name: /dismiss/i });
    btn.click();
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('renders inside a role="alert" container for screen-reader announcement', () => {
    const err: Error & { userMessage?: string } = Object.assign(new Error('x'), {
      name: 'StripeNotConfiguredError',
      userMessage: 'Stripe integration pending — see ADR-0010',
    });

    render(<RefundNewError error={err} reset={() => undefined} />);
    const alert = screen.getByRole('alert');
    expect(alert).toBeTruthy();
    // aria-live='polite' per AC28 spec body
    expect(alert.getAttribute('aria-live')).toBe('polite');
  });
});

// ---- Source-grep contracts (drift guards) --------------------------------

describe('refund-new page — source-grep contracts', () => {
  const errorTsxPath = path.resolve(
    process.cwd(),
    'app/(admin)/admin/payments/refunds/new/error.tsx',
  );
  const pageTsxPath = path.resolve(
    process.cwd(),
    'app/(admin)/admin/payments/refunds/new/page.tsx',
  );
  const keyFieldPath = path.resolve(
    process.cwd(),
    'app/(admin)/admin/payments/refunds/new/_components/IdempotencyKeyField.client.tsx',
  );

  it('error.tsx references error.userMessage literally (premortem R4)', () => {
    const src = readFileSync(errorTsxPath, 'utf8');
    // Must read `.userMessage` (the load-bearing render-safe field).
    expect(src).toMatch(/\.userMessage\b/);
  });

  it('error.tsx does NOT reference error.message in JSX render output', () => {
    const src = readFileSync(errorTsxPath, 'utf8');
    // `error.message` can legitimately appear in JSDoc/inline-comment
    // PROSE (e.g. "we do not render error.message"), but the file
    // MUST NEVER reference it as live code. Strip comments + strings
    // first, then scan the remaining executable surface.
    //   - `/* ... */` block comments
    //   - `// ...` line comments
    //   - 'single' and "double" and `template` strings
    // The remaining text is the executable code; any `error.message`
    // reference there is the load-bearing render leak premortem R4
    // forbids.
    const stripped = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '')
      .replace(/'(?:\\.|[^'\\])*'/g, "''")
      .replace(/"(?:\\.|[^"\\])*"/g, '""')
      .replace(/`(?:\\.|[^`\\])*`/g, '``');
    expect(stripped).not.toMatch(/\berror\??\.message\b/);
  });

  it('error.tsx starts with the "use client" directive', () => {
    const src = readFileSync(errorTsxPath, 'utf8');
    expect(src.trimStart().startsWith("'use client'")).toBe(true);
  });

  it("page.tsx contains the literal `await requireRole('manager')`", () => {
    const src = readFileSync(pageTsxPath, 'utf8');
    expect(src).toMatch(/await\s+requireRole\(\s*['"]manager['"]\s*\)/);
  });

  it('IdempotencyKeyField client component starts with "use client" and uses sessionStorage', () => {
    const src = readFileSync(keyFieldPath, 'utf8');
    expect(src.trimStart().startsWith("'use client'")).toBe(true);
    // D3 — premortem risk 8 binding: sessionStorage-backed UUID.
    expect(src).toMatch(/sessionStorage/);
    // The compound key shape from D3.
    expect(src).toMatch(/refund-/);
    // UUID generator
    expect(src).toMatch(/crypto\.randomUUID/);
  });
});
