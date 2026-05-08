import { describe, it, expect } from 'vitest';
import { validateConductorSkill } from './validate-skill';

describe('validateConductorSkill', () => {
  it('returns an errors array (structurally complete)', () => {
    const result = validateConductorSkill();
    expect(result).toHaveProperty('errors');
    expect(Array.isArray(result.errors)).toBe(true);
    for (const e of result.errors) {
      expect(typeof e).toBe('string');
    }
  });

  it('reports zero errors — skill is fully assembled', () => {
    const result = validateConductorSkill();
    if (result.errors.length > 0) {
      // Expose the actual errors when this assertion fails so CI failures
      // are diagnostic instead of `[] !== [...]`.
      throw new Error(
        `validator reported ${result.errors.length} error(s):\n  - ${result.errors.join('\n  - ')}`,
      );
    }
    expect(result.errors).toEqual([]);
  });
});
