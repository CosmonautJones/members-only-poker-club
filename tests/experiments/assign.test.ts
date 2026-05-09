import { describe, it, expect } from 'vitest';
import { assignVariant, HOLDOUT } from '@/lib/experiments';
import type { ExperimentDefinition } from '@/lib/experiments/types';

function exp(overrides: Partial<ExperimentDefinition> = {}): ExperimentDefinition {
  return {
    name: 'hero-cta-v1',
    variants: ['control', 'v1'],
    holdoutPercent: 10,
    enabled: true,
    owner: 'test',
    ...overrides,
  };
}

describe('assignVariant / disabled experiment', () => {
  it('returns control for everyone when enabled is false', () => {
    expect(assignVariant(exp({ enabled: false }), { profileId: 'p1' })).toBe('control');
    expect(assignVariant(exp({ enabled: false }), { profileId: 'p999' })).toBe('control');
    expect(assignVariant(exp({ enabled: false }))).toBe('control');
  });
});

describe('assignVariant / anonymous traffic', () => {
  it('returns control for anonymous traffic', () => {
    expect(assignVariant(exp())).toBe('control');
  });
});

describe('assignVariant / determinism', () => {
  it('returns the same variant for the same (profile, experiment) pair', () => {
    const a = assignVariant(exp(), { profileId: 'profile-abc' });
    const b = assignVariant(exp(), { profileId: 'profile-abc' });
    const c = assignVariant(exp(), { profileId: 'profile-abc' });
    expect(a).toBe(b);
    expect(b).toBe(c);
  });
});

describe('assignVariant / holdout', () => {
  it('produces ~holdoutPercent % of holdout assignments', () => {
    const N = 10_000;
    let holdouts = 0;
    for (let i = 0; i < N; i++) {
      const v = assignVariant(exp({ holdoutPercent: 10 }), { profileId: `profile-${i}` });
      if (v === HOLDOUT) holdouts++;
    }
    const ratio = holdouts / N;
    expect(ratio).toBeGreaterThan(0.07);
    expect(ratio).toBeLessThan(0.13);
  });

  it('returns no holdouts when holdoutPercent is 0', () => {
    let holdouts = 0;
    for (let i = 0; i < 1_000; i++) {
      if (assignVariant(exp({ holdoutPercent: 0 }), { profileId: `p-${i}` }) === HOLDOUT) {
        holdouts++;
      }
    }
    expect(holdouts).toBe(0);
  });
});

describe('assignVariant / variant distribution', () => {
  it('splits remaining traffic equally across variants by default (control vs v1)', () => {
    const N = 10_000;
    const counts = { control: 0, v1: 0, [HOLDOUT]: 0 };
    for (let i = 0; i < N; i++) {
      const v = assignVariant(exp({ holdoutPercent: 10 }), { profileId: `profile-${i}` });
      counts[v as keyof typeof counts]++;
    }
    const nonHoldout = N - counts[HOLDOUT];
    // Each variant should get ~45% of total (50% of the 90% non-holdout pool).
    const controlRatio = counts.control / nonHoldout;
    const v1Ratio = counts.v1 / nonHoldout;
    expect(controlRatio).toBeGreaterThan(0.45);
    expect(controlRatio).toBeLessThan(0.55);
    expect(v1Ratio).toBeGreaterThan(0.45);
    expect(v1Ratio).toBeLessThan(0.55);
  });

  it('respects custom weights', () => {
    const N = 10_000;
    const counts = { control: 0, v1: 0, [HOLDOUT]: 0 };
    for (let i = 0; i < N; i++) {
      const v = assignVariant(exp({ weights: [0.2, 0.8], holdoutPercent: 0 }), {
        profileId: `profile-${i}`,
      });
      counts[v as keyof typeof counts]++;
    }
    const controlRatio = counts.control / N;
    const v1Ratio = counts.v1 / N;
    expect(controlRatio).toBeGreaterThan(0.15);
    expect(controlRatio).toBeLessThan(0.25);
    expect(v1Ratio).toBeGreaterThan(0.75);
    expect(v1Ratio).toBeLessThan(0.85);
  });

  it('throws when weights length mismatches variants length', () => {
    expect(() => assignVariant(exp({ weights: [0.5] }), { profileId: 'p' })).toThrow(
      /weights length/,
    );
  });
});
