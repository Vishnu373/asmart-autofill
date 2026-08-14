import { existsSync } from "node:fs";
import { defineConfig } from "vitest/config";

// The tests read DATABASE_URL from the environment; .env is the usual source.
if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

/** Needs the compose Postgres running; kept out of the default `npm test`. */
export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.integration.test.ts"],
    setupFiles: ["packages/api/test/helpers/setup.ts"],
    fileParallelism: false,
  },
});
