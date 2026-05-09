import { describe, it, expect } from 'vitest';
import { EVENT_NAMES, type Events } from '@/lib/analytics/events';

describe('EVENT_NAMES is in sync with the Events union', () => {
  it('contains every event from the ADR-0028 taxonomy', () => {
    // Compile-time: if any of these names are misspelled, TypeScript fails.
    // Runtime: assert each is present in EVENT_NAMES.
    const expected: Array<Events['name']> = [
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
      'experiment_exposed',
    ];
    for (const name of expected) {
      expect(EVENT_NAMES).toContain(name);
    }
    // No silent extras.
    expect(EVENT_NAMES.length).toBe(expected.length);
  });

  it('events are unique', () => {
    const set = new Set(EVENT_NAMES);
    expect(set.size).toBe(EVENT_NAMES.length);
  });
});

describe('Events typed payloads', () => {
  it('time_topup_completed carries tier + gross_cents + bonus_cents', () => {
    const ev: Events = {
      name: 'time_topup_completed',
      props: { tier: '200', gross_cents: 20_000, bonus_cents: 10_000 },
    };
    expect(ev.props.tier).toBe('200');
    expect(ev.props.gross_cents).toBe(20_000);
    expect(ev.props.bonus_cents).toBe(10_000);
  });

  it('membership_billing_kind_switched carries from + to', () => {
    const ev: Events = {
      name: 'membership_billing_kind_switched',
      props: { from: 'invoice', to: 'autopay' },
    };
    expect(ev.props.from).toBe('invoice');
    expect(ev.props.to).toBe('autopay');
  });

  it('tournament_register_completed carries paid_cents', () => {
    const ev: Events = {
      name: 'tournament_register_completed',
      props: { tournament_slug: 'friday-bounty', paid_cents: 5000 },
    };
    expect(ev.props.paid_cents).toBe(5000);
  });

  it('cashier_redeem_completed carries minutes', () => {
    const ev: Events = {
      name: 'cashier_redeem_completed',
      props: { minutes: 90 },
    };
    expect(ev.props.minutes).toBe(90);
  });
});
