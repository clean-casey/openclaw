# Setup On Another Machine (One Command)

This repo contains a custom OpenClaw control-ui overlay. On a new machine, you typically need:

1. Pull/build the UI assets (`dist/control-ui/`)
2. Point the gateway at those assets (`gateway.controlUi.root`)
3. (Optional) Allowlist read-only system binaries so the Machine Health tab does not prompt for exec approvals

## Quick Start

From the machine where the gateway runs:

```bash
cd ~/openclaw-dashboard
git checkout custom-dashboard
git pull
./setup-gateway-dashboard.sh
```

## What The Script Does

- Runs `pnpm install` and `pnpm ui:build`
- Sets:
  - `gateway.controlUi.enabled = true`
  - `gateway.controlUi.root = <this repo>/dist/control-ui`
- Adds allowlist patterns (agent `*`) for safe read-only commands used by the Machine Health tab:
  - `df`, `uptime`, `sysctl`, `vm_stat`, `free` (platform-dependent)
- Restarts the gateway service (`openclaw gateway restart`, falling back to `start`)

## Manual Setup (If You Prefer)

Build:

```bash
cd ~/openclaw-dashboard
pnpm install
pnpm ui:build
```

Configure the gateway:

```bash
openclaw config set --json gateway.controlUi.enabled true
openclaw config set --json gateway.controlUi.root "\"$HOME/openclaw-dashboard/dist/control-ui\""
openclaw gateway restart
```

Allowlist (optional, avoids prompts):

```bash
openclaw approvals allowlist add --agent "*" "/bin/df"
openclaw approvals allowlist add --agent "*" "/usr/bin/df"
openclaw approvals allowlist add --agent "*" "/usr/bin/uptime"
openclaw approvals allowlist add --agent "*" "/usr/sbin/sysctl"
openclaw approvals allowlist add --agent "*" "/usr/bin/vm_stat"
openclaw approvals allowlist add --agent "*" "/usr/bin/free"
openclaw approvals allowlist add --agent "*" "/bin/free"
openclaw gateway restart
```

