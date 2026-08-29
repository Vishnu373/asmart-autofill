# Releasing

The application updates itself from this repo's GitHub Releases. On launch it
fetches `latest.json`, compares the version there against its own, and offers the
update in a strip at the bottom of the window. Nothing installs unprompted.

Every release is signed. The updater refuses an unsigned bundle, so the signing
key is not optional — an unsigned release is not a degraded release, it is one no
existing install can accept.

## One-time setup

This is already done. It is recorded here because it has to be redone from
scratch if the key is ever lost, and because the two config values below are easy
to break by accident.

The keypair was generated with:

```
bun run tauri signer generate -w %USERPROFILE%\.tauri\asmart-autofill.key
```

`%USERPROFILE%` only expands in cmd and PowerShell. Run that line in bash or WSL
and Tauri creates a literal directory named `%USERPROFILE%` wherever you happen
to be standing, which is how the key ended up inside the repo. It belongs in
`C:\Users\<you>\.tauri\`.

Two values in `src-tauri/tauri.conf.json` are set to match that key:

- `plugins.updater.pubkey` — the contents of `asmart-autofill.key.pub`. Installed
  copies check signatures against this. Change it and every existing install
  stops accepting updates.
- `bundle.createUpdaterArtifacts` — `true`. This, not `pubkey`, is the switch the
  CLI actually reads. With it on, every build demands the private key in the
  environment and fails at the signing step, after the installer has already been
  written:

  ```
  A public key has been found, but no private key.
  Make sure to set `TAURI_SIGNING_PRIVATE_KEY` environment variable.
  ```

  That message is the intended behaviour, not a misconfiguration to fix. Once the
  update feed is real, an unsigned release cannot be built by accident.

Keep the private key and its password out of the repo, and back both up somewhere
you will still have in a year. Losing them means no existing install can ever
update again — every clinic needs a fresh installer carried to it by hand.

## Each release

The example below releases `0.1.0`. Substitute your version everywhere it
appears: the tag, the three files, and the JSON must all agree on it, and nothing
checks that for you.

### 1. Bump the version

Three files, all to the same value:

- `package.json`
- `src-tauri/Cargo.toml`
- `src-tauri/tauri.conf.json` — this is the one the updater compares against

### 2. Put the signing key in the shell

The Tauri CLI reads these from the environment of the shell you build in. Not
from a `.env` file — there is no `.env` in this flow, and adding one would put the
key on disk inside the repo, which is the thing being avoided. They live only in
the terminal session you are about to build in, and vanish when you close it.

PowerShell:

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content -Raw C:\Users\<you>\.tauri\asmart-autofill.key
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "<the password>"
```

cmd:

```
set TAURI_SIGNING_PRIVATE_KEY=<contents of asmart-autofill.key>
set TAURI_SIGNING_PRIVATE_KEY_PASSWORD=<the password>
```

The value is the key file's contents, not its path.

### 3. Build

```
bun run lint
bun run test
cargo test --manifest-path src-tauri/Cargo.toml
bun run build
```

`src-tauri/target/release/bundle/nsis/` gets `asmart-autofill_0.1.0_x64-setup.exe`
and, because `createUpdaterArtifacts` is on, an `.exe.sig` beside it.

### 4. Write latest.json

Save it into that same `nsis/` directory, so the three files you upload sit
together:

```json
{
  "version": "0.1.0",
  "notes": "What changed.",
  "pub_date": "2026-08-28T00:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "<the entire contents of the .exe.sig file>",
      "url": "https://github.com/Vishnu373/asmart-autofill/releases/download/v0.1.0/asmart-autofill_0.1.0_x64-setup.exe"
    }
  }
}
```

Two fields bite:

- `signature` is the `.sig` file's contents pasted inline, one long line, not a
  link to the file.
- `url` must match the uploaded exe's filename character for character. A
  mismatch fails late and quietly — the app finds the update and offers it, then
  the download 404s.

`notes` is what the user reads in the update strip, so write it for them.

### 5. Commit, then publish

Commit and push first. The tag is cut from the branch tip, so tagging with
uncommitted changes leaves a tag pointing at code that is not what you built.

Releases are a GitHub feature, not a git one — `git` alone cannot create them.
Two ways:

**Web UI**, nothing to install:

1. Open https://github.com/Vishnu373/asmart-autofill/releases/new
2. **Choose a tag** → type `v0.1.0` → "Create new tag: v0.1.0 on publish".
   Target `main`.
3. Title `v0.1.0`, and release notes.
4. Drag in all three files from `src-tauri\target\release\bundle\nsis\`: the
   `.exe`, its `.exe.sig`, and `latest.json`.
5. Publish release.

**GitHub CLI**, if `gh` is installed on Windows and authenticated. A `gh` inside
WSL does not put one on the PowerShell path — that is a separate install
(`winget install --id GitHub.cli`, then `gh auth login`, then reopen the shell).
From the repo root:

```powershell
gh release create v0.1.0 `
  --title "v0.1.0" `
  --notes "What changed." `
  src-tauri/target/release/bundle/nsis/asmart-autofill_0.1.0_x64-setup.exe `
  src-tauri/target/release/bundle/nsis/asmart-autofill_0.1.0_x64-setup.exe.sig `
  src-tauri/target/release/bundle/nsis/latest.json
```
