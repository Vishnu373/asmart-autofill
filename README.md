# asmart-autofill

Patient registration for clinics, without the retyping.

A patient fills in a short form on a tablet at the front desk. The details land in a
Chrome extension on the staff member's computer. Staff open a new record in OSCAR, click
once to fill it, check it over, and save. The details are erased from the server the
moment they're saved — and automatically after two hours if nobody enters them.

Four parts, all in this repo: a tablet form, a clinic website and dashboard, an API, and
the Chrome extension.

- **[design.md](docs/design.md)** — what it does and why it's built this way
- **[setup.md](docs/setup.md)** — getting it running on your machine

## Tech Stack

| Part | Choice |
|---|---|
| Frontend | React + TypeScript |
| Backend | Node + TypeScript |
| Backend API framework | Fastify |
| Database | Postgres |
| Auth | Supabase Auth, self-hosted |
| Chrome extension | TypeScript, Manifest V3 |
| Hosting | OVH VPS (Canada — East — Beauharnois) |
| Containers | Docker Compose |
| web server | Caddy |


## Project structure

```
docs/          Contains architecture and setup commands
packages/
  shared/      The 13 patient fields: types and validation, defined once
  api/         Node + Fastify API, Postgres, migrations
  web/         Clinic website, dashboard, and the tablet form (React)
  extension/   Chrome extension: waiting list, filling OSCAR, save detection
docker-compose.yml   Postgres for local development
```

What each one owns:

| Folder | Owns |
|---|---|
| `packages/shared` | The 13 fields and their validation rules. Every other package imports these — nothing redefines a field. |
| `packages/api` | Everything server-side: auth, submissions, the live push, the mapping file, the cleanup job. `migrations/` owns the database schema. |
| `packages/web` | Both browser surfaces: the clinic's dashboard and the patient's tablet form. |
| `packages/extension` | Everything on the staff desktop: the waiting list, filling the OSCAR form, and detecting the save. |

## Commands

```bash
npm install       # first time
npm run db:up     # start Postgres
npm run build     # compile every package
```
