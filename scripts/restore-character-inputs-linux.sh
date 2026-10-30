#!/usr/bin/env bash
set -euo pipefail
if [[ "${GITHUB_ACTIONS:-}" != true || "${RUNNER_ENVIRONMENT:-}" != github-hosted || -z "${RUNNER_TEMP:-}" ]]; then
  echo 'Use only on an isolated GitHub-hosted runner.' >&2; exit 1
fi
work="$(mktemp -d "${RUNNER_TEMP%/}/yukino-model-restore.XXXXXXXX")"
trap 'rm -rf -- "$work"' EXIT
url='https://github.com/fqxxzyw/Yukino-Companion/releases/download/v0.4.0-test.40913001300/Yukino-Companion-0.4.0-Base-Setup.exe'
curl --fail --location --silent --show-error --retry 3 --proto '=https' --tlsv1.2 "$url" --output "$work/previous.exe"
[[ "$(wc -c < "$work/previous.exe")" -eq 258519106 ]] || { echo 'Previous installer size mismatch' >&2; exit 1; }
printf '%s  %s\n' '9303829072f1e97eba172bf88f2c3e279312dae13a8879308142f7aae4ef0011' "$work/previous.exe" | sha256sum --check --status
mkdir "$work/extracted"
# Extraction is temporary and the hash-checked ASAR is never uploaded.
innoextract --silent --extract --output-dir "$work/extracted" "$work/previous.exe"
mapfile -t archives < <(find "$work/extracted" -type f -name app.asar -print)
[[ ${#archives[@]} -eq 1 ]] || { echo 'Previous installer did not contain exactly one app.asar' >&2; exit 1; }
node scripts/restore-character-inputs.cjs "${archives[0]}"
