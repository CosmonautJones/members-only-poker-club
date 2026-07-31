import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const __filename =
  typeof __dirname === 'undefined'
    ? fileURLToPath(import.meta.url)
    : `${__dirname}/__placeholder__`;
const TEST_DIR = typeof __dirname === 'undefined' ? dirname(__filename) : __dirname;
const REPO_ROOT = resolve(TEST_DIR, '..', '..');

const ACTION_PATHS = [
  'app/(admin)/admin/flags/_actions/updateFlag.ts',
  'app/(admin)/admin/members/[id]/_actions/changeRole.ts',
  'app/(admin)/admin/members/[id]/_actions/initiateMemberDeletion.ts',
  'app/(admin)/admin/members/[id]/_actions/openRefundFlow.ts',
  'app/(admin)/admin/members/[id]/_actions/requestReverification.ts',
  'app/(admin)/admin/payments/refunds/new/_actions/initiateRefund.ts',
] as const;

describe('LUNA-008 admin mutation production transaction runner', () => {
  for (const actionPath of ACTION_PATHS) {
    it(`${actionPath} defaults to the shared Postgres transaction runner`, () => {
      const source = readFileSync(resolve(REPO_ROOT, actionPath), 'utf8');

      expect(source).toMatch(
        /import\s+\{\s*postgresTransactionRunner\s*\}\s+from\s+['"]@\/lib\/db\/postgres-transaction-runner['"]/,
      );
      expect(source).toMatch(/(?:db|runner)\s*\?\?\s*postgresTransactionRunner/);
      expect(source).not.toContain('function defaultDb(');
      expect(source).not.toContain("from '@/lib/supabase/admin'");
    });
  }
});
