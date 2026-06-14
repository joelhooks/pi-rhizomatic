#!/usr/bin/env bash
set -uo pipefail

ENV_FILE="${RHIZOMATIC_ENV_FILE:-$HOME/.config/rhizomatic/env}"
if [ -f "$ENV_FILE" ]; then
  set +u
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set -u
fi

PACKAGE="${PI_RHIZOMATIC_PACKAGE:-__PI_RHIZOMATIC_PACKAGE__}"
TSX="$PACKAGE/node_modules/.bin/tsx"

emit_fallback() {
  printf '%s\n' '{}'
}

if [ ! -d "$PACKAGE" ]; then
  printf 'pi-rhizomatic package not found: %s\n' "$PACKAGE" >&2
  emit_fallback
  exit 0
fi

if ! command -v node >/dev/null 2>&1 && [ -x /opt/homebrew/bin/fnm ]; then
  eval "$(/opt/homebrew/bin/fnm env --shell bash)" || true
  /opt/homebrew/bin/fnm use default >/dev/null 2>&1 || true
fi

if [ -x "$TSX" ] && command -v node >/dev/null 2>&1; then
  CMD=("$TSX" src/bin.ts hook "stop" --runtime "codex")
elif command -v bun >/dev/null 2>&1; then
  CMD=(bun src/bin.ts hook "stop" --runtime "codex")
elif [ -x "$HOME/.bun/bin/bun" ]; then
  CMD=("$HOME/.bun/bin/bun" src/bin.ts hook "stop" --runtime "codex")
elif [ -x /opt/homebrew/bin/bun ]; then
  CMD=(/opt/homebrew/bin/bun src/bin.ts hook "stop" --runtime "codex")
else
  printf 'pi-rhizomatic stop hook has no node/tsx or bun runtime available\n' >&2
  emit_fallback
  exit 0
fi

TMP_OUT="$(mktemp "${TMPDIR:-/tmp}/rhizomatic-codex-stop.out.XXXXXX")"
TMP_ERR="$(mktemp "${TMPDIR:-/tmp}/rhizomatic-codex-stop.err.XXXXXX")"
cleanup() {
  rm -f "$TMP_OUT" "$TMP_ERR"
}
trap cleanup EXIT

if ! cd "$PACKAGE"; then
  printf 'failed to cd into pi-rhizomatic package: %s\n' "$PACKAGE" >&2
  emit_fallback
  exit 0
fi

if "${CMD[@]}" >"$TMP_OUT" 2>"$TMP_ERR"; then
  # Rhizomatic Stop is observational only. Keep Codex startup/shutdown strict and non-blocking.
  emit_fallback
  exit 0
else
  STATUS=$?
  printf 'pi-rhizomatic stop hook command failed with code %s\n' "$STATUS" >&2
  if [ -s "$TMP_ERR" ]; then
    sed -n '1,80p' "$TMP_ERR" >&2
  fi
  emit_fallback
  exit 0
fi
