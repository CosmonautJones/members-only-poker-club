import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const postgresFactory = vi.hoisted(() => vi.fn());
vi.mock('postgres', () => ({ default: postgresFactory }));

import type { TransactionClient, TransactionRunner } from '@/lib/db/transactions';

interface PgliteTx {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}

interface PendingQuery extends Promise<unknown[]> {
  cancel(): void;
  execute(): PendingQuery;
}

interface TransactionSql {
  unsafe(sql: string, params?: unknown[]): PendingQuery;
}

interface PostgresSql {
  begin<T>(work: (sql: TransactionSql) => Promise<T>): Promise<T>;
}

function pendingQuery(run: () => Promise<unknown[]>): PendingQuery {
  const promise = run() as PendingQuery;
  promise.execute = () => promise;
  promise.cancel = () => {};
  return promise;
}

function throwIfAborted(signal?: AbortSignal): void {
  signal?.throwIfAborted();
}

function pgliteRunner(pg: PGlite): TransactionRunner {
  return {
    transaction: (work, options) =>
      pg.transaction(async (tx: PgliteTx) => {
        throwIfAborted(options?.signal);
        const client: TransactionClient = {
          query: async (text, params) => {
            throwIfAborted(options?.signal);
            const result = await tx.query(text, params);
            throwIfAborted(options?.signal);
            return result;
          },
        };
        const result = await work(client);
        throwIfAborted(options?.signal);
        return result;
      }),
  };
}

function pglitePostgresSql(pg: PGlite): PostgresSql {
  return {
    begin: (work) =>
      pg.transaction((tx: PgliteTx) =>
        work({
          unsafe: (text, params) =>
            pendingQuery(async () => {
              const result = await tx.query(text, params);
              return result.rows;
            }),
        }),
      ),
  };
}

async function productionRunner(pg: PGlite): Promise<TransactionRunner> {
  const { createPostgresTransactionRunner } = await import('@/lib/db/postgres-transaction-runner');
  return createPostgresTransactionRunner(pglitePostgresSql(pg));
}

describe.each([
  ['pglite contract adapter', pgliteRunner],
  ['production Postgres.js adapter', productionRunner],
] as const)('%s', (_name, createRunner) => {
  let pg: PGlite;
  let runner: TransactionRunner;

  beforeEach(async () => {
    pg = new PGlite();
    await pg.exec(`
      CREATE TABLE transaction_probe (
        id integer PRIMARY KEY,
        value text NOT NULL
      );
      CREATE TABLE audit_probe (
        id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        event text NOT NULL CHECK (event <> 'reject')
      );
      INSERT INTO transaction_probe (id, value) VALUES (1, 'before');
    `);
    runner = await createRunner(pg);
  });

  afterEach(async () => {
    await pg.close();
  });

  it('rolls the mutation back when the audit write fails and remains reusable', async () => {
    await expect(
      runner.transaction(async (tx) => {
        await tx.query(`UPDATE transaction_probe SET value = 'after' WHERE id = 1`);
        await tx.query(`INSERT INTO audit_probe (event) VALUES ('reject')`);
      }),
    ).rejects.toMatchObject({ code: '23514' });

    const result = await runner.transaction((tx) =>
      tx.query('SELECT value FROM transaction_probe WHERE id = 1'),
    );
    expect(result.rows).toEqual([{ value: 'before' }]);
  });

  it('writes no audit row when the mutation fails', async () => {
    await expect(
      runner.transaction(async (tx) => {
        await tx.query(`INSERT INTO transaction_probe (id, value) VALUES (1, 'duplicate')`);
        await tx.query(`INSERT INTO audit_probe (event) VALUES ('written')`);
      }),
    ).rejects.toMatchObject({ code: '23505' });

    const result = await runner.transaction((tx) =>
      tx.query('SELECT count(*)::integer AS count FROM audit_probe'),
    );
    expect(result.rows).toEqual([{ count: 0 }]);
  });

  it('rolls back and rethrows the original callback error', async () => {
    const failure = new Error('work failed');
    let thrown: unknown;

    try {
      await runner.transaction(async (tx) => {
        await tx.query(`UPDATE transaction_probe SET value = 'after' WHERE id = 1`);
        throw failure;
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBe(failure);
    const result = await runner.transaction((tx) =>
      tx.query('SELECT value FROM transaction_probe WHERE id = 1'),
    );
    expect(result.rows).toEqual([{ value: 'before' }]);
  });

  it('treats abort as a rollback signal', async () => {
    const controller = new AbortController();

    await expect(
      runner.transaction(
        async (tx) => {
          await tx.query(`UPDATE transaction_probe SET value = 'after' WHERE id = 1`);
          controller.abort();
          await tx.query('SELECT 1');
        },
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });

    const result = await pg.query('SELECT value FROM transaction_probe WHERE id = 1');
    expect(result.rows).toEqual([{ value: 'before' }]);
  });
});

describe('production Postgres.js transaction runner', () => {
  const ORIGINAL_DATABASE_URL = process.env.SUPABASE_DATABASE_URL;

  beforeEach(() => {
    vi.resetModules();
    postgresFactory.mockReset();
    process.env.SUPABASE_DATABASE_URL =
      'postgres://postgres.project:secret@aws-0-us-east-1.pooler.supabase.com:6543/postgres';
  });

  afterEach(() => {
    if (ORIGINAL_DATABASE_URL === undefined) {
      delete process.env.SUPABASE_DATABASE_URL;
    } else {
      process.env.SUPABASE_DATABASE_URL = ORIGINAL_DATABASE_URL;
    }
  });

  it('creates one module-scoped Supavisor-compatible client and reuses it', async () => {
    const sql: PostgresSql = {
      begin: async (work) =>
        work({
          unsafe: () => pendingQuery(async () => [{ ok: true }]),
        }),
    };
    postgresFactory.mockReturnValue(sql);

    const { postgresTransactionRunner } = await import('@/lib/db/postgres-transaction-runner');
    await postgresTransactionRunner.transaction((tx) => tx.query('SELECT 1'));
    await postgresTransactionRunner.transaction((tx) => tx.query('SELECT 1'));

    expect(postgresFactory).toHaveBeenCalledTimes(1);
    expect(postgresFactory).toHaveBeenCalledWith(process.env.SUPABASE_DATABASE_URL, {
      max: 1,
      prepare: false,
      connect_timeout: 10,
      idle_timeout: 20,
      max_lifetime: 1800,
    });
  });

  it('cancels the active query, rolls back, and can run another transaction', async () => {
    let cancelCalls = 0;
    let transactionCalls = 0;
    const sql: PostgresSql = {
      begin: async (work) => {
        transactionCalls += 1;
        return work({
          unsafe: () => {
            if (transactionCalls > 1) {
              return pendingQuery(async () => [{ ok: true }]);
            }
            let rejectQuery: (error: unknown) => void = () => {};
            const promise = new Promise<unknown[]>((_resolve, reject) => {
              rejectQuery = reject;
            }) as PendingQuery;
            promise.execute = () => promise;
            promise.cancel = () => {
              cancelCalls += 1;
              rejectQuery(new Error('query cancelled'));
            };
            return promise;
          },
        });
      },
    };

    const { createPostgresTransactionRunner } =
      await import('@/lib/db/postgres-transaction-runner');
    const runner = createPostgresTransactionRunner(sql);
    const controller = new AbortController();
    const transaction = runner.transaction((tx) => tx.query('SELECT pg_sleep(10)'), {
      signal: controller.signal,
    });
    controller.abort();

    await expect(transaction).rejects.toMatchObject({ name: 'AbortError' });
    expect(cancelCalls).toBe(1);
    await expect(runner.transaction((tx) => tx.query('SELECT 1'))).resolves.toEqual({
      rows: [{ ok: true }],
    });
  });

  it('fails closed when the database URL is absent or is not transaction-mode Supavisor', async () => {
    delete process.env.SUPABASE_DATABASE_URL;
    let module = await import('@/lib/db/postgres-transaction-runner');
    await expect(
      module.postgresTransactionRunner.transaction(async () => undefined),
    ).rejects.toThrow('SUPABASE_DATABASE_URL is required');
    expect(postgresFactory).not.toHaveBeenCalled();

    vi.resetModules();
    process.env.SUPABASE_DATABASE_URL =
      'postgres://postgres.project:secret@db.project.supabase.co:5432/postgres';
    module = await import('@/lib/db/postgres-transaction-runner');
    await expect(
      module.postgresTransactionRunner.transaction(async () => undefined),
    ).rejects.toThrow('SUPABASE_DATABASE_URL must use Supavisor transaction mode');
    expect(postgresFactory).not.toHaveBeenCalled();
  });

  it('keeps the credential boundary in a server-only module', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'lib/db/postgres-transaction-runner.ts'),
      'utf8',
    );

    expect(source.startsWith("import 'server-only';")).toBe(true);
    expect(source).toContain('process.env.SUPABASE_DATABASE_URL');
    expect(source).not.toContain('NEXT_PUBLIC_SUPABASE_DATABASE_URL');
  });
});
