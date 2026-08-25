# asmart-autofill

A patient fills in a form on a tablet. The details land in the clinic's EMR without anyone retyping them.

Three parts ship together: a Tauri desktop application that holds the data and serves the form, a React frontend for the form and the tray window, and a Chrome extension that fills the EMR. The desktop is the source of truth — everything else is a client.

- [docs/design.md](docs/design.md) — what it does and why it is built this way
- [docs/setup.md](docs/setup.md) — prerequisites for a fresh dev machine
- [docs/development.md](docs/development.md) — everything else: lint, format, logs, layout

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

The window is hidden on launch by design — look for the tray icon. Closing the window hides it rather than quitting; use **Quit** in the tray menu to stop the process.

## Build

```
bun run build
```

Produces an unsigned NSIS installer under `src-tauri/target/release/bundle/nsis/`.

## Test

```
bun run test                                     # frontend
cargo test --manifest-path src-tauri/Cargo.toml  # rust
```

From WSL, the Rust line needs `cargo.exe`.

## Project structure

Bun workspace. The desktop holds the state; the three frontends are clients of it.

```
src-tauri/                Rust core
  src/main.rs             startup, tray, logging
  src/server.rs           axum router and port binding
  src/routes/tablet.rs    serves the form, takes submissions
  src/routes/extension.rs hands queued submissions to the extension
  src/queue.rs            in-memory queue, two-hour retention
  src/submission.rs       the patient record and its validation
  src/auth.rs             bearer gate for the tablet
  src/net.rs              LAN address detection and pairing URL
  src/mapping.rs          field names to EMR selectors
  capabilities/           which commands the tray window may call
  mapping.json            the EMR field map, loaded at runtime

apps/form/                the patient-facing form, inlined into the binary
apps/tray/                the desktop window — QR, port, waiting count
apps/extension/           Chrome MV3 extension
  src/background/         polls for pending submissions
  src/content/            fills the EMR page
  src/popup/              extension popup
packages/shared/          types and validation used by all three
e2e/                      Playwright end-to-end tests
docs/                     design, setup, development, phase plan
```
