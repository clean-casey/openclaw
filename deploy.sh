#!/usr/bin/env bash
set -euo pipefail

BRANCH="${1:-custom-dashboard}"
REMOTE="${REMOTE:-origin}"

cd "$(dirname "$0")"

echo "[deploy] updating git checkout (${REMOTE}/${BRANCH})"
git fetch --prune "${REMOTE}"
git checkout "${BRANCH}"
git pull --ff-only "${REMOTE}" "${BRANCH}"

echo "[deploy] installing deps"
pnpm install

echo "[deploy] building control-ui"
pnpm ui:build

echo "[deploy] done: dist/control-ui is updated"
echo "[deploy] if the gateway is already running, restart it to be safe"

