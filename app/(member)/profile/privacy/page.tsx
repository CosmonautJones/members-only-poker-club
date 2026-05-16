'use client';

/**
 * /profile/privacy — ADR-0023 slice 1, AC8.
 *
 * Client component: the destructive buttons need browser-side fetch
 * and AlertDialog state. Uses raw Radix UI AlertDialog primitives
 * (Open Q 6 resolution: no shadcn wrapper for a single call site).
 *
 * The page lives inside the (member) route group so the existing
 * (member)/layout.tsx redirect-to-login gate protects it automatically.
 *
 * Two destructive actions:
 *   1. Download my data — POST /api/privacy/export, save as JSON file.
 *   2. Delete my account — AlertDialog confirmation, then POST /api/privacy/delete.
 */

import Link from 'next/link';
import { useState } from 'react';
import * as AlertDialog from '@radix-ui/react-alert-dialog';

export default function ProfilePrivacyPage() {
  const [exportError, setExportError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  async function handleDownload() {
    setExportError(null);
    setIsExporting(true);
    try {
      const response = await fetch('/api/privacy/export', { method: 'POST' });
      if (response.status === 401) {
        window.location.assign('/login?next=/profile/privacy');
        return;
      }
      if (!response.ok) {
        setExportError('Export failed. Please try again or contact support.');
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'mopc-privacy-export.json';
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    } catch {
      setExportError('Export failed. Please try again or contact support.');
    } finally {
      setIsExporting(false);
    }
  }

  async function handleDelete() {
    setDeleteError(null);
    setIsDeleting(true);
    try {
      const response = await fetch('/api/privacy/delete', { method: 'POST' });
      if (response.status === 200) {
        // Server has signed the user out — do a full reload to clear React state.
        window.location.assign('/');
        return;
      }
      // 401 or 500
      setDeleteError('Account deletion failed. Please try again or contact support.');
    } catch {
      setDeleteError('Account deletion failed. Please try again or contact support.');
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <div>
      <h1>Privacy &amp; data</h1>
      <p>
        Read our <Link href="/privacy">privacy policy</Link> to understand how we collect and use
        your data.
      </p>

      <section aria-labelledby="download-heading">
        <h2 id="download-heading">Download my data</h2>
        <p>
          Get a JSON export of your profile information and audit history. Your financial records
          are not included in Slice 1 (coming soon).
        </p>
        <button
          type="button"
          onClick={handleDownload}
          disabled={isExporting}
          className="rounded border border-ivory-200 px-4 py-2 hover:bg-ivory-200/10 disabled:opacity-50"
        >
          {isExporting ? 'Exporting…' : 'Download my data'}
        </button>
        {exportError && (
          <p role="alert" className="mt-2 text-red-500">
            {exportError}
          </p>
        )}
      </section>

      <section aria-labelledby="delete-heading">
        <h2 id="delete-heading">Delete my account</h2>
        <p>
          This permanently anonymizes your name, email, and phone number. Financial and audit
          records are retained per law. This cannot be undone.
        </p>

        <AlertDialog.Root>
          <AlertDialog.Trigger asChild>
            <button
              type="button"
              className="rounded bg-red-600 px-4 py-2 text-white hover:bg-red-700"
            >
              Delete my account
            </button>
          </AlertDialog.Trigger>

          <AlertDialog.Portal>
            <AlertDialog.Overlay className="fixed inset-0 bg-black/50" />
            <AlertDialog.Content
              className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-lg bg-ink-850 p-6 text-ivory-200 shadow-xl"
              aria-modal="true"
            >
              <AlertDialog.Title className="text-xl font-bold">
                Delete your account?
              </AlertDialog.Title>
              <AlertDialog.Description className="mt-2 text-sm">
                This anonymizes your name, email, and phone, and signs you out. Financial and audit
                records are retained per law. This cannot be undone.
              </AlertDialog.Description>

              <div className="mt-4 flex gap-3">
                {/* Cancel has initial focus — keyboard users can dismiss safely. */}
                <AlertDialog.Cancel asChild>
                  {/* Cancel appears first — Radix moves focus here on open (no autoFocus needed). */}
                  <button
                    type="button"
                    className="rounded border border-ivory-200 px-4 py-2 hover:bg-ivory-200/10"
                  >
                    Cancel
                  </button>
                </AlertDialog.Cancel>

                <AlertDialog.Action asChild>
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={isDeleting}
                    className="rounded bg-red-600 px-4 py-2 text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    {isDeleting ? 'Deleting…' : 'Delete my account'}
                  </button>
                </AlertDialog.Action>
              </div>
            </AlertDialog.Content>
          </AlertDialog.Portal>
        </AlertDialog.Root>

        {deleteError && (
          <p role="alert" className="mt-2 text-red-500">
            {deleteError}
          </p>
        )}
      </section>
    </div>
  );
}
