#!/usr/bin/env bash
# Download the six integrated VRM outfits from the public pre-release and
# verify SHA-256 of the zip and of each extracted model against catalog.json.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/public/models/local-yukino-outfits"
CATALOG="$DEST/catalog.json"
REPO="${YUKINO_MODELS_REPO:-fqxxzyw/Yukino-Companion}"
TAG="${YUKINO_MODELS_TAG:-yukino-models-20261114}"
ASSET="${YUKINO_MODELS_ASSET:-Yukino-3D-Models-20261114.zip}"
EXPECTED_ZIP_SHA256="${YUKINO_MODELS_ZIP_SHA256:-d51fde3acd9674577c7d0092207522bfc2d20ff98e94c7353e043cf655fc965a}"
URL="https://github.com/${REPO}/releases/download/${TAG}/${ASSET}"

if [ ! -f "$CATALOG" ]; then
  echo "缺少服装清单：$CATALOG" >&2
  exit 1
fi

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
ZIP="$TMP/$ASSET"

echo "正在下载 ${URL}"
if command -v gh >/dev/null 2>&1 && gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
  gh release download "$TAG" --repo "$REPO" --pattern "$ASSET" --dir "$TMP"
else
  curl -L --fail --retry 3 --retry-delay 2 -o "$ZIP" "$URL"
fi

if [ ! -f "$ZIP" ]; then
  echo "未能下载模型包 $ASSET" >&2
  exit 1
fi

GOT="$(sha256_file "$ZIP")"
if [ "$GOT" != "$EXPECTED_ZIP_SHA256" ]; then
  echo "模型包 SHA-256 校验失败。" >&2
  echo "期望：$EXPECTED_ZIP_SHA256" >&2
  echo "实际：$GOT" >&2
  exit 1
fi
echo "模型包 SHA-256 已核对：$GOT"

mkdir -p "$DEST"
unzip -o "$ZIP" -d "$TMP/extracted" >/dev/null
SRC="$TMP/extracted/local-yukino-outfits"
if [ ! -d "$SRC" ]; then
  SRC="$(find "$TMP/extracted" -type d -name local-yukino-outfits | head -n 1)"
fi
if [ -z "$SRC" ] || [ ! -d "$SRC" ]; then
  echo "压缩包中找不到 local-yukino-outfits 目录。" >&2
  exit 1
fi

# Copy VRM files only; keep the committed catalog and action packs as the source of truth.
shopt -s nullglob
vrms=( "$SRC"/*.vrm )
if [ "${#vrms[@]}" -eq 0 ]; then
  echo "压缩包中没有 VRM 文件。" >&2
  exit 1
fi
cp -f "${vrms[@]}" "$DEST/"

python3 - "$CATALOG" "$DEST" << 'PY'
import hashlib, json, sys
from pathlib import Path

catalog_path = Path(sys.argv[1])
dest = Path(sys.argv[2])
catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
outfits = catalog.get("outfits") or {}
if not outfits:
    raise SystemExit("catalog.json 中没有 outfits。")

failed = 0
for name, item in outfits.items():
    expected_sha = item["sha256"]
    expected_bytes = item["bytes"]
    path = dest / f"{expected_sha}.vrm"
    if not path.is_file():
        print(f"FAIL {name}: 缺少 {path.name}", file=sys.stderr)
        failed += 1
        continue
    data = path.read_bytes()
    got = hashlib.sha256(data).hexdigest()
    if len(data) != expected_bytes or got != expected_sha:
        print(f"FAIL {name}: size={len(data)} expected={expected_bytes} sha={got}", file=sys.stderr)
        failed += 1
    else:
        print(f"OK {name}: {path.name} ({expected_bytes} bytes)")
if failed:
    raise SystemExit(f"有 {failed} 个 VRM 未通过校验。")
print(f"已写入 {len(outfits)} 套服装，校验全部通过。")
PY
