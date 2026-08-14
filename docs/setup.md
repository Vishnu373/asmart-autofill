# Setup

## Prerequisites

- **Node 22 or newer** — `node -v`
- **Docker Desktop**, running — `docker ps` should print a header, not an error

## First-time setup

```bash
npm install           # installs all four workspaces
cp .env.example .env  # then fill in DATABASE_URL
npm run db:up         # starts Postgres in Docker
npm run migrate       # creates the tables
```

`.env.example` ships with a placeholder. Set `DATABASE_URL` in your `.env` to point at
the compose Postgres, using the user, password, database, and port from
`docker-compose.yml`.

`npm run db:up` takes a minute the first time while it pulls the image.

## Everyday commands

| Command | What it does |
|---|---|
| `npm run db:up` | Start Postgres |
| `npm run db:down` | Stop Postgres (the data survives) |
| `npm run migrate` | Apply any new migrations |
| `npm run build` | Compile every package |
| `npm run typecheck` | Type-check without using cached results |
| `npm run lint` | ESLint over the repo |

## Testing

Two suites, deliberately separate.

```bash
npm test              # unit tests — fast, no database needed
npm run test:integration   # needs Postgres running
```

`npm test` is the one to run constantly. The integration suite creates a throwaway
database, migrates it, runs against it, and drops it again — so it needs `npm run db:up`
first, but it never touches your development data.

To run a single file or watch:

```bash
npx vitest packages/shared          # watch mode, one package
npx vitest run -t "postal code"     # tests matching a name
```

## The database

Both `npm run migrate` and the integration tests read `DATABASE_URL` from `.env`, so you
don't need it exported in your shell.

Open a psql shell:

```bash
docker compose exec postgres psql -U asmart -d asmart
```

Useful once you're in: `\dt` lists tables, `\d clinics` describes one, `\q` quits.

To start over from an empty database:

```bash
npm run db:down
docker volume rm asmart-autofill_pgdata
npm run db:up && npm run migrate
```

## Adding a migration

Create the next numbered file in `packages/api/migrations`, e.g. `0004_something.sql`,
with `-- Up Migration` and `-- Down Migration` sections, then `npm run migrate`.
Migrations run in filename order and each one runs only once.
