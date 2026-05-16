#!/usr/bin/env bash
# Build, sign, and package the desktop app for Mac App Store / TestFlight.
#
# Prerequisites:
#   - Mac App Distribution certificate installed in Keychain
#   - Mac Installer Distribution certificate installed in Keychain
#   - embedded.provisionprofile placed at packages/desktop/src-tauri/embedded.provisionprofile
#   - VITE_API_URL set to production API (or pass as env var)
#
# Usage:
#   VITE_API_URL=https://protoimsg-staging.fly.dev ./scripts/build-desktop-mas.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
BUNDLE_DIR="$REPO_ROOT/packages/desktop/src-tauri/target/release/bundle/macos"
APP_NAME="proto instant messenger"
APP_PATH="$BUNDLE_DIR/$APP_NAME.app"
PKG_PATH="$BUNDLE_DIR/$APP_NAME.pkg"

echo "→ Building web frontend..."
cd "$REPO_ROOT"
pnpm --filter @protoimsg/web build

echo "→ Building Tauri app..."
pnpm --filter @protoimsg/desktop tauri build

echo "→ Signing app bundle..."
codesign \
  --force \
  --deep \
  --sign "Apple Distribution" \
  --entitlements "$REPO_ROOT/packages/desktop/src-tauri/entitlements.mac.plist" \
  "$APP_PATH"

echo "→ Packaging as .pkg for App Store..."
productbuild \
  --component "$APP_PATH" /Applications \
  --sign "3rd Party Mac Developer Installer" \
  "$PKG_PATH"

echo ""
echo "✓ Done! Upload this to App Store Connect:"
echo "  $PKG_PATH"
echo ""
echo "  xcrun altool --upload-package \"$PKG_PATH\" \\"
echo "    --type macos \\"
echo "    --apiKey YOUR_API_KEY \\"
echo "    --apiIssuer YOUR_ISSUER_ID"
