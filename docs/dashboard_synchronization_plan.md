# Dashboard Synchronization Plan (OpenClaw Control UI Overlay)

This document defines the recommended workflow for keeping two gateways (macOS + Linux/NUC/VM) in sync while using a shared Git repo for the dashboard UI overlay.

## Goals

- One shared dashboard codebase: build once per machine, deploy consistently.
- Avoid “implement twice” work across two dashboards.
- Safe automation: gateways can auto-deploy; source-of-truth machine does not auto-push half-finished work.
- Support mixed OS (macOS + Linux): handle path + service differences cleanly.

## Definitions

- Repo: `~/openclaw-dashboard` (on each machine)
- Branch: `custom-dashboard` (shared UI overlay branch)
- Build output: `dist/control-ui/`
- Gateway setting: `gateway.controlUi.root` points at the build output directory
- Setup script (repo): `setup-gateway-dashboard.sh`
- Setup doc (repo): `SETUP-OTHER-MACHINE.md`

## Recommended High-Level Workflow (Single Dev Machine)

### Source-of-truth dev machine

You (or an agent) make changes locally, then explicitly:

1. `pnpm ui:build` (or run `./setup-gateway-dashboard.sh` to rebuild + restart local gateway)
2. `git commit`
3. `git push origin custom-dashboard`

Do **not** use a cron job to automatically commit/push. Auto-push tends to ship broken or incomplete work.

### Deployment machines (both gateways)

Each gateway machine runs a nightly (or manual) deployment:

```bash
cd ~/openclaw-dashboard
git checkout custom-dashboard
git pull
./setup-gateway-dashboard.sh
```

This pulls the latest code, rebuilds `dist/control-ui/`, sets `gateway.controlUi.root`, applies allowlist entries (if enabled in the script), and restarts the gateway.

## Scheduling Model

### Gateways: nightly auto-deploy

Gateways can safely auto-deploy because the job:

- Pulls a known branch (`custom-dashboard`)
- Rebuilds the UI
- Restarts the gateway
- Can log output for debugging

Recommended schedule:

- Run once nightly during a low-usage window (example: 03:00 local time).

### Dev machine: optional nightly verification (no push)

If desired, add a nightly job on the dev machine that:

- warns if the working tree is dirty
- runs `pnpm ui:build` to ensure builds still pass
- does **not** commit or push

## Mixed OS Considerations (macOS vs Linux)

### Differences you must expect

- Filesystem paths:
  - macOS typically: `/Users/carlos/openclaw-dashboard/dist/control-ui`
  - Linux typically: `/home/carlos/openclaw-dashboard/dist/control-ui`
- Service manager:
  - macOS: launchd
  - Linux: systemd user service

### What stays consistent

- Git pull/build workflow
- Gateway `controlUi.root` behavior
- The overlay architecture in the UI

## Machine Health Tab (Option A: allowlist)

The Machine Health page uses `node.invoke(system.run)` to collect CPU/RAM/disk.
OpenClaw treats `system.run` as a sensitive capability.

To avoid repeated approval prompts:

- Keep exec security in allowlist mode
- Allowlist only the specific read-only binaries used for metrics:
  - `df`, `uptime`, `sysctl`, `vm_stat` (macOS)
  - `df`, `uptime`, `free` (Linux)

The `setup-gateway-dashboard.sh` script already attempts to add common paths for these commands via:

```bash
openclaw approvals allowlist add --agent "*" "/usr/bin/uptime"
```

Note: binary paths differ across machines; if a path doesn’t exist, allowlisting it is harmless.

## Conflict Avoidance Rules

If you want the “single dev machine” model to remain painless:

- Only one machine should ever be used to *author changes*.
- Gateway machines should be treated as “deploy targets”.
- If you must hotfix on a gateway machine:
  - `git pull --rebase` first
  - commit and push immediately
  - get back to a single source-of-truth machine ASAP

## “What If A Gateway Deploy Fails?”

Common failure modes:

- `git pull` fails (network or auth)
- `pnpm install` fails (registry/network)
- `pnpm ui:build` fails (TypeScript or bundler error)
- gateway restart fails (service misconfigured)

Recommended operational practices:

- always redirect job output to a log file (per machine)
- keep the prior build around (the gateway will keep serving the last successful build if restart/build is not applied)
- if the gateway service is broken (common on Linux), run:
  - `openclaw doctor --repair`
  - or reinstall service: `openclaw gateway uninstall && openclaw gateway install`

## Minimal “Deploy Checklist” (manual)

When you want to deploy on a gateway manually:

```bash
cd ~/openclaw-dashboard
git checkout custom-dashboard
git pull
./setup-gateway-dashboard.sh
openclaw gateway status
```

