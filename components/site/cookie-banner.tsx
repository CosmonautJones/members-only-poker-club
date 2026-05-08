'use client';

/**
 * T2 — `<CookieBanner />` per ADR-0024 + Slice-1 spec AC3 / AC4 / AC5.
 *
 * Render-after-hydration-only gate (concern 1):
 *   `!isLoaded || state !== null` → render nothing.
 *   `isLoaded && state === null`  → render the banner.
 *
 * Brand tokens come from the existing Tailwind config (`tailwind.config.ts`):
 * `ink-*`, `gold-*`, `ivory-*` are scaled keys. The `motion-safe:` variant
 * + `animate-in` utility from `tailwindcss-animate` provide the
 * `prefers-reduced-motion` gate per AC5 — when the OS-level reduce-motion
 * preference is on, motion-safe utilities are stripped automatically.
 *
 * No user-visible strings live in this file (concern 9 / AC4 binds copy to
 * `lib/consent/copy.ts`).
 */

import { useConsent } from './consent-provider';
import { COPY } from '@/lib/consent/copy';

export function CookieBanner() {
  const { state, isLoaded, setState, openCustomizePanel } = useConsent();

  // Render gate: pre-hydration, OR consent already given → render nothing.
  if (!isLoaded || state !== null) return null;

  function acceptAll(): void {
    setState({ essential: true, analytics: true, errors: true, version: 1 });
  }
  function essentialOnly(): void {
    setState({ essential: true, analytics: false, errors: false, version: 1 });
  }

  return (
    <div
      role="region"
      aria-label="Cookie consent"
      className="fixed bottom-4 right-4 z-50 max-w-md rounded-lg border-2 border-gold-400 bg-ink-850 p-6 text-ivory-200 shadow-lg motion-safe:animate-in motion-safe:slide-in-from-bottom-4"
    >
      <h2 className="font-display text-2xl text-gold-400">{COPY.banner.title}</h2>
      <p className="mt-2 text-sm">{COPY.banner.body}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={acceptAll}
          className="rounded bg-gold-400 px-4 py-2 text-ink-850 hover:bg-gold-300"
        >
          {COPY.banner.accept_all}
        </button>
        <button
          type="button"
          onClick={essentialOnly}
          className="rounded border border-ivory-200 px-4 py-2 hover:bg-ivory-200/10"
        >
          {COPY.banner.essential_only}
        </button>
        <button
          type="button"
          onClick={openCustomizePanel}
          className="rounded border border-ivory-200/50 px-4 py-2 hover:bg-ivory-200/10"
        >
          {COPY.banner.customize}
        </button>
      </div>
    </div>
  );
}
