'use client';

/**
 * T4 — `<CookiePreferencesLink />` per ADR-0024 + Slice-1 spec AC10.
 *
 * Re-entry button that opens the same customize panel instance used by the
 * banner. Per concern 5, the open/close state lives in `<ConsentProvider>`,
 * so this island and the banner's Customize button both flip
 * `isCustomizePanelOpen` on the shared provider — no second dialog instance.
 *
 * The visible label is `COPY.footer_link` ("Cookie preferences") — no
 * hardcoded strings (concern 9).
 */

import { useConsent } from './consent-provider';
import { COPY } from '@/lib/consent/copy';

export function CookiePreferencesLink({ className }: { className?: string }) {
  const { openCustomizePanel } = useConsent();
  return (
    <button
      type="button"
      onClick={openCustomizePanel}
      className={className ?? 'underline hover:text-gold-400'}
    >
      {COPY.footer_link}
    </button>
  );
}
