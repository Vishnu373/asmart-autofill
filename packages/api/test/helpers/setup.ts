import { afterAll, beforeAll } from "vitest";
import { closePool } from "../../src/db.js";
import { createMigratedDatabase } from "./database.js";

let dropDatabase: (() => Promise<void>) | undefined;

beforeAll(async () => {
  dropDatabase = await createMigratedDatabase();
}, 60_000);

afterAll(async () => {
  await closePool();
  await dropDatabase?.();
});
