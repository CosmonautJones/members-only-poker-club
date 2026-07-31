import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..', '..');

const ALREADY_TRANSACTIONAL_ACTIONS = [
  'app/(admin)/admin/privacy/_actions/approveDeletion.ts',
  'app/(admin)/admin/privacy/_actions/approveExport.ts',
  'app/(admin)/admin/privacy/_actions/rejectRequest.ts',
  'app/(admin)/admin/verifications/_actions/approveVerification.ts',
  'app/(admin)/admin/verifications/_actions/rejectVerification.ts',
  'app/(admin)/admin/verifications/_actions/requestVerificationInfo.ts',
] as const;

describe('LUNA-008 lane B production transaction runner', () => {
  for (const path of ALREADY_TRANSACTIONAL_ACTIONS) {
    it(`${path} defaults to postgresTransactionRunner without a fake defaultDb`, () => {
      const source = readFileSync(resolve(ROOT, path), 'utf8');

      expect(source).toContain(
        "import { postgresTransactionRunner } from '@/lib/db/postgres-transaction-runner';",
      );
      expect(source).toMatch(/const runner = db \?\? postgresTransactionRunner;/);
      expect(source).not.toMatch(/\bfunction defaultDb\(/);
    });
  }

  it.each([
    'app/(admin)/admin/tournaments/_actions/cancelTournament.ts',
    'app/(admin)/admin/tournaments/_actions/setTemplateActive.ts',
    'app/api/privacy/delete/route.ts',
    'app/api/cron/tournament-materialize/route.ts',
  ])('%s uses postgresTransactionRunner and no PostgREST mutation client', (path) => {
    const source = readFileSync(resolve(ROOT, path), 'utf8');

    expect(source).toContain('postgresTransactionRunner');
    expect(source).not.toMatch(/createAdminClient|\.from\(['"]/);
  });
});
