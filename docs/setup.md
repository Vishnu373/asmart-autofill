# Dev Machine Setup

One-time setup. For day-to-day commands see the [README](../README.md).

Windows only. macOS is deferred — see Future Considerations in `design.md`.

## Prerequisites

### 1. Visual Studio Build Tools

Rust on Windows links with the Microsoft linker, so this has to come first — installing Rust before it produces a `link.exe not found` error on the first build.

Documentation: https://visualstudio.microsoft.com/downloads

- select the **Desktop development with C++** option.
- That brings in the MSVC compiler, the linker, and the Windows SDK.

### 2. Rust

Documentation: https://rustup.rs

The version is pinned in `rust-toolchain.toml`:

```toml
[toolchain]
channel = "1.96.0"
targets = ["x86_64-pc-windows-msvc"]
```

Nothing needs installing by hand — rustup reads that file on the first `cargo` command in this repo and fetches the pinned toolchain and target automatically. Confirm with:

```
rustup show
```

The active toolchain should read `1.96.0-x86_64-pc-windows-msvc`, overridden by `rust-toolchain.toml`.

### 3. Bun

Documentation: https://bun.sh/

### 4. Git

Documentation: https://git-scm.com/about

## Windows Firewall

The server binds `0.0.0.0`, so it is reachable from the LAN. On the first run Windows shows a firewall prompt.

**Allow it on Private networks.** Deny it, or allow only Public, and the app still runs and answers on `127.0.0.1`, but no tablet can reach it — which looks identical to a broken QR code.

To check or change it later: Windows Security → Firewall & network protection → Allow an app through firewall.
