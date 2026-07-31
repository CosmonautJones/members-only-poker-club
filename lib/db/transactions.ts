/**
 * Transaction-scoped query surface shared by production Postgres.js and
 * pglite tests. Business actions use this contract instead of either driver.
 */
export interface TransactionClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}

/**
 * Owns callback transaction boundaries. Rejecting the callback or aborting
 * its signal must roll the transaction back and release the connection.
 */
export interface TransactionRunner {
  transaction<T>(
    work: (tx: TransactionClient) => Promise<T>,
    options?: { signal?: AbortSignal },
  ): Promise<T>;
}
