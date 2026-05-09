/**
 * Analytics event taxonomy — ADR-0028.
 *
 * Each event is a discriminated-union variant keyed on `name`. Adding a new
 * event:
 *   1. Add a variant below.
 *   2. Update the funnel definition in PostHog (out-of-band).
 *   3. Call sites use `track({ name: 'foo', props: { ... } })` and the
 *      compiler narrows the props shape based on the name.
 */

export type TopupTier = '50' | '100' | '200' | '500';

export type Events =
  | { name: 'landing_page_viewed'; props: Record<string, never> }
  | { name: 'membership_page_viewed'; props: Record<string, never> }
  | { name: 'signup_started'; props: Record<string, never> }
  | { name: 'signup_email_submitted'; props: Record<string, never> }
  | { name: 'signup_id_uploaded'; props: Record<string, never> }
  | { name: 'signup_agreement_signed'; props: Record<string, never> }
  | { name: 'signup_payment_completed'; props: Record<string, never> }
  | { name: 'signup_completed'; props: Record<string, never> }
  | {
      name: 'membership_billing_kind_switched';
      props: { from: 'autopay' | 'invoice'; to: 'autopay' | 'invoice' };
    }
  | { name: 'membership_canceled'; props: { reason?: string } }
  | { name: 'time_topup_page_viewed'; props: Record<string, never> }
  | { name: 'time_topup_tier_selected'; props: { tier: TopupTier } }
  | {
      name: 'time_topup_completed';
      props: { tier: TopupTier; gross_cents: number; bonus_cents: number };
    }
  | { name: 'tournament_page_viewed'; props: { tournament_slug: string } }
  | { name: 'tournament_register_started'; props: { tournament_slug: string } }
  | {
      name: 'tournament_register_completed';
      props: { tournament_slug: string; paid_cents: number };
    }
  | { name: 'cashier_redeem_completed'; props: { minutes: number } };

/**
 * Compile-time exhaustiveness check: if a new event is added to `Events`
 * without updating EVENT_NAMES, TypeScript complains.
 */
export const EVENT_NAMES: ReadonlyArray<Events['name']> = [
  'landing_page_viewed',
  'membership_page_viewed',
  'signup_started',
  'signup_email_submitted',
  'signup_id_uploaded',
  'signup_agreement_signed',
  'signup_payment_completed',
  'signup_completed',
  'membership_billing_kind_switched',
  'membership_canceled',
  'time_topup_page_viewed',
  'time_topup_tier_selected',
  'time_topup_completed',
  'tournament_page_viewed',
  'tournament_register_started',
  'tournament_register_completed',
  'cashier_redeem_completed',
] as const;
