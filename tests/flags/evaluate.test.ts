import { describe, it, expect } from 'vitest';
import { bucketFor, evaluateFlag } from '@/lib/flags/evaluate';
import type { FlagDefinition } from '@/lib/flags/types';

function flag(overrides: Partial<FlagDefinition> = {}): FlagDefinition {
  return {
    key: 'kill-stripe-webhook',
    enabled: true,
    percent: 0,
    allowlist: [],
    owner: 'test',
    ...overrides,
  };
}

describe('evaluateFlag / kill-switch precedence', () => {
  it('returns false when enabled is false, regardless of percent', () => {
    expect(evaluateFlag(flag({ enabled: false, percent: 100 }))).toBe(false);
  });

  it('returns false when enabled is false even when allowlisted', () => {
    expect(evaluateFlag(flag({ enabled: false, allowlist: ['p1'] }), { profileId: 'p1' })).toBe(
      false,
    );
  });
});

describe('evaluateFlag / allowlist', () => {
  it('returns true when profileId is in allowlist (overrides percent=0)', () => {
    expect(evaluateFlag(flag({ percent: 0, allowlist: ['p1'] }), { profileId: 'p1' })).toBe(true);
  });

  it('returns false when profileId is not in allowlist and percent=0', () => {
    expect(evaluateFlag(flag({ percent: 0, allowlist: ['p1'] }), { profileId: 'p2' })).toBe(false);
  });

  it('does not consider allowlist for anonymous traffic', () => {
    expect(evaluateFlag(flag({ percent: 0, allowlist: ['p1'] }))).toBe(false);
  });
});

describe('evaluateFlag / percent', () => {
  it('returns true for everyone at percent=100', () => {
    expect(evaluateFlag(flag({ percent: 100 }), { profileId: 'p1' })).toBe(true);
    expect(evaluateFlag(flag({ percent: 100 }), { profileId: 'p2' })).toBe(true);
  });

  it('returns false for everyone at percent=0', () => {
    expect(evaluateFlag(flag({ percent: 0 }), { profileId: 'p1' })).toBe(false);
    expect(evaluateFlag(flag({ percent: 0 }), { profileId: 'p99999' })).toBe(false);
  });

  it('returns false for anonymous traffic at percent < 100', () => {
    expect(evaluateFlag(flag({ percent: 50 }))).toBe(false);
    expect(evaluateFlag(flag({ percent: 99 }))).toBe(false);
  });

  it('returns true for anonymous traffic at percent=100', () => {
    expect(evaluateFlag(flag({ percent: 100 }))).toBe(true);
  });

  it('is deterministic: same profileId+key always yields same allocation', () => {
    const a1 = evaluateFlag(flag({ percent: 50 }), { profileId: 'profile-abc' });
    const a2 = evaluateFlag(flag({ percent: 50 }), { profileId: 'profile-abc' });
    const a3 = evaluateFlag(flag({ percent: 50 }), { profileId: 'profile-abc' });
    expect(a1).toBe(a2);
    expect(a2).toBe(a3);
  });

  it('allocates close to the expected percent across many profiles', () => {
    const N = 10_000;
    let trues = 0;
    for (let i = 0; i < N; i++) {
      if (evaluateFlag(flag({ percent: 30 }), { profileId: `profile-${i}` })) trues++;
    }
    // 30% target. Allow generous ±5 percentage points for hash distribution.
    const ratio = trues / N;
    expect(ratio).toBeGreaterThan(0.25);
    expect(ratio).toBeLessThan(0.35);
  });

  it('keys produce independent allocations (a 50% A flag is not the same set as a 50% B flag)', () => {
    const N = 5_000;
    let inA = 0;
    let inB = 0;
    let inBoth = 0;
    for (let i = 0; i < N; i++) {
      const profileId = `profile-${i}`;
      const a = evaluateFlag(flag({ key: 'kill-stripe-webhook', percent: 50 }), { profileId });
      // Use a synthesized key just for the independence test. The evaluator
      // doesn't enforce that the key is in the registry — only the public
      // isEnabled() does.
      const b = evaluateFlag({ ...flag({ percent: 50 }), key: 'flag-b' as never }, { profileId });
      if (a) inA++;
      if (b) inB++;
      if (a && b) inBoth++;
    }
    // Independent uniform: P(both) ≈ P(A) × P(B) = 0.25. If keys weren't
    // mixed into the hash, P(both) would be ≈ 0.5 (perfectly correlated).
    const bothRatio = inBoth / N;
    expect(bothRatio).toBeGreaterThan(0.2);
    expect(bothRatio).toBeLessThan(0.3);
  });
});

describe('evaluateFlag / role gate', () => {
  it('blocks members from a manager-gated flag at percent=100', () => {
    expect(
      evaluateFlag(flag({ percent: 100, roleGate: 'manager' }), {
        profileId: 'p1',
        role: 'member',
      }),
    ).toBe(false);
  });

  it('blocks cashiers from a manager-gated flag', () => {
    expect(
      evaluateFlag(flag({ percent: 100, roleGate: 'manager' }), {
        profileId: 'p1',
        role: 'cashier',
      }),
    ).toBe(false);
  });

  it('allows manager and owner through a manager-gated flag', () => {
    expect(
      evaluateFlag(flag({ percent: 100, roleGate: 'manager' }), {
        profileId: 'p1',
        role: 'manager',
      }),
    ).toBe(true);
    expect(
      evaluateFlag(flag({ percent: 100, roleGate: 'manager' }), {
        profileId: 'p2',
        role: 'owner',
      }),
    ).toBe(true);
  });

  it('blocks anonymous traffic from any role-gated flag', () => {
    expect(evaluateFlag(flag({ percent: 100, roleGate: 'cashier' }))).toBe(false);
  });

  it('role-gated flag still respects percent within the gated population', () => {
    // 0% rollout, manager-gated → manager still gets false (gate passes,
    // then percent=0 fails).
    expect(
      evaluateFlag(flag({ percent: 0, roleGate: 'manager' }), {
        profileId: 'p1',
        role: 'manager',
      }),
    ).toBe(false);
  });
});

describe('bucketFor', () => {
  it('returns 0..99', () => {
    for (let i = 0; i < 100; i++) {
      const b = bucketFor(`profile-${i}`, 'k');
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(100);
    }
  });

  it('is deterministic', () => {
    expect(bucketFor('profile-x', 'k')).toBe(bucketFor('profile-x', 'k'));
  });

  it('changes with the key', () => {
    // Not strictly guaranteed for any one input, but extremely improbable
    // that all three differ if the key isn't mixed in.
    const a = bucketFor('profile-x', 'k1');
    const b = bucketFor('profile-x', 'k2');
    const c = bucketFor('profile-x', 'k3');
    // At least one of the three should differ from another.
    expect(a === b && b === c).toBe(false);
  });
});
