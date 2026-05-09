import { describe, it, expect } from 'vitest';
import { isEnabled, FLAGS } from '@/lib/flags';

describe('isEnabled / public API', () => {
  it('reads kill-stripe-webhook from the registry (default: false)', () => {
    expect(isEnabled('kill-stripe-webhook')).toBe(false);
  });

  it('every registered flag has an owner', () => {
    for (const key of Object.keys(FLAGS) as Array<keyof typeof FLAGS>) {
      expect(FLAGS[key].owner, `${key} must have an owner`).toBeTruthy();
    }
  });

  it('every kill-prefixed flag defaults to enabled=false (kill-switch off)', () => {
    for (const [key, def] of Object.entries(FLAGS)) {
      if (!key.startsWith('kill-')) continue;
      expect(def.enabled, `kill-switch ${key} must default to enabled=false`).toBe(false);
    }
  });

  it('every flag key is kebab-case (matches the schema CHECK)', () => {
    const re = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
    for (const key of Object.keys(FLAGS)) {
      expect(key, `${key} must be kebab-case`).toMatch(re);
    }
  });

  it('every flag percent is in 0..100', () => {
    for (const def of Object.values(FLAGS)) {
      expect(def.percent).toBeGreaterThanOrEqual(0);
      expect(def.percent).toBeLessThanOrEqual(100);
    }
  });
});
