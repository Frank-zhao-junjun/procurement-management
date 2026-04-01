import { Client as PgClient, QueryResult } from 'pg';
import { getDatabaseUrl } from '@/storage/database';

export type PgTransactionClient = Pick<PgClient, 'query'>;

export async function withPgTransaction<T>(
  work: (tx: PgTransactionClient) => Promise<T>,
): Promise<T | null> {
  const databaseUrl = getDatabaseUrl();
  if (!databaseUrl) {
    return null;
  }

  const pg = new PgClient({ connectionString: databaseUrl });
  await pg.connect();

  try {
    await pg.query('BEGIN');
    const result = await work(pg);
    await pg.query('COMMIT');
    return result;
  } catch (error) {
    await pg.query('ROLLBACK');
    throw error;
  } finally {
    await pg.end();
  }
}

export async function queryOne<T extends Record<string, unknown>>(
  tx: PgTransactionClient,
  sql: string,
  params: unknown[] = [],
  notFoundMessage?: string,
): Promise<T> {
  const result: QueryResult<T> = await tx.query(sql, params);
  if (!result.rowCount || !result.rows[0]) {
    throw new Error(notFoundMessage || 'Expected one row but none returned');
  }
  return result.rows[0];
}

export async function queryMany<T extends Record<string, unknown>>(
  tx: PgTransactionClient,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result: QueryResult<T> = await tx.query(sql, params);
  return result.rows;
}

export async function exec(tx: PgTransactionClient, sql: string, params: unknown[] = []): Promise<void> {
  await tx.query(sql, params);
}
