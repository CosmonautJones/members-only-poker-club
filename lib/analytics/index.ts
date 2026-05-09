/**
 * Public analytics surface — ADR-0028 slice 1.
 *
 * Consumer call sites:
 *
 *   import { track } from '@/lib/analytics';
 *   track({ name: 'time_topup_completed', props: { tier: '200', gross_cents: 20000, bonus_cents: 10000 } });
 *
 * The driver is currently a noop (records to an in-memory buffer); the
 * PostHog driver lands in a follow-up slice once the API key is configured.
 */
export { track, trackServer, identify } from './track';
export { EVENT_NAMES } from './events';
export type { Events, TopupTier } from './events';
export { clearBuffer, noopDriver, getDriver } from './driver';
export type { Driver } from './driver';
