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
  printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"Rhizomatic briefing unavailable: hook runner failed before emitting valid JSON."}}'
}

sanitize_session_start_json() {
  python3 - "$1" <<'PY'
import json
import sys

with open(sys.argv[1], "r", encoding="utf-8") as f:
    raw = f.read().strip()
if not raw:
    raise SystemExit("empty hook stdout")
value = json.loads(raw)
if not isinstance(value, dict):
    raise SystemExit("hook stdout was not a JSON object")
hook_specific = value.get("hookSpecificOutput")
additional_context = "Rhizomatic briefing unavailable."
if (
    isinstance(hook_specific, dict)
    and hook_specific.get("hookEventName") == "SessionStart"
    and isinstance(hook_specific.get("additionalContext"), str)
):
    additional_context = hook_specific["additionalContext"]
print(json.dumps({
    "hookSpecificOutput": {
        "hookEventName": "SessionStart",
        "additionalContext": additional_context,
    }
}, separators=(",", ":")))
PY
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
  CMD=("$TSX" src/bin.ts hook "session-start" --runtime "codex")
elif command -v bun >/dev/null 2>&1; then
  CMD=(bun src/bin.ts hook "session-start" --runtime "codex")
elif [ -x "$HOME/.bun/bin/bun" ]; then
  CMD=("$HOME/.bun/bin/bun" src/bin.ts hook "session-start" --runtime "codex")
elif [ -x /opt/homebrew/bin/bun ]; then
  CMD=(/opt/homebrew/bin/bun src/bin.ts hook "session-start" --runtime "codex")
else
  printf 'pi-rhizomatic hook has no node/tsx or bun runtime available\n' >&2
  emit_fallback
  exit 0
fi

TMP_OUT="$(mktemp "${TMPDIR:-/tmp}/rhizomatic-codex-session-start.out.XXXXXX")"
TMP_ERR="$(mktemp "${TMPDIR:-/tmp}/rhizomatic-codex-session-start.err.XXXXXX")"
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
  if command -v python3 >/dev/null 2>&1 && sanitize_session_start_json "$TMP_OUT"; then
    exit 0
  fi
  printf 'pi-rhizomatic hook emitted invalid SessionStart JSON; falling back. stdout was:\n' >&2
  sed -n '1,40p' "$TMP_OUT" >&2
  if [ -s "$TMP_ERR" ]; then
    printf 'stderr was:\n' >&2
    sed -n '1,80p' "$TMP_ERR" >&2
  fi
  emit_fallback
  exit 0
else
  STATUS=$?
  printf 'pi-rhizomatic session-start hook command failed with code %s\n' "$STATUS" >&2
  if [ -s "$TMP_ERR" ]; then
    sed -n '1,80p' "$TMP_ERR" >&2
  fi
  emit_fallback
  exit 0
fi
