import { describe, it, expect, beforeEach } from 'vitest';
import { noopDriver, getDriver, clearBuffer } from '@/lib/analytics/driver';

beforeEach(() => {
  clearBuffer();
});

describe('noopDriver', () => {
  it('records capture calls', () => {
    noopDriver.capture({ name: 'landing_page_viewed', props: {} });
    noopDriver.capture({ name: 'signup_started', props: {} });
    expect(noopDriver.getEvents()).toHaveLength(2);
  });

  it('records identify calls', () => {
    noopDriver.identify('profile-1');
    noopDriver.identify('profile-2', { plan: 'autopay' });
    const calls = noopDriver.getIdentifies();
    expect(calls).toHaveLength(2);
    const second = calls[1];
    if (!second) throw new Error('expected two identify calls');
    expect(second.traits).toEqual({ plan: 'autopay' });
  });

  it('returns a copy of the buffer (callers cannot mutate it)', () => {
    noopDriver.capture({ name: 'landing_page_viewed', props: {} });
    const events = noopDriver.getEvents();
    // Try to mutate; should not affect the internal buffer.
    (events as unknown as Array<unknown>).push({ tampered: true });
    expect(noopDriver.getEvents()).toHaveLength(1);
  });

  it('clearBuffer resets both events and identifies', () => {
    noopDriver.capture({ name: 'landing_page_viewed', props: {} });
    noopDriver.identify('p1');
    clearBuffer();
    expect(noopDriver.getEvents()).toHaveLength(0);
    expect(noopDriver.getIdentifies()).toHaveLength(0);
  });
});

describe('getDriver', () => {
  it('returns the noop driver in slice 1', () => {
    expect(getDriver()).toBe(noopDriver);
  });
});
