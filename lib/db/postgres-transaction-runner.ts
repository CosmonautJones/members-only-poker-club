import 'server-only';

import postgres from 'postgres';

import type { TransactionClient, TransactionRunner } from './transactions';

interface CancellableQuery extends PromiseLike<unknown[]> {
  cancel(): void;
  execute(): CancellableQuery;
}

interface PostgresTransaction {
  unsafe(sql: string, params?: unknown[]): CancellableQuery;
}

interface PostgresClient {
  begin<T>(work: (sql: PostgresTransaction) => Promise<T>): Promise<T>;
}

const POSTGRES_OPTIONS = {
  max: 1,
  prepare: false,
  connect_timeout: 10,
  idle_timeout: 20,
  max_lifetime: 60 * 30,
} as const;

function throwIfAborted(signal?: AbortSignal): void {
  signal?.throwIfAborted();
}

function transactionClient(sql: PostgresTransaction, signal?: AbortSignal): TransactionClient {
  return {
    query: async (text, params = []) => {
      throwIfAborted(signal);

      const query = sql.unsafe(text, params).execute();
      const cancel = () => query.cancel();
      signal?.addEventListener('abort', cancel, { once: true });

      try {
        const rows = await query;
        throwIfAborted(signal);
        return { rows: Array.from(rows) };
      } catch (error) {
        throwIfAborted(signal);
        throw error;
      } finally {
        signal?.removeEventListener('abort', cancel);
      }
    },
  };
}

export function createPostgresTransactionRunner(sql: PostgresClient): TransactionRunner {
  return {
    transaction: async (work, options) => {
      const signal = options?.signal;
      throwIfAborted(signal);

      return sql.begin(async (transactionSql) => {
        const result = await work(transactionClient(transactionSql, signal));
        throwIfAborted(signal);
        return result;
      });
    },
  };
}

let sql: postgres.Sql | undefined;
let runner: TransactionRunner | undefined;

function databaseUrl(): string {
  const value = process.env.SUPABASE_DATABASE_URL;
  if (!value) {
    throw new Error('SUPABASE_DATABASE_URL is required');
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('SUPABASE_DATABASE_URL must be a valid Postgres URL');
  }

  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.port !== '6543') {
    throw new Error('SUPABASE_DATABASE_URL must use Supavisor transaction mode');
  }

  return value;
}

function productionRunner(): TransactionRunner {
  if (!runner) {
    sql ??= postgres(databaseUrl(), POSTGRES_OPTIONS);
    runner = createPostgresTransactionRunner(sql);
  }
  return runner;
}

export const postgresTransactionRunner: TransactionRunner = {
  transaction: async (work, options) => productionRunner().transaction(work, options),
};
