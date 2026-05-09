'use client';

/**
 * T1 — `useConsent()` hook + `<ConsentProvider>` per ADR-0024 + Slice-1 spec.
 *
 * This module is the load-bearing piece of the consent surface. Every gate
 * (analytics, errors, footer link, banner) reads from this provider. Every
 * implementation choice below traces back to a numbered premortem mitigation
 * in `.conductor/0024/dispatches/0007-premortem-t1.md`. Do not "simplify" any
 * of these — the comments explain why.
 *
 *   B1  Constant SSR initial state (no cookie reads in `useState` initializer)
 *   B6  Mount effect uses an INTERNAL setter that does NOT write the cookie
 *   A4  `setState` only accepts the full `ConsentState` (defense-in-depth on
 *        the literal-`true` `essential` type already enforced in T0)
 *   A2  No `posthog-js` / `@sentry/*` imports anywhere in this module
 *   B2  `visibilitychange` listener re-reads cookie when the tab regains focus
 *   B3  Effect returns a cleanup that removes the listener on unmount
 *   B4  Setters are `useCallback`-stable with `[]` deps; no partial-update
 *        overload that would close over stale state
 *   B5  Context value memoized via `useMemo` — consumers don't re-render
 *        when an unrelated piece of state changes
 *   B8  Default context value is `undefined`; `useConsent` throws clearly
 *        when used outside a `<ConsentProvider>`
 *   A3  Provider does NOT call `cookies()` from `next/headers`. SSR output is
 *        consent-state-independent so Vercel edge-cached HTML cannot leak one
 *        user's consent decision to another.
 *   B7  Cookie write is synchronous and happens BEFORE the React state
 *        update — cookie is the source of truth.
 *   A1  This module renders no user-visible strings. Banner / panel copy
 *        flows from `lib/consent/copy.ts` per concern 9.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { readConsent, writeConsent, type ConsentState } from '@/lib/consent/cookie';

type ConsentContextValue = {
  state: ConsentState | null;
  isLoaded: boolean;
  isCustomizePanelOpen: boolean;
  setState: (next: ConsentState) => void;
  openCustomizePanel: () => void;
  closeCustomizePanel: () => void;
};

// Default is `undefined` (not a placeholder shape) so `useConsent()` can
// fail-fast outside a provider — see B8.
const ConsentContext = createContext<ConsentContextValue | undefined>(undefined);

function isSameState(a: ConsentState | null, b: ConsentState | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return (
    a.essential === b.essential &&
    a.analytics === b.analytics &&
    a.errors === b.errors &&
    a.version === b.version
  );
}

export function ConsentProvider({ children }: { children: ReactNode }): JSX.Element {
  // B1 / A3 — initializers are pure constants; SSR markup is identical for
  // every visitor regardless of cookie value.
  const [state, setStateRaw] = useState<ConsentState | null>(null);
  const [isLoaded, setIsLoaded] = useState<boolean>(false);
  const [isCustomizePanelOpen, setIsCustomizePanelOpen] = useState<boolean>(false);

  // B6 — Mount effect uses the INTERNAL state setter directly. It MUST NOT
  // call `setState` (the public, persisting setter), or the cookie write
  // would re-trigger the visibilitychange listener and risk a feedback loop.
  useEffect(() => {
    const fresh = readConsent();
    setStateRaw(fresh);
    setIsLoaded(true);
  }, []);

  // B2 / B3 — Cross-tab sync: when the tab regains visibility, re-read the
  // cookie (another tab may have written it) and update state if it changed.
  // Cleanup removes the listener on unmount.
  useEffect(() => {
    function onVisibilityChange(): void {
      if (typeof document === 'undefined') return;
      if (document.visibilityState !== 'visible') return;
      const fresh = readConsent();
      setStateRaw((prev) => (isSameState(prev, fresh) ? prev : fresh));
    }
    if (typeof document === 'undefined') return undefined;
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  // B4 / B7 — `setState` accepts the COMPLETE next state and writes the
  // cookie SYNCHRONOUSLY before updating React state. No partial-update
  // overload exists; callers that want to "merge" must read `state`
  // themselves and pass the full new object.
  //
  // A4 — Defense-in-depth. The literal-`true` `essential` type rejects
  // bad payloads at compile time; this runtime guard catches JS-only
  // callers (a future server action, a misbehaving test, etc.).
  const setState = useCallback((next: ConsentState): void => {
    if (next.essential !== true) {
      throw new Error('Essential consent is locked at true and cannot be revoked');
    }
    writeConsent(next);
    setStateRaw(next);
  }, []);

  const openCustomizePanel = useCallback((): void => {
    setIsCustomizePanelOpen(true);
  }, []);

  const closeCustomizePanel = useCallback((): void => {
    setIsCustomizePanelOpen(false);
  }, []);

  // B5 — memoize the context value so consumers only re-render when one of
  // the actual fields changes. The setter callbacks are themselves stable
  // because of the `useCallback([], ...)` above.
  const value = useMemo<ConsentContextValue>(
    () => ({
      state,
      isLoaded,
      isCustomizePanelOpen,
      setState,
      openCustomizePanel,
      closeCustomizePanel,
    }),
    [state, isLoaded, isCustomizePanelOpen, setState, openCustomizePanel, closeCustomizePanel],
  );

  return <ConsentContext.Provider value={value}>{children}</ConsentContext.Provider>;
}

/**
 * Read consent state and helpers from the surrounding `<ConsentProvider>`.
 *
 * Throws if used outside the provider tree (B8). The thrown message is
 * developer-only — no user-facing string lives in this module per concern 9.
 */
export function useConsent(): ConsentContextValue {
  const value = useContext(ConsentContext);
  if (value === undefined) {
    throw new Error('useConsent must be used within ConsentProvider');
  }
  return value;
}
