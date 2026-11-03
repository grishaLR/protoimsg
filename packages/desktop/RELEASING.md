# Releasing the desktop app

The desktop app is a thin Tauri shell around the hosted site: production builds
load `https://protoimsg.app`, staging builds load `https://staging.protoimsg.app`
(`src-tauri/tauri.staging.conf.json`). Sign-in, the API and captcha work exactly
as on the web, and **every web deploy reaches desktop users immediately** — a new
desktop release is only needed when the native shell changes (`src-tauri/`).

Because the site and the shell update independently, both directions must keep
working:

- **Commands** in `src-tauri/src/lib.rs` stay backward compatible: add optional
  arguments, never rename or remove commands the deployed site still calls.
- **Capabilities ship with the shell.** A new site build calling an API whose
  permission an older shell lacks gets a rejection — so every Tauri call from
  the web is wrapped in try/catch and degrades quietly (see `tauri-windows.ts`,
  `tauri-tray.ts`).

## Security model

The hosted site gets the permissions in `src-tauri/capabilities/default.json`;
keep that list to what the web code actually uses. Other sites get nothing:

- Camera and microphone are granted only when the page _committed_ in that
  window is our own site (`on_permission_request` in `lib.rs`); every other page
  is denied. It checks the committed page, not `Webview::url()`, which WebKit
  switches to the destination as soon as a navigation starts.
- A navigation guard keeps windows on our site (plus the Turnstile captcha
  frame). The `main` and `games` windows may also visit https pages, for the PDS
  sign-in redirect; if `main` is hidden while off-site, tray "Show" brings it
  home.
- Links that open a new window (`target=_blank`, `window.open`) do nothing on
  desktop today. If that's ever changed, route them to the system browser —
  never allow an in-app popup (it would bypass both guards).
- Any path on the app origin counts as the app: never serve user-controlled
  content (uploads, proxied pages) from `protoimsg.app` itself.

## Cutting a release

1. Bump `version` in `src-tauri/tauri.conf.json`.
2. GitHub → Actions → **Desktop Release** → Run workflow → pick `staging` or
   `production`.
3. It builds macOS (universal), Windows and Linux and attaches them to a
   **draft** release (`desktop-v<version>` / `desktop-staging-v<version>`).
4. Check the draft, then publish it. Share the release link with testers.

Local builds: `pnpm --filter @protoimsg/desktop build` (production) or
`build:staging`. Unsigned unless the `APPLE_*` variables below are set.

## One-time setup

### macOS — direct download (Developer ID)

1. Apple Developer → Certificates → create a **Developer ID Application**
   certificate; export it from Keychain as a `.p12` with a password.
2. Create an app-specific password at appleid.apple.com (for notarization).
3. Add repository secrets (Settings → Secrets and variables → Actions):
   - `APPLE_CERTIFICATE` — the `.p12`, base64 (`base64 -i cert.p12 | pbcopy`)
   - `APPLE_CERTIFICATE_PASSWORD` — the `.p12` password
   - `APPLE_SIGNING_IDENTITY` — e.g. `Developer ID Application: Your Name (TEAMID)`
   - `APPLE_ID` — your Apple ID email
   - `APPLE_PASSWORD` — the app-specific password
   - `APPLE_TEAM_ID` — your 10-character Team ID

Without these the macOS build is unsigned: macOS will refuse to open it
normally (right-click → Open works for internal testing only).

### Windows — code signing (before public release)

Unsigned installers work but show a SmartScreen warning ("More info → Run
anyway"). For public release, set up Azure Trusted Signing (identity
validation takes a few days), then add a `bundle.windows.signCommand` to
`tauri.conf.json`.

### Linux

Nothing to set up: AppImage, `.deb` and `.rpm` are produced unsigned.

### Mac App Store / TestFlight (optional, later)

`pnpm --filter @protoimsg/desktop build:appstore` uses
`tauri.appstore.conf.json`: sandboxed, signed with **Apple Distribution**, with
`embedded.provisionprofile` (download from the developer portal into
`src-tauri/`; it's gitignored). Replace `TEAMID` in
`entitlements.appstore.plist` first. Tauri produces only the `.app`; wrap it in
a signed installer package and upload that with Transporter:

```bash
productbuild --sign "3rd Party Mac Developer Installer: Your Name (TEAMID)" \
  --component "src-tauri/target/release/bundle/macos/proto instant messenger.app" \
  /Applications protoimsg.pkg
```

App Review usually rejects the `temporary-exception` entitlement for screen
sharing (`com.apple.replayd`); expect to drop it or justify it.

### Auto-updates (not wired yet)

Needs a signing key pair (`pnpm tauri signer generate`): the public key goes in
`tauri.conf.json` (`plugins.updater.pubkey`), the private key and password into
repo secrets (`TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`).
Then add `tauri-plugin-updater` and point it at the GitHub release's
`latest.json`. Only the shell ever needs updating — the site updates itself.
