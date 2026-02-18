#!/usr/bin/env bash
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$here"

if ! command -v openclaw >/dev/null 2>&1; then
  echo "[setup] ERROR: openclaw is not installed on this machine"
  exit 1
fi
if ! command -v pnpm >/dev/null 2>&1; then
  echo "[setup] ERROR: pnpm is not installed on this machine"
  exit 1
fi

echo "[setup] build control-ui"
pnpm install
pnpm ui:build

ui_root="$here/dist/control-ui"
if [ ! -f "$ui_root/index.html" ]; then
  echo "[setup] ERROR: expected $ui_root/index.html to exist after build"
  exit 1
fi

echo "[setup] configure gateway.controlUi.root"
openclaw config set --json gateway.controlUi.enabled true

# JSON5 string value; easiest is to pass a quoted JSON string.
ui_root_json="$(python - <<PY
import json
print(json.dumps("$ui_root"))
PY
)"
openclaw config set --json gateway.controlUi.root "$ui_root_json"

echo "[setup] allowlist read-only system commands (optional but recommended)"
# These are safe, read-only commands used by the Machine Health tab.
# It's ok if some don't exist on a given OS; allowlisting a non-existent path is harmless.
openclaw approvals allowlist add --agent "*" "/bin/df" || true
openclaw approvals allowlist add --agent "*" "/usr/bin/df" || true
openclaw approvals allowlist add --agent "*" "/usr/bin/uptime" || true
openclaw approvals allowlist add --agent "*" "/usr/sbin/sysctl" || true
openclaw approvals allowlist add --agent "*" "/usr/bin/vm_stat" || true
openclaw approvals allowlist add --agent "*" "/usr/bin/free" || true
openclaw approvals allowlist add --agent "*" "/bin/free" || true

echo "[setup] restart gateway"
openclaw gateway restart || openclaw gateway start

echo "[setup] done"
echo "[setup] dashboard should be at: http://127.0.0.1:$(openclaw config get gateway.port 2>/dev/null || echo 19002)/"

