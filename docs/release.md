# Releasing

The application updates itself from this repo's GitHub Releases. It fetches
`latest.json`, compares the version there against its own, and offers the update
in a strip at the bottom of the window. Nothing installs unprompted.

## The repository must be public

The updater sends no credentials. A private repo answers 404 to the release URLs,
and every install would silently stop finding updates. A token baked into the
installer is not an answer — it can be read straight back out of it.

## One-time setup

Generate the signing keypair. The updater refuses an unsigned bundle, so this
cannot be skipped.

```
bun run tauri signer generate -w %USERPROFILE%\.tauri\asmart-autofill.key
```

Then edit `src-tauri/tauri.conf.json` in two places:

- paste the printed **public** key into `pubkey`, which currently holds an empty
  string
- set `bundle.createUpdaterArtifacts` to `true`

`createUpdaterArtifacts` is `false` in the repo so that `bun run build` works
before any of this is set up — you get an installer whose updater finds nothing,
which is the right behaviour for a test build. It, not `pubkey`, is the switch
the CLI reads: with it on, every build demands the private key in the environment
and fails at the signing step even though the installer has already been written:

```
A public key has been found, but no private key.
Make sure to set `TAURI_SIGNING_PRIVATE_KEY` environment variable.
```

That is the intended trade: once the feed is real, an unsigned release cannot be
built by accident.

Keep the private key and its password out of the repo and back them up. Losing
them means no existing install can ever update again — every clinic would need a
fresh installer carried to it by hand.

## Each release

1. Bump the version in three places, to the same value:
   - `package.json`
   - `src-tauri/Cargo.toml`
   - `src-tauri/tauri.conf.json` — this is the one the updater compares against

2. Set the signing key for the shell you build in:

   ```
   set TAURI_SIGNING_PRIVATE_KEY=<contents of asmart-autofill.key>
   set TAURI_SIGNING_PRIVATE_KEY_PASSWORD=<the password>
   ```

3. Build:

   ```
   bun run lint
   bun run test
   cargo test --manifest-path src-tauri/Cargo.toml
   bun run build
   ```

   `src-tauri/target/release/bundle/nsis/` gets the installer and, because
   `createUpdaterArtifacts` is on, a `.sig` file beside it.

4. Create a GitHub release tagged `v0.2.0` and upload three files: the
   `.exe`, its `.sig`, and a `latest.json` you write:

   ```json
   {
     "version": "0.2.0",
     "notes": "What changed.",
     "pub_date": "2026-08-27T00:00:00Z",
     "platforms": {
       "windows-x86_64": {
         "signature": "<the entire contents of the .sig file>",
         "url": "https://github.com/Vishnu373/asmart-autofill/releases/download/v0.2.0/asmart-autofill_0.2.0_x64-setup.exe"
       }
     }
   }
   ```

   `signature` is the file's contents pasted inline, not a link to it.

5. Check `https://github.com/Vishnu373/asmart-autofill/releases/latest/download/latest.json`
   resolves in a private browser window. That URL always points at the newest
   release, which is why the config never needs editing again.

## Verifying an update works

It takes two releases: install the older one, publish the newer, then reopen the
older install. The strip should appear within a second of launch. Until there are
two, the check simply finds nothing and stays silent.

## Signing the installer itself

Separate from the above and still not done. The bundle is unsigned, so Windows
SmartScreen warns on first run. That needs an EV certificate — see Pricing in
[design.md](design.md).
