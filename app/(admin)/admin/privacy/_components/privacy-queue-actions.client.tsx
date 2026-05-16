'use client';

/**
 * `PrivacyQueueActions` — client component that renders the per-row
 * action buttons on the `/admin/privacy` queue (ADR-0035 AC23, WC.T17).
 *
 * Per row (status='pending' only — the parent server component renders
 * `—` for non-pending rows so the buttons never appear on completed /
 * rejected rows):
 *
 *   - `kind='export'`: **Approve export** button → typed `approve` →
 *     `approveExportAction({ requestId })`.
 *   - `kind='delete'`: **Approve deletion** button → typed
 *     `requesterEmail` → `approveDeletionAction({ requestId,
 *     confirmEmail })`.
 *   - Any pending row: **Reject** button → typed `reject` + free-text
 *     reason (1..500) → `rejectRequestAction({ requestId, reason })`.
 *
 * UX contract per AC23 + AC18 (shared with member-detail dialogs):
 *   - Initial focus lands on Cancel (Radix focuses first focusable).
 *   - Esc closes without firing the action.
 *   - `aria-modal="true"` on the dialog content.
 *
 * Server-action wiring: imports from
 * `app/(admin)/admin/privacy/_actions/index.ts` (the `'use server'`
 * re-export shim — see its file header for why the underlying actions
 * can't be bundled to the client).
 */

import { useState, useTransition } from 'react';

import { TypedConfirmationDialog } from '@/components/admin/typed-confirmation-dialog';
import {
  approveExportAction,
  approveDeletionAction,
  rejectRequestAction,
} from '../_actions';

export interface PrivacyQueueActionsProps {
  requestId: string;
  kind: 'export' | 'delete';
  requesterEmail: string;
}

type DialogKey = null | 'approve-export' | 'approve-deletion' | 'reject';

const PANEL_STYLE: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
};

const BUTTON_STYLE: React.CSSProperties = {
  padding: '6px 12px',
  border: '1px solid var(--border-faint)',
  background: 'transparent',
  color: 'var(--ivory-200)',
  fontSize: 11,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  cursor: 'pointer',
  borderRadius: 4,
};

const ERROR_STYLE: React.CSSProperties = {
  marginTop: 6,
  fontSize: 12,
  color: 'var(--accent-red, #d97070)',
  flexBasis: '100%',
};

export function PrivacyQueueActions({
  requestId,
  kind,
  requesterEmail,
}: PrivacyQueueActionsProps) {
  const [openDialog, setOpenDialog] = useState<DialogKey>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  function closeDialog() {
    setOpenDialog(null);
  }

  function openDialogAndClearError(key: Exclude<DialogKey, null>) {
    setError(null);
    setRejectReason('');
    setOpenDialog(key);
  }

  function handleApproveExportConfirm() {
    setError(null);
    startTransition(async () => {
      try {
        await approveExportAction({ requestId });
        closeDialog();
        window.location.reload();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to approve export');
      }
    });
  }

  function handleApproveDeletionConfirm() {
    setError(null);
    startTransition(async () => {
      try {
        await approveDeletionAction({ requestId, confirmEmail: requesterEmail });
        closeDialog();
        window.location.reload();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to approve deletion');
      }
    });
  }

  function handleRejectConfirm() {
    setError(null);
    if (rejectReason.length < 1 || rejectReason.length > 500) {
      setError('Reason must be 1..500 characters');
      return;
    }
    startTransition(async () => {
      try {
        await rejectRequestAction({ requestId, reason: rejectReason });
        closeDialog();
        window.location.reload();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to reject request');
      }
    });
  }

  return (
    <>
      <div data-testid={`privacy-actions-${requestId}`} style={PANEL_STYLE}>
        {kind === 'export' ? (
          <button
            type="button"
            style={BUTTON_STYLE}
            data-testid={`privacy-approve-export-${requestId}`}
            onClick={() => openDialogAndClearError('approve-export')}
          >
            Approve export
          </button>
        ) : null}
        {kind === 'delete' ? (
          <button
            type="button"
            style={BUTTON_STYLE}
            data-testid={`privacy-approve-deletion-${requestId}`}
            onClick={() => openDialogAndClearError('approve-deletion')}
          >
            Approve deletion
          </button>
        ) : null}
        <button
          type="button"
          style={BUTTON_STYLE}
          data-testid={`privacy-reject-${requestId}`}
          onClick={() => openDialogAndClearError('reject')}
        >
          Reject
        </button>

        {error ? (
          <p role="alert" data-testid={`privacy-error-${requestId}`} style={ERROR_STYLE}>
            {error}
          </p>
        ) : null}
      </div>

      {/* Approve export dialog (typed 'approve') */}
      <TypedConfirmationDialog
        open={openDialog === 'approve-export'}
        onOpenChange={(next) =>
          next ? setOpenDialog('approve-export') : closeDialog()
        }
        title="Approve data export"
        description="This generates a signed export URL with a 24-hour TTL and emails it to the requester. Approval is irreversible — the request transitions pending → in_progress → completed."
        confirmPhrase="approve"
        inputLabel="Confirm export approval"
        confirmLabel="Approve export"
        isSubmitting={isPending}
        onConfirm={handleApproveExportConfirm}
      />

      {/* Approve deletion dialog (typed member email) */}
      <TypedConfirmationDialog
        open={openDialog === 'approve-deletion'}
        onOpenChange={(next) =>
          next ? setOpenDialog('approve-deletion') : closeDialog()
        }
        title="Approve account deletion"
        description="This anonymizes the member's profile (name, email, phone) and sends a confirmation email. Financial and audit records are retained per law. This cannot be undone."
        confirmPhrase={requesterEmail}
        inputLabel="Type the requester's email to confirm"
        confirmLabel="Approve deletion"
        isSubmitting={isPending}
        onConfirm={handleApproveDeletionConfirm}
      />

      {/* Reject dialog (typed 'reject' + reason) */}
      <TypedConfirmationDialog
        open={openDialog === 'reject'}
        onOpenChange={(next) => (next ? setOpenDialog('reject') : closeDialog())}
        title="Reject privacy request"
        description="This rejects the request and records a staff-authored reason. The reason will be shown to the member. The audit log captures only the reason's length, not its text."
        confirmPhrase="reject"
        inputLabel="Confirm rejection"
        confirmLabel="Reject request"
        isSubmitting={isPending}
        onConfirm={handleRejectConfirm}
      />
      {openDialog === 'reject' ? (
        <input
          type="text"
          aria-label="Reject reason"
          data-testid={`privacy-reject-reason-${requestId}`}
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
          placeholder="Reason (1..500 chars)"
          style={{ position: 'absolute', left: -9999 }}
        />
      ) : null}
    </>
  );
}
