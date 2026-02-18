import { LitElement, html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { GatewayBrowserClient, GatewayHelloOk } from "../../gateway.ts";
import type {
  AgentsListResult,
  ChannelsStatusSnapshot,
  CronStatus,
  HealthSnapshot,
  StatusSummary,
} from "../../types.ts";
import { formatDurationHuman } from "../../format.ts";
import type { AppViewState } from "../../app-view-state.ts";
import { registerCustomTab } from "../registry.ts";
import { renderStatusCard } from "../components/status-card.ts";

type ModelsListPayload = { models?: unknown[] } | null;

@customElement("openclaw-server-resources")
class OpenClawServerResources extends LitElement {
  @property({ attribute: false }) client: GatewayBrowserClient | null = null;
  @property({ type: Boolean }) connected = false;
  @property({ attribute: false }) hello: GatewayHelloOk | null = null;

  @state() private loading = false;
  @state() private error: string | null = null;

  @state() private status: StatusSummary | null = null;
  @state() private health: HealthSnapshot | null = null;
  @state() private agents: AgentsListResult | null = null;
  @state() private models: unknown[] = [];
  @state() private presence: unknown[] = [];
  @state() private channels: ChannelsStatusSnapshot | null = null;
  @state() private cronStatus: CronStatus | null = null;

  protected updated(changed: Map<string, unknown>) {
    const shouldAutoRefresh =
      (changed.has("connected") || changed.has("client")) && this.connected && this.client;
    if (shouldAutoRefresh) {
      void this.refresh();
    }
  }

  private async refresh() {
    if (!this.client || !this.connected) {
      return;
    }
    if (this.loading) {
      return;
    }
    this.loading = true;
    this.error = null;
    try {
      const [status, health, agents, models, presence, channels, cronStatus] = await Promise.all([
        this.client.request("status", {}),
        this.client.request("health", {}),
        this.client.request("agents.list", {}),
        this.client.request("models.list", {}),
        this.client.request("system-presence", {}),
        this.client.request("channels.status", { probe: false, timeoutMs: 8000 }),
        this.client.request("cron.status", {}),
      ]);

      this.status = status as StatusSummary;
      this.health = health as HealthSnapshot;
      this.agents = agents as AgentsListResult;

      const modelPayload = models as ModelsListPayload;
      this.models = Array.isArray(modelPayload?.models) ? modelPayload?.models ?? [] : [];

      this.presence = Array.isArray(presence) ? presence : [];
      this.channels = channels as ChannelsStatusSnapshot | null;
      this.cronStatus = cronStatus as CronStatus | null;
    } catch (err) {
      this.error = String(err);
    } finally {
      this.loading = false;
    }
  }

  private renderJson(value: unknown): TemplateResult {
    return html`<pre class="code-block">${JSON.stringify(value ?? {}, null, 2)}</pre>`;
  }

  protected render(): TemplateResult {
    const uptimeMs = (this.hello?.snapshot as { uptimeMs?: number } | undefined)?.uptimeMs ?? null;
    const uptimeLabel = uptimeMs == null ? "n/a" : formatDurationHuman(uptimeMs);

    const agents = this.agents?.agents ?? [];
    const agentsCount = agents.length;
    const modelsCount = this.models.length;
    const presenceCount = this.presence.length;
    const cronEnabled = this.cronStatus?.enabled ?? null;

    const healthTone = this.connected ? "success" : "danger";

    return html`
      <section class="grid grid-cols-2">
        ${renderStatusCard({
          title: "Connection",
          subtitle: "Gateway WebSocket + hello snapshot",
          tone: healthTone,
          body: html`
            <div class="row" style="justify-content: space-between;">
              <div>
                <div><span class="muted">Connected:</span> ${this.connected ? "yes" : "no"}</div>
                <div><span class="muted">Uptime:</span> <span class="mono">${uptimeLabel}</span></div>
              </div>
              <button class="btn" ?disabled=${this.loading || !this.connected} @click=${() => this.refresh()}>
                ${this.loading ? "Refreshing…" : "Refresh"}
              </button>
            </div>
            ${this.error ? html`<div class="callout danger" style="margin-top: 12px;">${this.error}</div>` : nothing}
          `,
        })}

        ${renderStatusCard({
          title: "Inventory",
          subtitle: "Agents, models, presence",
          tone: "neutral",
          body: html`
            <div class="stack">
              <div><span class="muted">Agents:</span> <span class="mono">${agentsCount}</span></div>
              <div><span class="muted">Models:</span> <span class="mono">${modelsCount}</span></div>
              <div><span class="muted">Presence entries:</span> <span class="mono">${presenceCount}</span></div>
              <div>
                <span class="muted">Cron enabled:</span>
                <span class="mono">${cronEnabled == null ? "n/a" : cronEnabled ? "yes" : "no"}</span>
              </div>
            </div>
          `,
        })}
      </section>

      <section class="card" style="margin-top: 18px;">
        <div class="card-title">Agents</div>
        <div class="card-sub">From <span class="mono">agents.list</span>.</div>
        ${this.renderJson(this.agents)}
      </section>

      <section class="card" style="margin-top: 18px;">
        <div class="card-title">Models</div>
        <div class="card-sub">From <span class="mono">models.list</span>.</div>
        ${this.renderJson(this.models)}
      </section>

      <section class="grid grid-cols-2" style="margin-top: 18px;">
        <div class="card">
          <div class="card-title">Status</div>
          <div class="card-sub">From <span class="mono">status</span>.</div>
          ${this.renderJson(this.status)}
        </div>
        <div class="card">
          <div class="card-title">Health</div>
          <div class="card-sub">From <span class="mono">health</span> and <span class="mono">channels.status</span>.</div>
          ${this.renderJson({ health: this.health, channels: this.channels })}
        </div>
      </section>

      <section class="card" style="margin-top: 18px;">
        <div class="card-title">Presence</div>
        <div class="card-sub">From <span class="mono">system-presence</span>.</div>
        ${this.renderJson(this.presence)}
      </section>

      <section class="card" style="margin-top: 18px;">
        <div class="card-title">Cron</div>
        <div class="card-sub">From <span class="mono">cron.status</span>.</div>
        ${this.renderJson(this.cronStatus)}
      </section>
    `;
  }
}

function renderServerResourcesTab(state: AppViewState): TemplateResult {
  return html`
    <openclaw-server-resources
      .client=${state.client}
      .hello=${state.hello}
      .connected=${state.connected}
    ></openclaw-server-resources>
  `;
}

registerCustomTab({
  id: "custom:server-resources",
  title: "Resources",
  subtitle: "Server snapshots, agents/models, and presence.",
  icon: "monitor",
  render: renderServerResourcesTab,
});

