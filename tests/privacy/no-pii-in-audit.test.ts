import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(resolve(__dirname, '../../app/api/privacy/delete/route.ts'), 'utf8');
const PII_KEYS = ['email', 'full_name', 'phone'];

function auditSnapshots(): string[] {
  return [...SOURCE.matchAll(/JSON\.stringify\(\{([^}]+)\}\)/g)].map((match) => match[1]!);
}

describe('no-pii-in-audit (AC13 source-grep guard)', () => {
  it('keeps the audit insert inside the SQL transaction path', () => {
    expect(SOURCE).toContain('INSERT INTO audit_log');
    expect(SOURCE).toContain('db.transaction(async (tx)');
    expect(SOURCE).not.toMatch(/from\(['"]audit_log['"]\)/);
  });

  it('contains exactly the before and after deleted_at snapshots', () => {
    expect(auditSnapshots()).toEqual([' deleted_at: null ', ' deleted_at: deletedAt ']);
  });

  it('audit snapshots do not contain PII keys', () => {
    const combined = auditSnapshots().join('');
    for (const key of PII_KEYS) expect(combined).not.toContain(key);
  });
});
