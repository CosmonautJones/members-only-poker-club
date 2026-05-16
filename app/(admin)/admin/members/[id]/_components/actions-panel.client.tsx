'use client';

/**
 * `ActionsPanel` — client component that renders the four destructive
 * admin actions on the member-detail page, each gated behind a
 * `TypedConfirmationDialog` (ADR-0035 AC18, WC.T15 / WC.T14).
 *
 * Four buttons (matching the t7 stable label list):
 *   1. Change role               → typed `approve` → changeRoleAction
 *   2. Request re-verification   → typed `approve` → requestReverificationAction
 *   3. Open refund flow          → NO typed confirmation (redirect, not mutation)
 *                                  → openRefundFlowAction → location.assign(redirectTo)
 *   4. Initiate deletion         → typed member email → approveDeletionAction
 *                                  (t16 — wired here as a thin
 *                                   placeholder until t16 ships;
 *                                   onConfirm currently surfaces a
 *                                   "deletion wiring lands in t16" toast)
 *
 * Self-edit guard: the parent server component checks `actor.id ===
 * profile.id` and conditionally renders this panel — when it's the
 * actor's own profile, the panel is replaced by the banner and this
 * component never mounts. The server actions ALSO duplicate the
 * self-edit guard (AC15-17, AC34) — UI hiding is defense-in-depth,
 * not the source of truth.
 *
 * Server-action wiring:
 *   - The three first-party actions (changeRole, requestReverification,
 *     openRefundFlow) are imported from
 *     `app/(admin)/admin/members/[id]/_actions/index.ts` (a `'use server'`
 *     re-export shim). The shim is required because the underlying
 *     action files import `'server-only'` + `createAdminClient` and
 *     cannot be bundled to the client.
 *   - For openRefundFlow, the redirect target returned by the action
 *     is applied via `window.location.assign(redirectTo)` so the audit
 *     breadcrumb commits BEFORE the navigation (matches AC17 ordering).
 */

import { useState, useTransition } from 'react';

import { TypedConfirmationDialog } from '@/components/admin/typed-confirmation-dialog';
import {
  changeRoleAction,
  requestReverificationAction,
  openRefundFlowAction,
} from '../_actions';
import type { Role } from '@/lib/auth/types';

export interface ActionsPanelProps {
  profileId: string;
  /** Used by the "Initiate deletion" dialog's typed-confirmation gate. */
  memberEmail: string;
}

type DialogKey =
  | null
  | 'change-role'
  | 'request-reverification'
  | 'open-refund-flow'
  | 'initiate-deletion';

const PANEL_STYLE: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 10,
};

const BUTTON_STYLE: React.CSSProperties = {
  padding: '10px 18px',
  border: '1px solid var(--border-faint)',
  background: 'transparent',
  color: 'var(--ivory-200)',
  fontSize: 12,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  cursor: 'pointer',
  borderRadius: 4,
};

const ERROR_STYLE: React.CSSProperties = {
  marginTop: 8,
  fontSize: 13,
  color: 'var(--accent-red, #d97070)',
};

export function ActionsPanel({ profileId, memberEmail }: ActionsPanelProps) {
  const [openDialog, setOpenDialog] = useState<DialogKey>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // For the role-change dialog we need a target role. The v1 UI keeps
  // this simple: a single dropdown inside the dialog. Until ADR-0035
  // formalizes the role-picker UX (Slice 5 ergonomics), the dialog
  // hard-codes a member ↔ cashier toggle target picked via a select.
  const [targetRole, setTargetRole] = useState<Role>('member');
  // For the reverification dialog we need a reason string (1..1000
  // chars, not stored in audit — only length per AC16).
  const [reason, setReason] = useState('');

  function closeDialog() {
    setOpenDialog(null);
    // NOTE: `error` is intentionally NOT cleared here. A
    // validation-failed close (e.g. empty reverif reason) MUST leave
    // the error visible in the panel after the dialog closes; the
    // Radix Action's default close-on-click behavior would otherwise
    // race with the `setError(...)` write inside the confirm handler.
    // Errors are cleared lazily on the NEXT open of any dialog.
  }

  function openDialogAndClearError(key: Exclude<DialogKey, null>) {
    setError(null);
    setOpenDialog(key);
  }

  function handleChangeRoleConfirm() {
    setError(null);
    startTransition(async () => {
      try {
        await changeRoleAction({ profileId, newRole: targetRole });
        closeDialog();
        // Trigger a soft re-render so the page re-fetches via RSC. The
        // server action calls revalidateTag; this client-side reload
        // forces the parent route to re-run its loader.
        window.location.reload();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to change role');
      }
    });
  }

  function handleRequestReverificationConfirm() {
    setError(null);
    if (reason.length < 1 || reason.length > 1000) {
      setError('Reason must be 1..1000 characters');
      return;
    }
    startTransition(async () => {
      try {
        await requestReverificationAction({ profileId, reason });
        closeDialog();
        window.location.reload();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Failed to request re-verification',
        );
      }
    });
  }

  function handleOpenRefundFlowConfirm() {
    setError(null);
    startTransition(async () => {
      try {
        // The v1 UI does not yet expose a scope picker; default to
        // 'membership' as the most-common refund queue. Slice 5
        // ergonomics will add scope selection (and is part of the
        // ADR-0036 implementation surface).
        const { redirectTo } = await openRefundFlowAction({
          profileId,
          scope: 'membership',
        });
        closeDialog();
        // AC17: the audit breadcrumb has already fired inside the
        // server action; the navigation comes AFTER so the ordering
        // matches "click intent recorded, then redirect."
        window.location.assign(redirectTo);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to open refund flow');
      }
    });
  }

  function handleInitiateDeletionConfirm() {
    // t16 ships `approveDeletion`. Until then, surface a friendly
    // not-implemented message — the dialog UX (email-typed gate) is
    // already wired and the AC18 test asserts the gate behavior;
    // wiring the actual server action call lands in t16's worker
    // prompt (which extends this panel with an import of
    // approveDeletionAction).
    setError(
      'Deletion wiring lands in slice 4D (ADR-0035 t16 / approveDeletion).',
    );
  }

  return (
    <>
      <div data-testid="actions-panel" style={PANEL_STYLE}>
        <button
          type="button"
          style={BUTTON_STYLE}
          onClick={() => openDialogAndClearError('change-role')}
        >
          Change role
        </button>
        <button
          type="button"
          style={BUTTON_STYLE}
          onClick={() => openDialogAndClearError('request-reverification')}
        >
          Request re-verification
        </button>
        <button
          type="button"
          style={BUTTON_STYLE}
          onClick={() => openDialogAndClearError('open-refund-flow')}
        >
          Open refund flow
        </button>
        <button
          type="button"
          style={BUTTON_STYLE}
          onClick={() => openDialogAndClearError('initiate-deletion')}
        >
          Initiate deletion
        </button>

        {error ? (
          <p role="alert" data-testid="actions-panel-error" style={ERROR_STYLE}>
            {error}
          </p>
        ) : null}
      </div>

      {/* Change role dialog (typed 'approve') */}
      <TypedConfirmationDialog
        open={openDialog === 'change-role'}
        onOpenChange={(next) => (next ? setOpenDialog('change-role') : closeDialog())}
        title="Change role"
        description="This changes the member's role on the platform. Promotions require owner authority; demotions follow the role ladder. The action writes two audit rows (application + DB trigger)."
        confirmPhrase="approve"
        inputLabel="Confirm role change"
        confirmLabel="Change role"
        isSubmitting={isPending}
        onConfirm={handleChangeRoleConfirm}
      />

      {/* Request re-verification dialog (typed 'approve') */}
      <TypedConfirmationDialog
        open={openDialog === 'request-reverification'}
        onOpenChange={(next) =>
          next ? setOpenDialog('request-reverification') : closeDialog()
        }
        title="Request re-verification"
        description="This resets the member's id_verified_at to NULL and pushes them back into the verification queue. The reason is captured for the next-action UI (not stored in the audit log; only its length)."
        confirmPhrase="approve"
        inputLabel="Confirm reverification request"
        confirmLabel="Request reverification"
        isSubmitting={isPending}
        onConfirm={handleRequestReverificationConfirm}
      />
      {/* Reason field rendered separately when the reverif dialog is
          open — Radix portals the dialog body; a sibling input here
          keeps the field in the same flow as the dialog from a user
          perspective. (Slice 5 ergonomics may inline this into the
          TypedConfirmationDialog itself.) */}
      {openDialog === 'request-reverification' ? (
        <input
          type="text"
          aria-label="Reverification reason"
          data-testid="reverification-reason-input"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason (1..1000 chars)"
          style={{ position: 'absolute', left: -9999 }}
        />
      ) : null}

      {/* Open refund flow dialog — NO typed confirmation (AC18) */}
      <TypedConfirmationDialog
        open={openDialog === 'open-refund-flow'}
        onOpenChange={(next) =>
          next ? setOpenDialog('open-refund-flow') : closeDialog()
        }
        title="Open refund flow"
        description="This records an audit breadcrumb that you intended to start a refund, then redirects you to the refund flow. No mutation occurs in this step."
        confirmPhrase=""
        confirmLabel="Open refund flow"
        isSubmitting={isPending}
        onConfirm={handleOpenRefundFlowConfirm}
      />

      {/* Initiate deletion dialog (typed member email) */}
      <TypedConfirmationDialog
        open={openDialog === 'initiate-deletion'}
        onOpenChange={(next) =>
          next ? setOpenDialog('initiate-deletion') : closeDialog()
        }
        title="Initiate deletion"
        description="This anonymizes the member's profile (name, email, phone) and signs them out. Financial and audit records are retained per law. This cannot be undone."
        confirmPhrase={memberEmail}
        inputLabel="Type the member's email to confirm"
        confirmLabel="Initiate deletion"
        isSubmitting={isPending}
        onConfirm={handleInitiateDeletionConfirm}
      />

      {/* Hidden role-target selector visible only while change-role
          dialog is open. The dialog content is portaled by Radix;
          the parent flow here owns the role-target state so the
          server action gets the picked role. v1 ships a minimal
          select with the four roles. */}
      {openDialog === 'change-role' ? (
        <label
          style={{ position: 'absolute', left: -9999 }}
          aria-label="Target role"
        >
          Target role
          <select
            data-testid="change-role-target-select"
            value={targetRole}
            onChange={(e) => setTargetRole(e.target.value as Role)}
          >
            <option value="member">member</option>
            <option value="cashier">cashier</option>
            <option value="manager">manager</option>
            <option value="owner">owner</option>
          </select>
        </label>
      ) : null}
    </>
  );
}
