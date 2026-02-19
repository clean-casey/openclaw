# Custom Pages Guide (Overlay Pattern)

This repo keeps OpenClaw's stock control-ui intact while adding custom dashboard pages via an overlay under `ui/src/ui/custom/`.

Key idea: custom pages register themselves into a runtime registry. The stock nav and renderer then treat them like first-class tabs.

## Concepts

- Custom tab IDs use the prefix `custom:` (example: `custom:server-resources`).
- Custom tab URL paths are `/custom/<slug>` (example: `/custom/server-resources`).
- Custom pages live under `ui/src/ui/custom/` and are imported via one entry file:
  - `ui/src/ui/custom/register.ts`

## Files You’ll Touch

- `ui/src/ui/custom/register.ts`
  - Single import point. Add one import per custom page/view.
- `ui/src/ui/custom/registry.ts`
  - Registry API: `registerCustomTab()`, `listCustomTabs()`, `getCustomTab()`.
- `ui/src/ui/custom/views/*.ts`
  - One file per custom page/tab.
- `ui/src/ui/custom/components/*.ts`
  - Reusable UI widgets for custom pages.

## Add A New Page (Step-by-Step)

### 1) Create a new view file

Example: `ui/src/ui/custom/views/my-page.ts`

In that file, register a tab:

```ts
import { html, type TemplateResult } from "lit";
import type { AppViewState } from "../../app-view-state.ts";
import { registerCustomTab } from "../registry.ts";

function renderMyPage(state: AppViewState): TemplateResult {
  return html`<section class="card">Hello from my page.</section>`;
}

registerCustomTab({
  id: "custom:my-page",
  title: "My Page",
  subtitle: "A custom overlay tab.",
  icon: "monitor",
  render: renderMyPage,
});
```

### 2) Import it from `custom/register.ts`

Add one line:

```ts
import "./views/my-page.ts";
```

That’s it — the tab appears automatically in the nav (under the Control group).

## Calling the Gateway (RPC)

The gateway speaks WebSocket JSON-RPC via `state.client.request(method, params)`.

Common “server resources” methods:

- `status`
- `health`
- `agents.list`
- `models.list`
- `system-presence`
- `channels.status` (use `{ probe: false, timeoutMs: 8000 }`)
- `cron.status`
- `last-heartbeat`

Best practice for custom pages:

- Use a small custom element (Lit component) that receives:
  - `.client=${state.client}`
  - `.connected=${state.connected}`
  - `.hello=${state.hello}` (for `uptimeMs`)
- Fetch inside the element and render structured cards + JSON dumps.

See: `ui/src/ui/custom/views/server-resources.ts`.

## Documents Page (RAG)

This repo also includes a custom "Documents" page (`custom:documents`) for managing a tenant-scoped RAG index.

It expects the gateway to expose `rag.*` JSON-RPC methods. Those are provided via the plugin at:

- `extensions/rag-docs/` (plugin id: `rag-docs`)

Token/tenant segregation is enforced by the RAG API token configured in each agent/workspace's `config/mcporter.json` (the gateway reads that file server-side; the browser never sees the bearer token).

## Local Development

From repo root:

```bash
pnpm install
pnpm ui:dev
```

Then open the UI URL served by the gateway (or follow the `ui:dev` output if running standalone dev server).

## Build For Deployment

```bash
pnpm ui:build
```

Build output: `dist/control-ui/`

## Deploy Into A Gateway

Point the gateway at this build output:

```json
{
  "gateway": {
    "controlUi": {
      "root": "/absolute/path/to/openclaw-dashboard/dist/control-ui"
    }
  }
}
```

Restart the gateway after changing `controlUi.root` (or after a fresh build) to ensure it serves the updated assets.

## Upstream Updates

Your overlay lives in `ui/src/ui/custom/`, which upstream does not touch.

To incorporate upstream UI upgrades:

```bash
git fetch upstream
git merge upstream/main
```

If there’s a conflict, it should be limited to the small integration glue (nav/render imports).

