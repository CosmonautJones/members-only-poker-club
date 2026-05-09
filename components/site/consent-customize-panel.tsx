'use client';

/**
 * T3 — `<ConsentCustomizePanel />` per ADR-0024 + Slice-1 spec AC6.
 *
 * Radix Dialog modal (committed choice — Open Q 2 deleted in spec). The five
 * a11y assertions that AC6 mandates are satisfied here:
 *   - `<Dialog.Title>` provides the accessible name (`COPY.customize.title`).
 *   - Focus trap — Radix default.
 *   - Esc closes — Radix default; wired to `closeCustomizePanel` via
 *     `onOpenChange`.
 *   - Initial focus on Cancel — `autoFocus` on the Cancel button (committed).
 *   - `aria-modal="true"` — Radix default on `Dialog.Content`.
 *
 * Per AC6, Essential is hardcoded checked + locked (`aria-disabled` via the
 * `disabled` attribute on the input). Save persists the panel's local draft
 * via `setState` from `useConsent()`; Cancel is a no-op close.
 *
 * Open/close state lives in `<ConsentProvider>` (concern 5) so the banner's
 * Customize button and the footer's `<CookiePreferencesLink />` both control
 * the same modal instance.
 */

import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';

import { useConsent } from './consent-provider';
import { COPY } from '@/lib/consent/copy';
import type { ConsentState } from '@/lib/consent/cookie';

function defaultDraft(): ConsentState {
  return { essential: true, analytics: false, errors: false, version: 1 };
}

export function ConsentCustomizePanel() {
  const { state, isCustomizePanelOpen, closeCustomizePanel, setState } = useConsent();
  const [draft, setDraft] = useState<ConsentState>(() => state ?? defaultDraft());

  // Reset draft when the panel opens — so re-opening after a Cancel does not
  // surface stale toggle state from a prior session.
  useEffect(() => {
    if (isCustomizePanelOpen) {
      setDraft(state ?? defaultDraft());
    }
  }, [isCustomizePanelOpen, state]);

  function save(): void {
    setState(draft);
    closeCustomizePanel();
  }

  return (
    <Dialog.Root
      open={isCustomizePanelOpen}
      onOpenChange={(open) => {
        if (!open) closeCustomizePanel();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink-850/70 motion-safe:animate-in motion-safe:fade-in" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[90vw] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-lg border-2 border-gold-400 bg-ink-850 p-6 text-ivory-200 motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95">
          <Dialog.Title className="font-display text-2xl text-gold-400">
            {COPY.customize.title}
          </Dialog.Title>
          <Dialog.Description className="mt-2 text-sm">
            {COPY.customize.description}
          </Dialog.Description>

          <div className="mt-6 space-y-4">
            <CategoryRow
              name={COPY.customize.categories.essential.name}
              description={COPY.customize.categories.essential.description}
              enabled={true}
              onToggle={() => {}}
              locked
            />
            <CategoryRow
              name={COPY.customize.categories.analytics.name}
              description={COPY.customize.categories.analytics.description}
              enabled={draft.analytics}
              onToggle={() => setDraft({ ...draft, analytics: !draft.analytics })}
            />
            <CategoryRow
              name={COPY.customize.categories.errors.name}
              description={COPY.customize.categories.errors.description}
              enabled={draft.errors}
              onToggle={() => setDraft({ ...draft, errors: !draft.errors })}
            />
          </div>

          <div className="mt-8 flex justify-end gap-2">
            <Dialog.Close asChild>
              <button
                type="button"
                // AC6 mandates initial focus on Cancel — autoFocus is the
                // committed mechanism (spec concern 3, T3 acceptance).
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus
                className="rounded border border-ivory-200 px-4 py-2 hover:bg-ivory-200/10"
              >
                {COPY.customize.cancel}
              </button>
            </Dialog.Close>
            <button
              type="button"
              onClick={save}
              className="rounded bg-gold-400 px-4 py-2 text-ink-850 hover:bg-gold-300"
            >
              {COPY.customize.save}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function CategoryRow({
  name,
  description,
  enabled,
  onToggle,
  locked,
}: {
  name: string;
  description: string;
  enabled: boolean;
  onToggle: () => void;
  locked?: boolean;
}) {
  const inputId = `consent-toggle-${name.toLowerCase().replace(/\s+/g, '-')}`;
  return (
    <div className="flex items-start gap-3">
      <input
        id={inputId}
        type="checkbox"
        checked={enabled}
        disabled={locked}
        onChange={onToggle}
        className="mt-1 accent-gold-400"
      />
      <label htmlFor={inputId} className="cursor-pointer">
        <span className="block font-medium">{name}</span>
        <span className="block text-sm text-ivory-200/80">{description}</span>
      </label>
    </div>
  );
}
