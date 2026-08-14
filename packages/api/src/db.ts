import pg from "pg";
import type { QueryResultRow } from "pg";

let pool: pg.Pool | undefined;

/** Created on first use so tests can point `DATABASE_URL` at their own database. */
export function getPool(): pg.Pool {
  if (!pool) {
    const connectionString = process.env["DATABASE_URL"];
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set");
    }
    // Fail a request rather than hang it when Postgres is unreachable.
    pool = new pg.Pool({ connectionString, connectionTimeoutMillis: 5_000 });
  }
  return pool;
}

/** Runs a parameterised query and returns its rows as `T`. */
export async function query<T extends QueryResultRow>(
  text: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  const result = await getPool().query<T>(text, params as unknown[]);
  return result.rows;
}

export async function closePool(): Promise<void> {
  await pool?.end();
  pool = undefined;
}
