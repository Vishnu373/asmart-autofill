import { fileURLToPath } from "node:url";
import pg from "pg";
import { runner } from "node-pg-migrate";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../migrations", import.meta.url));

/** `DATABASE_URL` with its database name swapped, keeping host and credentials. */
function urlForDatabase(name: string): string {
  const base = process.env["DATABASE_URL"];
  if (!base) {
    throw new Error("DATABASE_URL is not set — start the compose stack first");
  }
  const url = new URL(base);
  url.pathname = `/${name}`;
  return url.toString();
}

async function onAdminConnection(sql: string): Promise<void> {
  const client = new pg.Client({ connectionString: urlForDatabase("postgres") });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

/**
 * Creates an empty database, migrates it, and points `DATABASE_URL` at it.
 * Returns a function that drops it again.
 */
export async function createMigratedDatabase(): Promise<() => Promise<void>> {
  const name = `asmart_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const originalUrl = process.env["DATABASE_URL"];

  await onAdminConnection(`CREATE DATABASE ${name}`);
  const databaseUrl = urlForDatabase(name);

  await runner({
    databaseUrl,
    dir: MIGRATIONS_DIR,
    direction: "up",
    migrationsTable: "pgmigrations",
    log: () => {},
  });

  process.env["DATABASE_URL"] = databaseUrl;

  return async () => {
    process.env["DATABASE_URL"] = originalUrl;
    await onAdminConnection(`DROP DATABASE ${name} WITH (FORCE)`);
  };
}
