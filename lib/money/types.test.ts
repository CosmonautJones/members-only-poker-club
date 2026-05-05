import { describe, expect, it } from 'vitest';
import {
  HOURLY_RATE_CENTS,
  cents,
  centsToMinutes,
  formatMinutes,
  formatMoney,
  fromDollars,
  minutes,
  minutesToCents,
} from './types';

describe('money', () => {
  it('cents() rounds half-integer inputs', () => {
    expect(cents(2999.5)).toBe(3000);
    expect(cents(2999.4)).toBe(2999);
  });

  it('fromDollars() converts dollars to cents', () => {
    expect(fromDollars(30)).toBe(3000);
    expect(fromDollars(25)).toBe(2500);
    expect(fromDollars(0.01)).toBe(1);
  });

  it('formatMoney() renders USD', () => {
    expect(formatMoney(cents(3000))).toBe('$30.00');
    expect(formatMoney(cents(0))).toBe('$0.00');
    expect(formatMoney(cents(123456))).toBe('$1,234.56');
  });

  it('HOURLY_RATE_CENTS is $12.00', () => {
    expect(HOURLY_RATE_CENTS).toBe(1200);
  });

  it('minutesToCents and centsToMinutes round-trip near-perfectly', () => {
    const m = minutes(60);
    expect(minutesToCents(m)).toBe(1200);
    expect(centsToMinutes(cents(1200))).toBe(60);
  });

  it('formatMinutes renders human time', () => {
    expect(formatMinutes(minutes(0))).toBe('0m');
    expect(formatMinutes(minutes(45))).toBe('45m');
    expect(formatMinutes(minutes(60))).toBe('1h');
    expect(formatMinutes(minutes(135))).toBe('2h 15m');
  });
});
