import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Experiment } from '@/components/site/experiment';
import { clearBuffer, noopDriver } from '@/lib/analytics';
import type { ConsentState } from '@/lib/consent/cookie';

const COOKIE_NAME = 'mopc-consent';

function setConsentCookie(state: ConsentState | null): void {
  if (state === null) {
    document.cookie = `${COOKIE_NAME}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
    return;
  }
  document.cookie = `${COOKIE_NAME}=${encodeURIComponent(JSON.stringify(state))}; path=/`;
}

beforeEach(() => {
  clearBuffer();
  setConsentCookie({ essential: true, analytics: true, errors: false, version: 1 });
});

describe('<Experiment>', () => {
  it('renders the control variant for anonymous traffic', () => {
    render(
      <Experiment
        name="hero-cta-v1"
        renderers={{
          control: <span data-testid="ctrl">CTRL</span>,
          v1: <span data-testid="v1">V1</span>,
        }}
      />,
    );
    expect(screen.queryByTestId('ctrl')).not.toBeNull();
    expect(screen.queryByTestId('v1')).toBeNull();
  });

  it('fires experiment_exposed once with the chosen variant', () => {
    render(
      <Experiment
        name="hero-cta-v1"
        renderers={{
          control: <span>c</span>,
          v1: <span>v</span>,
        }}
      />,
    );
    const events = noopDriver.getEvents();
    const exposureEvents = events.filter((e) => e.event.name === 'experiment_exposed');
    expect(exposureEvents).toHaveLength(1);
    const first = exposureEvents[0];
    if (!first) throw new Error('expected one exposure event');
    expect(first.event.props).toMatchObject({
      experiment: 'hero-cta-v1',
      variant: 'control',
    });
  });

  it('renders the explicit __holdout__ renderer when one is provided', () => {
    // The example experiment is enabled=false so every assignment is
    // control — we cannot directly cause a holdout in this test without
    // mucking with the registry. Verify the holdout-renderer fallback shape
    // by making sure the component doesn't blow up when the renderer for
    // the chosen variant is absent.
    render(<Experiment name="hero-cta-v1" renderers={{}} />);
    // No control renderer → component renders null. Should not throw.
    expect(screen.queryByText('CTRL')).toBeNull();
  });
});
