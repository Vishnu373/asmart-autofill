# asmart-autofill

A patient fills in a form on a tablet. The details land on the front desk computer, where staff copy them into the clinic's EMR without anyone retyping them.

Two parts ship together: a Tauri desktop application that holds the data and serves the form, and a React frontend for the form and the desktop window. The desktop is the source of truth — the tablet is a client of it.

- [docs/design.md](docs/design.md) — what it does and why it is built this way
- [docs/setup.md](docs/setup.md) — prerequisites for a fresh dev machine
- [docs/development.md](docs/development.md) — everything else: lint, format, logs, layout
- [docs/releasing.md](docs/releasing.md) — signing, the update feed, publishing a release

## Install

Install the toolchains first — see [docs/setup.md](docs/setup.md).

```
git clone https://github.com/Vishnu373/asmart-autofill.git
cd asmart-autofill
bun install
```

Rust dependencies are fetched on the first build, which takes several minutes and leaves a `src-tauri/target/` directory of a few gigabytes.

## Run

```
bun run dev
```

The window opens on launch. Closing it stops the server and drops anything waiting.

Both `dev` and `build` rebuild the two frontends first, so a change to the form or the window is picked up without a separate step.

## Build

```
bun run build
```

Produces an unsigned NSIS installer under `src-tauri/target/release/bundle/nsis/`. A release meant to be installable by an existing copy also needs the updater signing key set — see [docs/releasing.md](docs/releasing.md).

## Test

```
bun run test                                     # frontend
cargo test --manifest-path src-tauri/Cargo.toml  # rust
```

From WSL, the Rust line needs `cargo.exe`.

## Project structure

Bun workspace. The desktop holds the state; the two frontends are clients of it.

```
src-tauri/                Rust core
  src/main.rs             startup, logging
  src/server.rs           axum router and port binding
  src/routes/tablet.rs    serves the form, takes submissions
  src/queue.rs            in-memory queue, two-hour retention, the window's commands
  src/submission.rs       the patient record and its validation
  src/auth.rs             bearer gate for the tablet
  src/net.rs              LAN address detection and pairing URL
  capabilities/           which commands the window may call

apps/form/                the patient-facing form, inlined into the binary
apps/desktop/             the desktop window — QR, waiting list, patient details
packages/shared/          types and validation used by both
docs/                     design, setup, development, releasing
```
