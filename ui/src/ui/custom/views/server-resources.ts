import { LitElement, html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { GatewayBrowserClient, GatewayHelloOk } from "../../gateway.ts";
import { formatDurationHuman } from "../../format.ts";
import type { AppViewState } from "../../app-view-state.ts";
import { registerCustomTab } from "../registry.ts";
import { renderStatusCard } from "../components/status-card.ts";

type NodeListResponse = {
  ts?: number;
  nodes?: Array<{
    nodeId: string;
    displayName?: string;
    platform?: string;
    deviceFamily?: string;
    connected?: boolean;
    commands?: string[];
    caps?: string[];
  }>;
};

@customElement("openclaw-server-resources")
class OpenClawServerResources extends LitElement {
  @property({ attribute: false }) client: GatewayBrowserClient | null = null;
  @property({ type: Boolean }) connected = false;
  @property({ attribute: false }) hello: GatewayHelloOk | null = null;

  // Render into light DOM so existing control-ui CSS applies.
  createRenderRoot() {
    return this;
  }

  @state() private loading = false;
  @state() private error: string | null = null;

  @state() private nodeId: string | null = null;
  @state() private nodeLabel: string | null = null;
  @state() private platform: string | null = null;

  @state() private loadAvg: { one: number; five: number; fifteen: number } | null = null;
  @state() private mem: { total: number; used: number; free: number } | null = null;
  @state() private diskRoot: { total: number; used: number; free: number } | null = null;
  @state() private gpu: { summary: string; raw?: unknown } | null = null;

  protected updated(changed: Map<string, unknown>) {
    const shouldAutoRefresh =
      (changed.has("connected") || changed.has("client")) && this.connected && this.client;
    if (shouldAutoRefresh) {
      void this.refresh();
    }
  }

  private formatBytes(bytes: number | null): string {
    if (bytes == null || !Number.isFinite(bytes)) {
      return "n/a";
    }
    const units = ["B", "KB", "MB", "GB", "TB"];
    let value = bytes;
    let idx = 0;
    while (value >= 1024 && idx < units.length - 1) {
      value /= 1024;
      idx++;
    }
    const decimals = idx <= 1 ? 0 : idx === 2 ? 1 : 2;
    return `${value.toFixed(decimals)} ${units[idx]}`;
  }

  private pct(used: number, total: number): number | null {
    if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0) {
      return null;
    }
    return Math.max(0, Math.min(100, (used / total) * 100));
  }

  private async invokeNode<T = unknown>(params: {
    nodeId: string;
    command: string;
    params?: unknown;
    timeoutMs?: number;
  }): Promise<T> {
    if (!this.client) {
      throw new Error("no client");
    }
    const idempotencyKey =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : String(Date.now());
    const res = await this.client.request("node.invoke", {
      nodeId: params.nodeId,
      command: params.command,
      params: params.params ?? {},
      timeoutMs: params.timeoutMs ?? 8000,
      idempotencyKey,
    });
    // node.invoke wraps the node response
    const payload = (res as { payload?: unknown } | null)?.payload;
    return payload as T;
  }

  private async selectDefaultNode(): Promise<{
    nodeId: string;
    label: string;
    platform: string | null;
  }> {
    if (!this.client) {
      throw new Error("no client");
    }
    const list = (await this.client.request("node.list", {})) as NodeListResponse;
    const nodes = Array.isArray(list?.nodes) ? list.nodes : [];
    const connected = nodes.filter((n) => Boolean(n.connected));
    const pick = connected[0] ?? nodes[0];
    const nodeId = pick?.nodeId?.trim();
    if (!nodeId) {
      throw new Error("no nodes available (node.list empty)");
    }
    const label = pick.displayName?.trim() || nodeId;
    const platform = pick.platform?.trim() || null;
    return { nodeId, label, platform };
  }

  private parseLoadAvg(raw: string): { one: number; five: number; fifteen: number } | null {
    const text = raw.trim();
    // macOS: "load averages: 2.06 2.22 2.34"
    // Linux:  "load average: 0.20, 0.30, 0.40"
    const m =
      text.match(/load averages?:\s*([0-9.]+)[,\s]+([0-9.]+)[,\s]+([0-9.]+)/i) ??
      text.match(/^\s*([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\s+/);
    if (!m) {
      return null;
    }
    const one = Number(m[1]);
    const five = Number(m[2]);
    const fifteen = Number(m[3]);
    if (![one, five, fifteen].every((n) => Number.isFinite(n))) {
      return null;
    }
    return { one, five, fifteen };
  }

  private parseDfKb(raw: string): { total: number; used: number; free: number } | null {
    // df -kP /
    // Filesystem 1024-blocks Used Available Capacity Mounted on
    const lines = raw.trim().split("\n").filter(Boolean);
    if (lines.length < 2) {
      return null;
    }
    const cols = lines[1].trim().split(/\s+/);
    if (cols.length < 6) {
      return null;
    }
    const totalKb = Number(cols[1]);
    const usedKb = Number(cols[2]);
    const freeKb = Number(cols[3]);
    if (![totalKb, usedKb, freeKb].every((n) => Number.isFinite(n))) {
      return null;
    }
    return { total: totalKb * 1024, used: usedKb * 1024, free: freeKb * 1024 };
  }

  private parseFreeBytes(raw: string): { total: number; used: number; free: number } | null {
    // free -b
    const line = raw
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.startsWith("Mem:"));
    if (!line) {
      return null;
    }
    const cols = line.split(/\s+/);
    // Mem: total used free shared buff/cache available
    if (cols.length < 4) {
      return null;
    }
    const total = Number(cols[1]);
    const used = Number(cols[2]);
    const free = Number(cols[3]);
    if (![total, used, free].every((n) => Number.isFinite(n))) {
      return null;
    }
    return { total, used, free };
  }

  private parseVmStat(raw: string, totalBytes: number | null): { total: number; used: number; free: number } | null {
    // vm_stat
    const pageSizeMatch = raw.match(/page size of\s+(\d+)\s+bytes/i);
    const pageSize = pageSizeMatch ? Number(pageSizeMatch[1]) : 4096;
    const pages: Record<string, number> = {};
    for (const line of raw.split("\n")) {
      const m = line.match(/^(.*?):\s*([0-9]+)\.?/);
      if (!m) continue;
      const key = m[1].trim().toLowerCase();
      pages[key] = Number(m[2]);
    }
    const freePages = pages["pages free"] ?? 0;
    const active = pages["pages active"] ?? 0;
    const inactive = pages["pages inactive"] ?? 0;
    const wired = pages["pages wired down"] ?? 0;
    const speculative = pages["pages speculative"] ?? 0;
    const compressed = pages["pages occupied by compressor"] ?? 0;

    const free = freePages * pageSize;
    // Approx "used" as everything not free; speculative is often reclaimable but still resident.
    const usedApprox = (active + inactive + wired + speculative + compressed) * pageSize;
    const total = totalBytes ?? (free + usedApprox);
    if (!Number.isFinite(total) || total <= 0) {
      return null;
    }
    const used = Math.min(total, usedApprox);
    return { total, used, free: Math.max(0, total - used) };
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
      const picked = await this.selectDefaultNode();
      this.nodeId = picked.nodeId;
      this.nodeLabel = picked.label;
      this.platform = picked.platform;

      const which = await this.invokeNode<{ bins?: Record<string, string> }>({
        nodeId: picked.nodeId,
        command: "system.which",
        params: { bins: ["uptime", "sysctl", "vm_stat", "free", "df", "nvidia-smi"] },
      });
      const bins = which?.bins && typeof which.bins === "object" ? which.bins : {};

      // CPU load
      if (bins["sysctl"]) {
        const raw = await this.invokeNode<string>({
          nodeId: picked.nodeId,
          command: "system.run",
          params: { command: ["sysctl", "-n", "vm.loadavg"] },
        });
        this.loadAvg = this.parseLoadAvg(String(raw ?? "")) ?? null;
      } else if (bins["uptime"]) {
        const raw = await this.invokeNode<string>({
          nodeId: picked.nodeId,
          command: "system.run",
          params: { command: ["uptime"] },
        });
        this.loadAvg = this.parseLoadAvg(String(raw ?? "")) ?? null;
      } else {
        this.loadAvg = null;
      }

      // Memory
      if (bins["sysctl"] && bins["vm_stat"]) {
        const totalRaw = await this.invokeNode<string>({
          nodeId: picked.nodeId,
          command: "system.run",
          params: { command: ["sysctl", "-n", "hw.memsize"] },
        });
        const total = Number(String(totalRaw ?? "").trim());
        const vmRaw = await this.invokeNode<string>({
          nodeId: picked.nodeId,
          command: "system.run",
          params: { command: ["vm_stat"] },
        });
        this.mem = this.parseVmStat(String(vmRaw ?? ""), Number.isFinite(total) ? total : null);
      } else if (bins["free"]) {
        const raw = await this.invokeNode<string>({
          nodeId: picked.nodeId,
          command: "system.run",
          params: { command: ["free", "-b"] },
        });
        this.mem = this.parseFreeBytes(String(raw ?? ""));
      } else {
        this.mem = null;
      }

      // Disk (root filesystem)
      if (bins["df"]) {
        const raw = await this.invokeNode<string>({
          nodeId: picked.nodeId,
          command: "system.run",
          params: { command: ["df", "-kP", "/"] },
        });
        this.diskRoot = this.parseDfKb(String(raw ?? ""));
      } else {
        this.diskRoot = null;
      }

      // GPU (optional)
      if (bins["nvidia-smi"]) {
        const raw = await this.invokeNode<string>({
          nodeId: picked.nodeId,
          command: "system.run",
          params: {
            command: [
              "nvidia-smi",
              "--query-gpu=name,utilization.gpu,memory.total,memory.used",
              "--format=csv,noheader,nounits",
            ],
          },
        });
        const line = String(raw ?? "").trim().split("\n")[0]?.trim() ?? "";
        this.gpu = line ? { summary: line } : { summary: "nvidia-smi present but no data" };
      } else {
        this.gpu = { summary: "n/a (no GPU metrics command detected)" };
      }
    } catch (err) {
      this.error = String(err);
    } finally {
      this.loading = false;
    }
  }

  protected render(): TemplateResult {
    const uptimeMs = (this.hello?.snapshot as { uptimeMs?: number } | undefined)?.uptimeMs ?? null;
    const uptimeLabel = uptimeMs == null ? "n/a" : formatDurationHuman(uptimeMs);

    const healthTone = this.connected ? ("success" as const) : ("danger" as const);

    const memPct = this.mem ? this.pct(this.mem.used, this.mem.total) : null;
    const diskPct = this.diskRoot ? this.pct(this.diskRoot.used, this.diskRoot.total) : null;
    const load = this.loadAvg
      ? `${this.loadAvg.one.toFixed(2)} / ${this.loadAvg.five.toFixed(2)} / ${this.loadAvg.fifteen.toFixed(2)}`
      : "n/a";

    return html`
      <section class="grid grid-cols-2">
        ${renderStatusCard({
          title: "Gateway",
          subtitle: "Control UI connection to gateway",
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
          title: "Machine",
          subtitle: "Collected via node.invoke + system.run",
          tone: "neutral",
          body: html`
            <div class="stack">
              <div>
                <span class="muted">Node:</span>
                <span class="mono">${this.nodeLabel ?? "n/a"}</span>
              </div>
              <div>
                <span class="muted">Platform:</span>
                <span class="mono">${this.platform ?? "n/a"}</span>
              </div>
              <div><span class="muted">CPU load (1/5/15):</span> <span class="mono">${load}</span></div>
            </div>
          `,
        })}
      </section>

      <section class="grid grid-cols-2" style="margin-top: 18px;">
        <div class="card">
          <div class="card-title">RAM</div>
          <div class="card-sub">Total/used/free (best-effort, platform dependent)</div>
          ${
            this.mem
              ? html`
                  <div class="stack" style="margin-top: 12px;">
                    <div>
                      <span class="muted">Used:</span>
                      <span class="mono">${this.formatBytes(this.mem.used)}</span>
                      <span class="muted">of</span>
                      <span class="mono">${this.formatBytes(this.mem.total)}</span>
                      ${memPct == null ? nothing : html`<span class="muted">(${memPct.toFixed(1)}%)</span>`}
                    </div>
                    <div><span class="muted">Free:</span> <span class="mono">${this.formatBytes(this.mem.free)}</span></div>
                  </div>
                `
              : html`<div class="muted" style="margin-top: 12px;">n/a</div>`
          }
        </div>
        <div class="card">
          <div class="card-title">Disk</div>
          <div class="card-sub">Root filesystem (df -kP /)</div>
          ${
            this.diskRoot
              ? html`
                  <div class="stack" style="margin-top: 12px;">
                    <div>
                      <span class="muted">Used:</span>
                      <span class="mono">${this.formatBytes(this.diskRoot.used)}</span>
                      <span class="muted">of</span>
                      <span class="mono">${this.formatBytes(this.diskRoot.total)}</span>
                      ${diskPct == null ? nothing : html`<span class="muted">(${diskPct.toFixed(1)}%)</span>`}
                    </div>
                    <div><span class="muted">Free:</span> <span class="mono">${this.formatBytes(this.diskRoot.free)}</span></div>
                  </div>
                `
              : html`<div class="muted" style="margin-top: 12px;">n/a</div>`
          }
        </div>
      </section>

      <section class="card" style="margin-top: 18px;">
        <div class="card-title">GPU</div>
        <div class="card-sub">Best-effort (nvidia-smi if available)</div>
        <div class="mono" style="margin-top: 12px;">${this.gpu?.summary ?? "n/a"}</div>
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
  title: "Machine Health",
  subtitle: "CPU/RAM/disk/GPU (best-effort via node system commands).",
  icon: "monitor",
  render: renderServerResourcesTab,
});

