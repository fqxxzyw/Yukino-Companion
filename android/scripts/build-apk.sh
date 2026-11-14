#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT/scripts/env.sh"
cd "$ROOT"

if ! ls "$ROOT/public/models/local-yukino-outfits/"*.vrm >/dev/null 2>&1; then
  echo "未找到本地 VRM，正在从发行版下载…"
  bash "$ROOT/scripts/fetch-models.sh"
fi

npm test
npm run build
if [ ! -d android ]; then
  npx cap add android
fi
cat > android/local.properties <<PROP
sdk.dir=${ANDROID_HOME}
PROP
npx cap sync android
cd android
./gradlew assembleDebug --no-daemon --max-workers=1
APK="app/build/outputs/apk/debug/app-debug.apk"
ls -lh "$APK"
cp -f "$APK" "$ROOT/Yukino-Companion-debug.apk"
echo "APK $ROOT/Yukino-Companion-debug.apk"
