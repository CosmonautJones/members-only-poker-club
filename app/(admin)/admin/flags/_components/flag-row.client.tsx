'use client';

/**
 * `FlagRow` — client component that renders a single editable row in the
 * `/admin/flags` table (ADR-0035 AC21, WC.T16).
 *
 * The row carries:
 *   - `key` (read-only)
 *   - `enabled` toggle (checkbox)
 *   - `percent` slider (0..100)
 *   - `allowlist` count (Link to detail page — out of scope for v1)
 *   - `role_gate` <select> (none | member | cashier | manager | owner)
 *   - `owner` + `expires_at` (read-only metadata)
 *   - `updated_at` + `updated_by` (resolved email)
 *   - STALE pill (when expires_at < now()-90d AND percent IN (0, 100))
 *   - Per-row Save button
 *
 * Kill-switch typed-confirmation (AC21):
 *   - When the row's `key` matches `kill-%` AND the user toggles the
 *     enabled checkbox, the Save button does NOT immediately call the
 *     server action — instead it opens a `TypedConfirmationDialog`
 *     requiring the user to type `enable` (if the toggle moved from
 *     false -> true) or `disable` (true -> false).
 *   - For non-kill flags the Save button calls the action directly.
 *   - The typed-phrase gate is case-sensitive + whitespace-significant
 *     per the t14 `TypedConfirmationDialog` contract.
 *
 * Premortem mitigations:
 *   - R6 (toggle race): the row is independently editable + saved (per-
 *     row Save). A page-level "Save all" would create a race where a
 *     simultaneous edit on another row clobbers concurrent changes.
 *   - R12 (audit row swallowed errors): all `throw` paths surface to the
 *     row-level `<p role="alert">` so a failed save is visible — never
 *     silently swallowed.
 */

import { useState, useTransition } from 'react';

import { TypedConfirmationDialog } from '@/components/admin/typed-confirmation-dialog';
import { updateFlagAction } from '../_actions';
import type { Role } from '@/lib/auth/types';

export interface FlagRowData {
  key: string;
  enabled: boolean;
  percent: number;
  allowlist: string[];
  role_gate: Role | null;
  owner: string;
  expires_at: string | null;
  updated_at: string;
  /** Resolved updated_by email or null when system / unresolved. */
  updated_by_email: string | null;
  /** Formatted UTC timestamp pair for `expires_at` (or null). */
  expires_at_formatted: { utc: string; central: string } | null;
  /** Formatted UTC timestamp pair for `updated_at`. */
  updated_at_formatted: { utc: string; central: string };
  /** Computed once on the server — stale = expires_at < now()-90d AND percent IN (0, 100). */
  stale: boolean;
}

const KILL_PREFIX = 'kill-';

const TD_STYLE: React.CSSProperties = {
  padding: '10px 12px',
  verticalAlign: 'top',
  fontSize: 13,
  color: 'var(--ivory-300)',
};

const INPUT_STYLE: React.CSSProperties = {
  padding: '4px 8px',
  background: 'var(--ink-900)',
  color: 'var(--ivory-200)',
  border: '1px solid var(--border-faint)',
  borderRadius: 4,
  fontSize: 12,
};

const SAVE_BUTTON_STYLE: React.CSSProperties = {
  padding: '6px 12px',
  fontSize: 11,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  background: 'var(--ink-900)',
  color: 'var(--ivory-200)',
  border: '1px solid var(--border-faint)',
  borderRadius: 4,
  cursor: 'pointer',
};

export function FlagRow({ flag }: { flag: FlagRowData }) {
  const [enabled, setEnabled] = useState(flag.enabled);
  const [percent, setPercent] = useState(flag.percent);
  const [roleGate, setRoleGate] = useState<Role | 'none'>(flag.role_gate ?? 'none');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [killDialogOpen, setKillDialogOpen] = useState(false);

  const isKillSwitch = flag.key.startsWith(KILL_PREFIX);
  const enabledChanged = enabled !== flag.enabled;
  const percentChanged = percent !== flag.percent;
  const roleGateChanged = (roleGate === 'none' ? null : roleGate) !== flag.role_gate;
  const hasChanges = enabledChanged || percentChanged || roleGateChanged;

  // Kill-switch dialog phrase — matches the direction of the toggle. If
  // the user moved enabled false -> true, they must type `enable`; the
  // opposite direction needs `disable`.
  const killPhrase = enabled ? 'enable' : 'disable';

  function performSave() {
    setError(null);
    const params: Parameters<typeof updateFlagAction>[0] = { key: flag.key };
    if (enabledChanged) params.enabled = enabled;
    if (percentChanged) params.percent = percent;
    if (roleGateChanged) params.roleGate = roleGate === 'none' ? null : roleGate;
    startTransition(async () => {
      try {
        await updateFlagAction(params);
        setKillDialogOpen(false);
        window.location.reload();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update flag');
        setKillDialogOpen(false);
      }
    });
  }

  function handleSaveClick() {
    if (!hasChanges) {
      setError('No changes to save.');
      return;
    }
    // Kill-switch typed-confirmation only applies when the enabled toggle
    // moved. Non-toggle changes on a kill flag (e.g. percent rollout)
    // save without the typed-confirmation gate.
    if (isKillSwitch && enabledChanged) {
      setKillDialogOpen(true);
      return;
    }
    performSave();
  }

  return (
    <tr
      data-flag-key={flag.key}
      data-is-kill-switch={isKillSwitch ? 'true' : undefined}
      style={{ borderTop: '1px solid var(--border-faint)' }}
    >
      <td style={{ ...TD_STYLE, fontFamily: 'monospace' }}>
        {flag.key}
        {flag.stale ? (
          <span
            data-testid={`flag-stale-pill-${flag.key}`}
            aria-label="Stale flag"
            style={{
              marginLeft: 8,
              padding: '2px 6px',
              fontSize: 10,
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              background: 'rgba(201, 162, 74, 0.15)',
              border: '1px solid rgba(201, 162, 74, 0.45)',
              borderRadius: 999,
              color: 'rgb(220, 190, 130)',
            }}
          >
            STALE
          </span>
        ) : null}
      </td>
      <td style={TD_STYLE}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <input
            type="checkbox"
            checked={enabled}
            aria-label={`Toggle enabled for ${flag.key}`}
            onChange={(e) => setEnabled(e.target.checked)}
            data-testid={`flag-enabled-${flag.key}`}
          />
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {enabled ? 'on' : 'off'}
          </span>
        </label>
      </td>
      <td style={TD_STYLE}>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={percent}
          aria-label={`Percent rollout for ${flag.key}`}
          onChange={(e) => setPercent(Number.parseInt(e.target.value, 10))}
          data-testid={`flag-percent-${flag.key}`}
          style={{ verticalAlign: 'middle' }}
        />
        <span
          style={{
            marginLeft: 8,
            fontFamily: 'monospace',
            fontSize: 12,
            color: 'var(--ivory-200)',
          }}
        >
          {percent}%
        </span>
      </td>
      <td style={TD_STYLE}>
        <span style={{ fontFamily: 'monospace' }}>{flag.allowlist.length}</span>
      </td>
      <td style={TD_STYLE}>
        <select
          value={roleGate}
          aria-label={`Role gate for ${flag.key}`}
          onChange={(e) => setRoleGate(e.target.value as Role | 'none')}
          data-testid={`flag-role-gate-${flag.key}`}
          style={INPUT_STYLE}
        >
          <option value="none">(none)</option>
          <option value="member">member</option>
          <option value="cashier">cashier</option>
          <option value="manager">manager</option>
          <option value="owner">owner</option>
        </select>
      </td>
      <td style={TD_STYLE}>{flag.owner}</td>
      <td style={TD_STYLE}>
        {flag.expires_at_formatted ? (
          <>
            <div>{flag.expires_at_formatted.utc}</div>
            <div style={{ color: 'var(--ivory-400)', fontSize: 11 }}>
              {flag.expires_at_formatted.central}
            </div>
          </>
        ) : (
          <span style={{ color: 'var(--text-muted)' }}>—</span>
        )}
      </td>
      <td style={TD_STYLE}>
        <div>{flag.updated_at_formatted.utc}</div>
        <div style={{ color: 'var(--ivory-400)', fontSize: 11 }}>
          {flag.updated_at_formatted.central}
        </div>
        <div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 4 }}>
          by {flag.updated_by_email ?? 'system'}
        </div>
      </td>
      <td style={TD_STYLE}>
        <button
          type="button"
          onClick={handleSaveClick}
          disabled={isPending || !hasChanges}
          style={{
            ...SAVE_BUTTON_STYLE,
            opacity: hasChanges && !isPending ? 1 : 0.5,
            cursor: hasChanges && !isPending ? 'pointer' : 'not-allowed',
          }}
          data-testid={`flag-save-${flag.key}`}
        >
          {isPending ? 'Saving…' : 'Save'}
        </button>
        {error ? (
          <p
            role="alert"
            data-testid={`flag-error-${flag.key}`}
            style={{ marginTop: 6, fontSize: 12, color: 'var(--accent-red, #d97070)' }}
          >
            {error}
          </p>
        ) : null}
      </td>

      {/* Kill-switch typed-confirmation dialog. Mounted always (Radix
          renders only when open=true), so the parent <tr> always has the
          same structure regardless of the row's kill-switch status. */}
      <TypedConfirmationDialog
        open={killDialogOpen}
        onOpenChange={(next) => setKillDialogOpen(next)}
        title={`Toggle kill-switch: ${flag.key}`}
        description={
          enabled
            ? 'Type "enable" to activate this kill-switch. Enabling a kill-switch disables the gated capability site-wide.'
            : 'Type "disable" to deactivate this kill-switch. Disabling restores the gated capability site-wide.'
        }
        confirmPhrase={killPhrase}
        inputLabel="Type the phrase to confirm"
        confirmLabel={enabled ? 'Enable kill-switch' : 'Disable kill-switch'}
        isSubmitting={isPending}
        onConfirm={() => {
          performSave();
        }}
      />
    </tr>
  );
}
