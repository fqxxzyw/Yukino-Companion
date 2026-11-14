#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT/scripts/env.sh"
cd "$ROOT"

if [ -z "${YUKINO_KEYSTORE_PROPERTIES:-}" ]; then
  for candidate in \
    "$HOME/yukino-android-keys/keystore.properties" \
    "$ROOT/../yukino-android-keys/keystore.properties"
  do
    if [ -f "$candidate" ]; then
      export YUKINO_KEYSTORE_PROPERTIES="$candidate"
      break
    fi
  done
fi
if [ -z "${YUKINO_KEYSTORE_PROPERTIES:-}" ] || [ ! -f "${YUKINO_KEYSTORE_PROPERTIES}" ]; then
  echo "未找到发布签名配置。请自行保管 keystore，并将 YUKINO_KEYSTORE_PROPERTIES 指向 keystore.properties。仓库中不包含密钥。" >&2
  exit 1
fi

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
./gradlew assembleRelease --no-daemon --max-workers=1
APK="app/build/outputs/apk/release/app-release.apk"
ls -lh "$APK"
cp -f "$APK" "$ROOT/Yukino-Companion-android.apk"
echo "APK $ROOT/Yukino-Companion-android.apk"
