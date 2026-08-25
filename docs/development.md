# Development

Install, run, build and test are in the [README](../README.md). This is the rest.

## Lint and format

```
bun run lint           # clippy + eslint + tsc
bun run format         # prettier + cargo fmt, writes changes
bun run format:check   # verifies without writing
bun run typecheck      # tsc alone
```

`lint` treats warnings as errors on the Rust side (`-D warnings`), so it fails on anything clippy flags. Run `lint` and `format:check` before committing.

## Building one part

`bun run build` bundles everything. To rebuild a single frontend without touching Rust:

```
bun run build:ui         # form + tray
bun run build:extension  # Chrome extension
```

The form is inlined into the Rust binary at compile time, so a change to `apps/form` needs `build:ui` before the next `cargo` build sees it.

## Server

```
curl http://127.0.0.1:8787/api/health
```

```json
{ "ok": true }
```

It answers before any token is checked, so it says only that something is listening.

Port 8787 is preferred, falling back through 8796 if taken. The tray window shows the port actually bound. If all ten are unavailable the app refuses to start and says so in a dialog naming the range it tried.

From a tablet on the same WiFi, use the machine's LAN address rather than `127.0.0.1` — the tray window shows the one it selected.

## Logs

```
%LOCALAPPDATA%\com.asmart.autofill\logs\
```

A new file each day. Patient field values are never logged — see Observability in [design.md](design.md) for the full list of what is written.

Raise the level for a session:

```
RUST_LOG=debug bun run dev
```

## Installer

The bundle is unsigned, so Windows SmartScreen warns on first run. Signing is out of scope for v1.

An installed release build registers itself to start at Windows login. Development builds deliberately do not.

## Layout

See Project structure in the [README](../README.md). `implementation.md` holds the phase plan and progress.
