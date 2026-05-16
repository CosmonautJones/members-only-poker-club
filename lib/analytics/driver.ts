/**
 * Analytics driver interface — ADR-0028.
 *
 * Slice 1 ships only `noopDriver`, which records calls to an in-memory
 * buffer (used in tests and as the default until the PostHog-init slice
 * lands). The PostHog client driver swaps in via a follow-up slice once the
 * `NEXT_PUBLIC_POSTHOG_KEY` secret is configured.
 */
import type { Events } from './events';
import { nowUtc } from '../time';

export interface Driver {
  capture(event: Events): void;
  // eslint-disable-next-line @typescript-eslint/no-duplicate-type-constituents
  identify(profileId: string, traits?: Record<string, unknown> | undefined): void;
}

interface CapturedEvent {
  event: Events;
  ts: number;
}

interface IdentifyCall {
  profileId: string;
  // eslint-disable-next-line @typescript-eslint/no-duplicate-type-constituents
  traits?: Record<string, unknown> | undefined;
  ts: number;
}

/**
 * In-memory driver. Used as the default until the PostHog driver lands,
 * and as the test-time driver everywhere. The buffer is process-local;
 * `clearBuffer()` resets it between tests.
 */
class NoopDriver implements Driver {
  private events: CapturedEvent[] = [];
  private identifies: IdentifyCall[] = [];

  capture(event: Events): void {
    this.events.push({ event, ts: nowUtc().getTime() });
  }

  identify(profileId: string, traits?: Record<string, unknown>): void {
    this.identifies.push({ profileId, traits, ts: nowUtc().getTime() });
  }

  /** Test helper. Returns a copy so callers can't mutate the buffer. */
  getEvents(): readonly CapturedEvent[] {
    return [...this.events];
  }

  getIdentifies(): readonly IdentifyCall[] {
    return [...this.identifies];
  }

  clear(): void {
    this.events = [];
    this.identifies = [];
  }
}

export const noopDriver = new NoopDriver();

/**
 * Returns the active driver. Slice 1 always returns the noop driver; the
 * PostHog-init follow-up slice will branch on `process.env.NEXT_PUBLIC_POSTHOG_KEY`
 * (truthy → posthog driver; falsy → noop). Keeping this getter so the
 * client/server `track` modules don't have to be edited when the swap
 * happens.
 */
export function getDriver(): Driver {
  return noopDriver;
}

/**
 * Test helper: clears the noop driver's buffer. Re-exported from
 * `lib/analytics/index.ts`.
 */
export function clearBuffer(): void {
  noopDriver.clear();
}
