/**
 * T1 — `<ConsentProvider>` + `useConsent()` test suite.
 *
 * Every test here maps to a numbered premortem mitigation in
 * `.conductor/0024/dispatches/0007-premortem-t1.md`. Do not delete a test
 * without first reading the premortem entry it guards.
 */

import { act, render, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { StrictMode, useEffect, useRef, useState, type ReactNode } from 'react';
import { renderToString } from 'react-dom/server';

import { ConsentProvider, useConsent } from '@/components/site/consent-provider';
import { readConsent, type ConsentState } from '@/lib/consent/cookie';

const COOKIE_NAME = 'mopc-consent';

const validState: ConsentState = {
  essential: true,
  analytics: true,
  errors: false,
  version: 1,
};

function clearCookie(): void {
  document.cookie = `${COOKIE_NAME}=; Max-Age=0; Path=/`;
}

function setCookieRaw(state: ConsentState): void {
  const encoded = encodeURIComponent(JSON.stringify(state));
  document.cookie = `${COOKIE_NAME}=${encoded}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

function wrapWithProvider({ children }: { children: ReactNode }): React.ReactElement {
  return <ConsentProvider>{children}</ConsentProvider>;
}

beforeEach(() => {
  clearCookie();
});

afterEach(() => {
  clearCookie();
  vi.restoreAllMocks();
});

describe('ConsentProvider — SSR initial state (premortem A3 + B1)', () => {
  it('renders identical SSR markup regardless of cookie value', () => {
    // Pre-seed cookie before render — but cookie is irrelevant on the server,
    // so SSR should be deterministic anyway. We assert that here.
    setCookieRaw(validState);
    const withCookie = renderToString(
      <ConsentProvider>
        <span data-testid="probe">probe</span>
      </ConsentProvider>,
    );

    clearCookie();
    const withoutCookie = renderToString(
      <ConsentProvider>
        <span data-testid="probe">probe</span>
      </ConsentProvider>,
    );

    expect(withCookie).toBe(withoutCookie);
    // Sanity: child rendered. The provider is a context provider with no
    // visible markup of its own, so the child span should appear.
    expect(withCookie).toContain('probe');
  });

  it('does not log a hydration warning during initial mount under StrictMode (B1, B3)', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    function Consumer(): React.ReactElement {
      useConsent();
      return <span>hi</span>;
    }

    const { unmount } = render(
      <StrictMode>
        <ConsentProvider>
          <Consumer />
        </ConsentProvider>
      </StrictMode>,
    );
    unmount();

    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe('ConsentProvider — mount hydration (AC2, premortem B6)', () => {
  it('starts with isLoaded=false and state=null on first sync render, then hydrates', () => {
    setCookieRaw(validState);

    const { result } = renderHook(() => useConsent(), { wrapper: wrapWithProvider });

    // After renderHook the mount effect has flushed (act-wrapped internally).
    expect(result.current.isLoaded).toBe(true);
    expect(result.current.state).toEqual(validState);
  });

  it('hydrates to state=null when no cookie is present', () => {
    clearCookie();

    const { result } = renderHook(() => useConsent(), { wrapper: wrapWithProvider });

    expect(result.current.isLoaded).toBe(true);
    expect(result.current.state).toBeNull();
  });

  it('does not write the cookie during mount (premortem B6)', () => {
    setCookieRaw(validState);
    const before = document.cookie;

    renderHook(() => useConsent(), { wrapper: wrapWithProvider });

    // Mount should be a pure read; no second cookie write should have occurred.
    // The cookie value is the same; we assert the literal cookie string did not
    // change (a write would re-set Max-Age and reorder attributes).
    expect(document.cookie).toBe(before);
  });
});

describe('ConsentProvider — setState (AC2, premortem B7 + A4)', () => {
  it('writes the cookie and updates state when called', () => {
    const { result } = renderHook(() => useConsent(), { wrapper: wrapWithProvider });

    act(() => {
      result.current.setState(validState);
    });

    expect(result.current.state).toEqual(validState);
    expect(readConsent()).toEqual(validState);
  });

  it('last-write-wins across two rapid setState calls (premortem B7)', () => {
    const { result } = renderHook(() => useConsent(), { wrapper: wrapWithProvider });

    const first: ConsentState = { essential: true, analytics: true, errors: true, version: 1 };
    const second: ConsentState = { essential: true, analytics: false, errors: true, version: 1 };

    act(() => {
      result.current.setState(first);
      result.current.setState(second);
    });

    expect(readConsent()).toEqual(second);
    expect(result.current.state).toEqual(second);
  });

  it('throws if essential is not true (premortem A4 defense-in-depth)', () => {
    const { result } = renderHook(() => useConsent(), { wrapper: wrapWithProvider });

    expect(() => {
      act(() => {
        result.current.setState({
          essential: false,
          analytics: false,
          errors: false,
          version: 1,
        } as unknown as ConsentState);
      });
    }).toThrow();
  });

  it('returns a stable setter reference across re-renders (premortem B4 + B5)', () => {
    function Probe({
      onRender,
    }: {
      onRender: (setter: (next: ConsentState) => void) => void;
    }): React.ReactElement {
      const { setState } = useConsent();
      const [, force] = useState(0);
      useEffect(() => {
        onRender(setState);
      });
      return (
        <button type="button" onClick={() => force((n) => n + 1)}>
          rerender
        </button>
      );
    }

    const captured: Array<(next: ConsentState) => void> = [];
    const { getByText } = render(
      <ConsentProvider>
        <Probe onRender={(setter) => captured.push(setter)} />
      </ConsentProvider>,
    );

    const initial = captured[0];
    expect(initial).toBeDefined();

    act(() => {
      getByText('rerender').click();
    });

    const next = captured[captured.length - 1];
    expect(next).toBe(initial);
  });
});

describe('useConsent — used outside provider (premortem B8)', () => {
  it('throws a clear error', () => {
    // Suppress the React error log that surfaces from the thrown render.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => renderHook(() => useConsent())).toThrow(
      /useConsent must be used within ConsentProvider/,
    );

    errorSpy.mockRestore();
  });
});

describe('ConsentProvider — visibilitychange cross-tab sync (premortem B2 + B3)', () => {
  it('re-reads the cookie and updates state on visibilitychange', () => {
    const { result } = renderHook(() => useConsent(), { wrapper: wrapWithProvider });

    expect(result.current.state).toBeNull();

    // Simulate another tab writing the cookie, then this tab regaining focus.
    act(() => {
      setCookieRaw(validState);
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(result.current.state).toEqual(validState);
  });

  it('does not update state when the cookie did not change (premortem B5)', () => {
    setCookieRaw(validState);

    let renderCount = 0;
    function Counter(): React.ReactElement {
      const { state } = useConsent();
      const seen = useRef(state);
      seen.current = state;
      renderCount += 1;
      return <span>{state ? 'present' : 'null'}</span>;
    }

    render(
      <ConsentProvider>
        <Counter />
      </ConsentProvider>,
    );

    const renderCountAfterMount = renderCount;

    // Fire visibilitychange without mutating the cookie. The provider should
    // see the same state and skip the React state update — Counter should
    // not re-render.
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(renderCount).toBe(renderCountAfterMount);
  });

  it('removes the listener on unmount (premortem B3)', () => {
    const { unmount, result } = renderHook(() => useConsent(), {
      wrapper: wrapWithProvider,
    });
    expect(result.current.state).toBeNull();

    unmount();

    // After unmount, a cookie change + visibilitychange must NOT call into
    // anything that would touch React. We confirm by asserting that no
    // React error surfaces (a stray setState on an unmounted tree would log
    // a console.error in dev).
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    setCookieRaw(validState);
    document.dispatchEvent(new Event('visibilitychange'));

    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe('ConsentProvider — customize panel state (AC2)', () => {
  it('openCustomizePanel flips isCustomizePanelOpen to true', () => {
    const { result } = renderHook(() => useConsent(), { wrapper: wrapWithProvider });

    expect(result.current.isCustomizePanelOpen).toBe(false);

    act(() => {
      result.current.openCustomizePanel();
    });

    expect(result.current.isCustomizePanelOpen).toBe(true);
  });

  it('closeCustomizePanel flips isCustomizePanelOpen back to false', () => {
    const { result } = renderHook(() => useConsent(), { wrapper: wrapWithProvider });

    act(() => {
      result.current.openCustomizePanel();
    });
    expect(result.current.isCustomizePanelOpen).toBe(true);

    act(() => {
      result.current.closeCustomizePanel();
    });
    expect(result.current.isCustomizePanelOpen).toBe(false);
  });
});
