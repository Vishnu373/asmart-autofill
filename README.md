# asmart-autofill

A patient fills in a form on a tablet. The details land in the clinic's EMR without anyone retyping them.

Three parts ship together: a Tauri desktop application that holds the data and serves the form, a React frontend for the form and the tray window, and a Chrome extension that fills the EMR. The desktop is the source of truth — everything else is a client.

- [design.md](design.md) — what it does and why it is built this way
- [setup.md](setup.md) — prerequisites for a fresh dev machine
- `implementation.md` — phase plan and progress (untracked, local only)

## Running

First time on this machine, install the toolchains first — see [setup.md](setup.md).

```
git clone https://github.com/Vishnu373/asmart-autofill.git
cd asmart-autofill
bun install
bun run tauri dev
```

`bun install` pulls the Tauri CLI and the TypeScript tooling. Rust dependencies are fetched on the first build, which takes several minutes and leaves a `src-tauri/target/` directory of a few gigabytes.

The window is hidden on launch by design — look for the tray icon. Closing the window hides it rather than quitting; use **Quit** in the tray menu to stop the process.

Check the server is up:

```
curl http://127.0.0.1:8787/api/health
```

```json
{ "ok": true, "version": "0.1.0" }
```

Port 8787 is preferred, falling back through 8796 if taken. The tray window shows the port actually bound. If all ten are unavailable the app refuses to start and says so in a dialog naming the range it tried.

From a tablet on the same WiFi, use the machine's LAN address rather than `127.0.0.1` — the tray window shows the one it selected.

## Building

```
bun run tauri build
```

Produces an unsigned NSIS installer under:

```
src-tauri/target/release/bundle/nsis/
```

Unsigned, so Windows SmartScreen warns on first run. Signing is out of scope for v1.

An installed release build registers itself to start at Windows login. Development builds deliberately do not.

## Tests

```
cargo.exe test --manifest-path src-tauri/Cargo.toml
```

Drop the `.exe` if you are running from a Windows shell rather than WSL.

## Lint and format

```
bun run lint           # clippy + eslint
bun run format         # prettier + cargo fmt, writes changes
bun run format:check   # verifies without writing
```

`bun run lint` treats warnings as errors on the Rust side (`-D warnings`), so it fails on anything clippy flags. Run `lint` and `format:check` before committing.

## Layout

```
src-tauri/        Rust core — HTTP server, pairing token, LAN address, tray
apps/form/        the patient-facing form
apps/tray/        the desktop window
apps/extension/   Chrome MV3 extension that fills the EMR
packages/shared/  types and validation used by all three
e2e/              Playwright end-to-end tests
```

Bun workspace. The `apps/*` and `packages/*` folders are scaffolded but not yet implemented — that is the F phases in `implementation.md`.

## Logs

```
%LOCALAPPDATA%\com.asmart.autofill\logs\
```

A new file each day. Submission fields are never logged.

Raise the level for a session with `RUST_LOG`:

```
RUST_LOG=debug bun run tauri dev
```
