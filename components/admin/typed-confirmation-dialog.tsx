'use client';

/**
 * `TypedConfirmationDialog` — ADR-0035 AC18 typed-confirmation dialog
 * primitive for the four destructive admin actions on the member-detail
 * Actions panel (Change role, Request re-verification, Open refund flow,
 * Initiate deletion).
 *
 * Why raw Radix `AlertDialog` (no shadcn wrapper):
 *   - ADR-0023 precedent — see `app/(member)/profile/privacy/page.tsx`
 *     which uses raw `@radix-ui/react-alert-dialog` for the
 *     account-deletion confirmation. Open Question §6 of ADR-0023
 *     resolved as "raw Radix is fine for a single call site" — the
 *     same reasoning applies here (four call sites, all in one page).
 *
 * A11y contract (AC18):
 *   - Initial focus lands on the Cancel button (Radix puts focus on
 *     the first focusable element in the content; rendering Cancel
 *     first satisfies this).
 *   - Esc closes the dialog (Radix handles via `data-state`).
 *   - `aria-modal="true"` on the content (Radix sets this automatically
 *     on the content element).
 *
 * Typed-confirmation contract:
 *   - `confirmPhrase` is the literal string the user MUST type into the
 *     input before the destructive action button enables.
 *   - The match is case-sensitive AND whitespace-significant — type the
 *     phrase EXACTLY. This is intentional: a typo'd "approve " (trailing
 *     space) should NOT enable the action. The premortem-R9-style
 *     "compromised manager session" can still bypass this UI by POSTing
 *     directly to the server action; the server-side guard (e.g. the
 *     `confirmEmail` parameter for `approveDeletion`) is the load-bearing
 *     defense — this dialog is the operator-friction layer.
 *   - When `confirmPhrase` is empty (`''`), the input + matching gate
 *     are NOT rendered — the dialog shows ONLY title + description +
 *     Cancel + Confirm. Used by the "Open refund flow" button (AC18:
 *     "no typed confirmation — it's a redirect, not a mutation").
 *
 * Composition (control flow):
 *   - `open` + `onOpenChange` are controlled — the parent (the
 *     member-detail page's client wrapper) owns the open state so the
 *     button onClick can set it. Radix's `Trigger` is NOT used here
 *     because the parent renders its own button styles (matching the
 *     Slice 4C action-panel aesthetic).
 *   - `onConfirm` fires when the Confirm button is clicked (after the
 *     typed phrase matches, if `confirmPhrase` is non-empty). The
 *     parent is responsible for calling the server action; this
 *     component is presentation-only.
 *
 * Test-friendliness:
 *   - The dialog content carries `data-testid="typed-confirmation-dialog"`.
 *   - The Cancel button carries `data-testid="typed-confirmation-cancel"`.
 *   - The Confirm button carries `data-testid="typed-confirmation-confirm"`.
 *   - The input carries `data-testid="typed-confirmation-input"`.
 *   - RTL tests in `tests/admin/member-detail-dialogs.test.tsx` assert
 *     against these testids (the Radix content + cancel/action elements
 *     are rendered via `asChild`, so the testids flow to the underlying
 *     button elements that user-event can interact with).
 */

import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { useEffect, useState } from 'react';

export interface TypedConfirmationDialogProps {
  /** Controls whether the dialog is open. Owned by the parent. */
  open: boolean;

  /**
   * Fired when Radix wants to close/open the dialog. The parent should
   * mirror this into its own state. Esc + outside-click + Cancel all
   * route through here with `next=false`.
   */
  onOpenChange: (next: boolean) => void;

  /** Dialog title (rendered as a Radix `AlertDialog.Title`). */
  title: string;

  /**
   * Body copy explaining the consequences of the destructive action.
   * Rendered as a Radix `AlertDialog.Description` (always present, even
   * when `confirmPhrase` is empty).
   */
  description: string;

  /**
   * The literal phrase the user MUST type into the input to enable the
   * Confirm button. When empty (''), the input is NOT rendered and the
   * Confirm button is enabled immediately (used for the refund-flow
   * redirect — see AC18).
   */
  confirmPhrase: string;

  /**
   * Label rendered above the typed-confirmation input. Defaults to a
   * generic prompt. When `confirmPhrase` is empty, this is ignored.
   */
  inputLabel?: string;

  /** Label for the destructive action button. */
  confirmLabel: string;

  /** Fired when the user clicks Confirm (after the phrase matches). */
  onConfirm: () => void;

  /**
   * When true, the Confirm button shows a loading state and is disabled
   * irrespective of the typed-phrase match. The parent sets this while
   * the server action is in flight.
   */
  isSubmitting?: boolean;
}

export function TypedConfirmationDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmPhrase,
  inputLabel = 'Type the phrase to confirm',
  confirmLabel,
  onConfirm,
  isSubmitting = false,
}: TypedConfirmationDialogProps) {
  const [typed, setTyped] = useState('');

  // Reset the typed-input value whenever the dialog closes — so the
  // next time it opens, the user starts from a blank slate. Without
  // this, a Cancel-then-reopen would leave the previous (potentially
  // matching) text in the input and the Confirm button enabled.
  useEffect(() => {
    if (!open) {
      setTyped('');
    }
  }, [open]);

  // Match logic — case-sensitive + whitespace-significant. When
  // confirmPhrase is empty, the gate is bypassed (used by the refund-
  // flow redirect; see AC18).
  const phraseRequired = confirmPhrase.length > 0;
  const phraseMatches = phraseRequired ? typed === confirmPhrase : true;
  const confirmDisabled = isSubmitting || !phraseMatches;

  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay
          data-testid="typed-confirmation-overlay"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.6)',
          }}
        />
        <AlertDialog.Content
          data-testid="typed-confirmation-dialog"
          // Radix automatically sets aria-modal="true" on the content,
          // but we set it explicitly too so the AC18 grep + test
          // assertion can find it regardless of Radix's version.
          aria-modal="true"
          style={{
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            maxWidth: 480,
            width: 'calc(100vw - 32px)',
            padding: 24,
            borderRadius: 8,
            background: 'var(--ink-850, #1a1a1a)',
            color: 'var(--ivory-200, #e9e6dd)',
            border: '1px solid var(--border-faint, #333)',
            boxShadow: '0 24px 64px rgba(0, 0, 0, 0.5)',
          }}
        >
          <AlertDialog.Title
            style={{
              fontFamily: 'Cormorant Garamond, serif',
              fontSize: 24,
              fontWeight: 500,
              margin: 0,
              marginBottom: 8,
            }}
          >
            {title}
          </AlertDialog.Title>
          <AlertDialog.Description
            style={{
              fontSize: 14,
              color: 'var(--ivory-300, #cfcabb)',
              marginBottom: 16,
              lineHeight: 1.5,
            }}
          >
            {description}
          </AlertDialog.Description>

          {phraseRequired ? (
            <label
              style={{
                display: 'block',
                marginBottom: 16,
                fontSize: 12,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                color: 'var(--text-muted, #a0998a)',
              }}
            >
              <span style={{ display: 'block', marginBottom: 6 }}>
                {inputLabel} — type{' '}
                <code
                  data-testid="typed-confirmation-phrase"
                  style={{
                    fontFamily: 'monospace',
                    fontSize: 13,
                    color: 'var(--ivory-200, #e9e6dd)',
                  }}
                >
                  {confirmPhrase}
                </code>
              </span>
              <input
                type="text"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                data-testid="typed-confirmation-input"
                aria-label={`${inputLabel} (type ${confirmPhrase})`}
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  fontSize: 14,
                  fontFamily: 'monospace',
                  background: 'var(--ink-900, #111)',
                  color: 'var(--ivory-200, #e9e6dd)',
                  border: '1px solid var(--border-faint, #333)',
                  borderRadius: 4,
                  marginTop: 6,
                }}
              />
            </label>
          ) : null}

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            {/* Cancel renders FIRST so Radix focuses it on open
                (initial focus on Cancel — AC18 a11y). */}
            <AlertDialog.Cancel asChild>
              <button
                type="button"
                data-testid="typed-confirmation-cancel"
                style={{
                  padding: '8px 14px',
                  fontSize: 12,
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                  background: 'transparent',
                  color: 'var(--ivory-300, #cfcabb)',
                  border: '1px solid var(--border-faint, #333)',
                  borderRadius: 4,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <button
                type="button"
                data-testid="typed-confirmation-confirm"
                onClick={(e) => {
                  // When the phrase does not match, Radix would close
                  // the dialog on click (Action default behavior). We
                  // suppress that by stopping propagation + preventing
                  // default — the button is `disabled` so the click
                  // shouldn't fire at all, but the JSDOM substrate +
                  // user-event combination can synthesize the event
                  // anyway in some setups. Defense in depth.
                  if (confirmDisabled) {
                    e.preventDefault();
                    e.stopPropagation();
                    return;
                  }
                  onConfirm();
                }}
                disabled={confirmDisabled}
                aria-disabled={confirmDisabled}
                style={{
                  padding: '8px 14px',
                  fontSize: 12,
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                  background: confirmDisabled
                    ? 'rgba(180, 60, 60, 0.4)'
                    : 'var(--accent-red, #b43c3c)',
                  color: 'var(--ivory-100, #f5f1e6)',
                  border: '1px solid transparent',
                  borderRadius: 4,
                  cursor: confirmDisabled ? 'not-allowed' : 'pointer',
                  opacity: confirmDisabled ? 0.5 : 1,
                }}
              >
                {isSubmitting ? 'Working…' : confirmLabel}
              </button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
