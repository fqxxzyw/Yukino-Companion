# Optional machine-specific overrides (JAVA_HOME, ANDROID_HOME). Do not commit this file.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/env.local.sh" ]; then
  # shellcheck source=/dev/null
  source "$SCRIPT_DIR/env.local.sh"
fi

if [ -z "${JAVA_HOME:-}" ] || [ ! -x "${JAVA_HOME}/bin/java" ]; then
  echo "请将 JAVA_HOME 设为 JDK 21 的安装路径，或在 scripts/env.local.sh 中导出。" >&2
  exit 1
fi
if [ -z "${ANDROID_HOME:-}" ]; then
  if [ -n "${ANDROID_SDK_ROOT:-}" ]; then
    ANDROID_HOME="$ANDROID_SDK_ROOT"
  else
    echo "请将 ANDROID_HOME 设为 Android SDK 路径，或在 scripts/env.local.sh 中导出。" >&2
    exit 1
  fi
fi
export JAVA_HOME
export ANDROID_HOME
export ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-$ANDROID_HOME}"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH"
