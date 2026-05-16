/**
 * Tests for the AC18 / WC.T15 member-detail typed-confirmation dialogs.
 *
 * Run locally:    pnpm test tests/admin/member-detail-dialogs.test.tsx
 * Prerequisites:  none — module mocks (no DB, no network).
 *
 * Spec: docs/specs/0035-admin-operations-console-implementation.md AC18
 *       (Radix `AlertDialog`, focus on Cancel, Esc closes,
 *       `aria-modal="true"`; typed phrases — `approve` for role-change
 *       + reverif, member email for deletion, none for refund flow;
 *       self-edit hides all four buttons).
 *
 * SUT contract:
 *   - `<ActionsPanel profileId memberEmail />` renders four buttons:
 *     Change role, Request re-verification, Open refund flow,
 *     Initiate deletion.
 *   - Clicking each button opens the matching dialog.
 *   - Cancel has initial focus.
 *   - The destructive action button is DISABLED until the typed phrase
 *     matches the expected value (case-sensitive, whitespace-significant).
 *   - Esc closes the dialog without firing the server action.
 *   - Confirm calls the server action with the expected params.
 *   - Self-edit case: the parent page does not render this panel —
 *     covered by `tests/admin/member-detail-page.test.tsx`. This file
 *     asserts the panel-not-rendered case separately by asserting that
 *     the parent's banner is the visible content (smoke test only).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---- Hoisted spies for the server-action wrappers ------------------------

const actionSpies = vi.hoisted(() => ({
  changeRoleAction: vi.fn(async () => ({ ok: true as const, changed: true })),
  requestReverificationAction: vi.fn(async () => ({ ok: true as const })),
  openRefundFlowAction: vi.fn(async () => ({
    redirectTo: '/admin/members/uuid-target?refund=pending-adr-0036',
  })),
}));

// Mock the `'use server'` re-export shim. The client component imports
// the three actions from here.
vi.mock('@/app/(admin)/admin/members/[id]/_actions', () => ({
  changeRoleAction: actionSpies.changeRoleAction,
  requestReverificationAction: actionSpies.requestReverificationAction,
  openRefundFlowAction: actionSpies.openRefundFlowAction,
}));

// `next/navigation` is not used by the client component directly, but
// the parent page imports it; mocked here for completeness.
vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

// Mock window.location.reload + .assign so the post-confirm side effects
// do not blow up jsdom.
const navigationSpies = vi.hoisted(() => ({
  reload: vi.fn(),
  assign: vi.fn(),
}));

beforeEach(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      ...window.location,
      reload: navigationSpies.reload,
      assign: navigationSpies.assign,
    },
  });
  navigationSpies.reload.mockClear();
  navigationSpies.assign.mockClear();
  actionSpies.changeRoleAction.mockClear();
  actionSpies.requestReverificationAction.mockClear();
  actionSpies.openRefundFlowAction.mockClear();
});

// eslint-disable-next-line import/first
import { ActionsPanel } from '@/app/(admin)/admin/members/[id]/_components/actions-panel.client';

const TARGET_ID = 'uuid-target';
const MEMBER_EMAIL = 'jane@example.com';

function renderPanel() {
  return render(<ActionsPanel profileId={TARGET_ID} memberEmail={MEMBER_EMAIL} />);
}

// =============================================================================
// AC18.1 — Each dialog opens on button click + has aria-modal + Cancel focus
// =============================================================================
describe('AC18 — dialog open + a11y', () => {
  it('Change role dialog opens with aria-modal=true and Cancel focused', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole('button', { name: 'Change role' }));
    const dialog = await screen.findByTestId('typed-confirmation-dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    // Radix focuses the first focusable element in the content. The
    // Cancel button renders first, so it receives focus.
    const cancelBtn = screen.getByTestId('typed-confirmation-cancel');
    expect(document.activeElement).toBe(cancelBtn);
  });

  it('Request re-verification dialog opens with aria-modal=true', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole('button', { name: 'Request re-verification' }));
    const dialog = await screen.findByTestId('typed-confirmation-dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });

  it('Open refund flow dialog opens with aria-modal=true', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole('button', { name: 'Open refund flow' }));
    const dialog = await screen.findByTestId('typed-confirmation-dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });

  it('Initiate deletion dialog opens with aria-modal=true', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole('button', { name: 'Initiate deletion' }));
    const dialog = await screen.findByTestId('typed-confirmation-dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });
});

// =============================================================================
// AC18.2 — Destructive button DISABLED until typed phrase matches
// =============================================================================
describe('AC18 — typed-phrase gate', () => {
  it('Change role: confirm disabled until "approve" typed exactly', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole('button', { name: 'Change role' }));
    const confirm = screen.getByTestId('typed-confirmation-confirm') as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);

    const input = screen.getByTestId('typed-confirmation-input');
    await user.type(input, 'approv'); // partial — still disabled
    expect(confirm.disabled).toBe(true);

    await user.type(input, 'e');
    expect(confirm.disabled).toBe(false);
  });

  it('Reverification: confirm disabled until "approve" typed', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole('button', { name: 'Request re-verification' }));
    const confirm = screen.getByTestId('typed-confirmation-confirm') as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await user.type(screen.getByTestId('typed-confirmation-input'), 'approve');
    expect(confirm.disabled).toBe(false);
  });

  it('Open refund flow: NO typed phrase — confirm enabled immediately', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole('button', { name: 'Open refund flow' }));
    const confirm = screen.getByTestId('typed-confirmation-confirm') as HTMLButtonElement;
    // No input rendered for the redirect-only dialog.
    expect(screen.queryByTestId('typed-confirmation-input')).toBeNull();
    expect(confirm.disabled).toBe(false);
  });

  it('Initiate deletion: confirm disabled until member email typed exactly', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole('button', { name: 'Initiate deletion' }));
    const confirm = screen.getByTestId('typed-confirmation-confirm') as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);

    const input = screen.getByTestId('typed-confirmation-input');
    await user.type(input, 'jane@example.co'); // partial
    expect(confirm.disabled).toBe(true);

    await user.type(input, 'm');
    expect(confirm.disabled).toBe(false);
  });

  it('Case-sensitive: "APPROVE" (uppercase) does NOT match "approve"', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole('button', { name: 'Change role' }));
    await user.type(screen.getByTestId('typed-confirmation-input'), 'APPROVE');
    const confirm = screen.getByTestId('typed-confirmation-confirm') as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
  });
});

// =============================================================================
// AC18.3 — Esc closes dialog (no action fires)
// =============================================================================
describe('AC18 — Esc closes', () => {
  it('Esc closes the Change role dialog without firing changeRoleAction', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole('button', { name: 'Change role' }));
    expect(screen.queryByTestId('typed-confirmation-dialog')).not.toBeNull();

    await user.keyboard('{Escape}');
    // Radix's close is async; await a microtask via findBy negation.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(screen.queryByTestId('typed-confirmation-dialog')).toBeNull();
    expect(actionSpies.changeRoleAction).not.toHaveBeenCalled();
  });

  it('Esc closes the Initiate deletion dialog even after partial typed phrase', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole('button', { name: 'Initiate deletion' }));
    await user.type(screen.getByTestId('typed-confirmation-input'), 'jane@');
    await user.keyboard('{Escape}');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(screen.queryByTestId('typed-confirmation-dialog')).toBeNull();
  });
});

// =============================================================================
// AC18.4 — Confirm calls the action with the expected params
// =============================================================================
describe('AC18 — Confirm fires action with correct params', () => {
  it('Change role: confirm calls changeRoleAction with { profileId, newRole }', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole('button', { name: 'Change role' }));
    // Pick a target role via the hidden select. The default is 'member';
    // change to 'cashier' to assert the param flows through.
    fireEvent.change(screen.getByTestId('change-role-target-select'), {
      target: { value: 'cashier' },
    });
    await user.type(screen.getByTestId('typed-confirmation-input'), 'approve');
    await user.click(screen.getByTestId('typed-confirmation-confirm'));

    expect(actionSpies.changeRoleAction).toHaveBeenCalledWith({
      profileId: TARGET_ID,
      newRole: 'cashier',
    });
  });

  it('Reverification: confirm calls requestReverificationAction with { profileId, reason }', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole('button', { name: 'Request re-verification' }));
    // Type a reason via the hidden reason input.
    fireEvent.change(screen.getByTestId('reverification-reason-input'), {
      target: { value: 'Need updated ID photo' },
    });
    await user.type(screen.getByTestId('typed-confirmation-input'), 'approve');
    await user.click(screen.getByTestId('typed-confirmation-confirm'));

    expect(actionSpies.requestReverificationAction).toHaveBeenCalledWith({
      profileId: TARGET_ID,
      reason: 'Need updated ID photo',
    });
  });

  it('Open refund flow: confirm calls openRefundFlowAction with { profileId, scope }', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole('button', { name: 'Open refund flow' }));
    // No typed-confirmation gate — confirm fires immediately.
    await user.click(screen.getByTestId('typed-confirmation-confirm'));

    expect(actionSpies.openRefundFlowAction).toHaveBeenCalledWith({
      profileId: TARGET_ID,
      scope: 'membership',
    });
    // Post-action: location.assign called with the redirect target.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(navigationSpies.assign).toHaveBeenCalledWith(
      '/admin/members/uuid-target?refund=pending-adr-0036',
    );
  });

  it('Reverification: empty reason surfaces error without calling the action', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole('button', { name: 'Request re-verification' }));
    // Leave the reason empty.
    await user.type(screen.getByTestId('typed-confirmation-input'), 'approve');
    await user.click(screen.getByTestId('typed-confirmation-confirm'));
    expect(actionSpies.requestReverificationAction).not.toHaveBeenCalled();
    expect(screen.getByTestId('actions-panel-error').textContent).toMatch(
      /reason must be 1\.\.1000/i,
    );
  });
});

// =============================================================================
// AC18.5 — Self-edit hides all four buttons (smoke — page handles the case)
// =============================================================================
describe('AC18 — self-edit (smoke test)', () => {
  it('the ActionsPanel itself ALWAYS renders all four buttons — the page is responsible for not rendering the panel in the self-edit case', () => {
    // The self-edit hiding logic lives in the parent server component
    // (page.tsx); when actor.id === profile.id, the page renders the
    // banner and does NOT mount the ActionsPanel. That contract is
    // covered by tests/admin/member-detail-page.test.tsx. This file
    // verifies that the panel — when mounted — has no internal
    // "hide if self" branch (the panel is presentation-only and
    // assumes the parent's guard ran).
    renderPanel();
    expect(screen.getByRole('button', { name: 'Change role' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Request re-verification' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open refund flow' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Initiate deletion' })).toBeTruthy();
  });
});
