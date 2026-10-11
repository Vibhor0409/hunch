#!/usr/bin/env bash
# Hunch app release for Expo Go.
# Points the app at the production API, publishes an EAS Update on the
# preview channel, and prints the Expo Go QR URLs.
#
# Usage: scripts/release.sh <production-api-url> "<update message>"
# Example: scripts/release.sh https://hunch-api.vercel.app "Phase 3 launch"
set -euo pipefail

API_URL="${1:-}"
MESSAGE="${2:-Hunch release}"
if [ -z "$API_URL" ]; then
  echo "usage: $0 <production-api-url> \"<update message>\"" >&2
  exit 1
fi
case "$API_URL" in
  https://*) ;;
  *) echo "warning: API URL does not start with https:// ($API_URL)" >&2 ;;
esac

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MOBILE="$ROOT/mobile"
APP_JSON="$MOBILE/app.json"
CHANNEL="preview"

PROJECT_ID="$(node -e 'console.log(require(process.argv[1]).expo.extra.eas.projectId)' "$APP_JSON")"
RUNTIME="$(node -e 'console.log(require(process.argv[1]).expo.runtimeVersion)' "$APP_JSON")"

if [ -z "$PROJECT_ID" ] || [ "$PROJECT_ID" = "undefined" ]; then
  echo "error: no extra.eas.projectId in $APP_JSON (run: npx eas-cli init)" >&2
  exit 1
fi
case "$RUNTIME" in
  exposdk:*.0.0) ;;
  *)
    echo "error: app.json runtimeVersion is '$RUNTIME'. Expo Go only loads 'exposdk:<major>.0.0'." >&2
    exit 1
    ;;
esac

# 1. Point the app at the production API (overwrites the local LAN value).
printf 'EXPO_PUBLIC_API_URL=%s\n' "$API_URL" > "$MOBILE/.env"
echo "Wrote $MOBILE/.env -> EXPO_PUBLIC_API_URL=$API_URL"

# 2. Publish the update. expo export loads mobile/.env, so the URL is inlined.
cd "$MOBILE"
npx eas-cli update --channel "$CHANNEL" --message "$MESSAGE" --non-interactive

# 3. Print the Expo Go QR URLs.
BASE="https://qr.expo.dev/eas-update?projectId=$PROJECT_ID&runtimeVersion=$RUNTIME&channel=$CHANNEL"
echo
echo "Expo Go QR code (open in a browser, scan with the iPhone camera):"
echo "$BASE"
echo
echo "Plain launch URL:"
echo "$BASE&format=url"
