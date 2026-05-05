/**
 * Money in this app is integer cents. Time is integer minutes.
 * See ADR-0004 (Money handling — integer cents, currency).
 *
 * The branded type prevents accidentally mixing cents with dollars
 * or with other unit-less numbers.
 */

export type Cents = number & { readonly __brand: 'Cents' };
export type Minutes = number & { readonly __brand: 'Minutes' };

export const cents = (n: number): Cents => Math.round(n) as Cents;
export const minutes = (n: number): Minutes => Math.round(n) as Minutes;

export const fromDollars = (d: number): Cents => Math.round(d * 100) as Cents;

/** Format as USD using Intl. */
export const formatMoney = (c: Cents): string =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(c / 100);

/** Format minutes as "Hh Mm" (e.g., "2h 15m"). */
export const formatMinutes = (m: Minutes): string => {
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r}m`;
  if (r === 0) return `${h}h`;
  return `${h}h ${r}m`;
};

/** Convert minutes to cents at $12/hour (1c = 0.5 minute). */
export const HOURLY_RATE_CENTS = fromDollars(12);
export const minutesToCents = (m: Minutes): Cents =>
  Math.round((m / 60) * HOURLY_RATE_CENTS) as Cents;
export const centsToMinutes = (c: Cents): Minutes =>
  Math.round((c / HOURLY_RATE_CENTS) * 60) as Minutes;
