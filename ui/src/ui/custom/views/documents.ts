import { LitElement, html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { GatewayBrowserClient } from "../../gateway.ts";
import type { AppViewState } from "../../app-view-state.ts";
import { registerCustomTab } from "../registry.ts";

type RagTenant = { id: string; display_name?: string };
type RagDocument = {
  doc_id: string;
  tenant_id: string;
  filename: string;
  file_type: string;
  sha256: string;
  chunk_count: number;
  status: string;
  created_at: string;
  indexed_at?: string | null;
  error?: string | null;
};
type RagSearchHit = {
  tenant_id: string;
  score: number;
  text: string;
  doc_id: string;
  filename: string;
  file_type: string;
  source_url?: string | null;
  title?: string | null;
  page_number?: number | null;
  chunk_index: number;
};

async function fileToBase64(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.onload = () => {
      const res = String(reader.result ?? "");
      const idx = res.indexOf(",");
      if (!res.startsWith("data:") || idx === -1) {
        reject(new Error("Unexpected FileReader result"));
        return;
      }
      resolve(res.slice(idx + 1));
    };
    reader.readAsDataURL(file);
  });
}

@customElement("openclaw-rag-documents")
class OpenClawRagDocuments extends LitElement {
  @property({ attribute: false }) client: GatewayBrowserClient | null = null;
  @property({ type: Boolean }) connected = false;

  createRenderRoot() {
    return this;
  }

  @state() private loading = false;
  @state() private error: string | null = null;
  @state() private okMsg: string | null = null;

  @state() private tenants: RagTenant[] = [];
  @state() private tenantId: string | null = null;
  @state() private defaultTenant: string | null = null;

  @state() private documents: RagDocument[] = [];

  @state() private searchQuery = "";
  @state() private searchHits: RagSearchHit[] = [];

  @state() private dragOver = false;
  @state() private urlInput = "";

  protected updated(changed: Map<string, unknown>) {
    const shouldInit = (changed.has("connected") || changed.has("client")) && this.connected && this.client;
    if (shouldInit) {
      void this.init();
    }
  }

  private async init() {
    if (!this.client || !this.connected) return;
    this.error = null;
    this.okMsg = null;
    this.loading = true;
    try {
      const cfg = (await this.client.request("rag.config", {})) as {
        defaultTenant?: string | null;
        configured?: boolean;
      };
      this.defaultTenant = cfg?.defaultTenant ?? null;
      if (cfg?.configured === false) {
        this.error = "RAG plugin not configured. Set ragBaseUrl and ragToken in the rag-docs plugin config.";
        this.loading = false;
        return;
      }
      await this.refreshTenants();
    } catch (err) {
      this.error = String(err);
      this.loading = false;
    }
  }

  private async refreshTenants() {
    if (!this.client || !this.connected) return;
    this.loading = true;
    this.error = null;
    this.okMsg = null;
    try {
      const res = (await this.client.request("rag.tenants", {})) as {
        tenants: RagTenant[];
        defaultTenant?: string | null;
      };
      const tenants = Array.isArray(res?.tenants) ? res.tenants : [];
      this.tenants = tenants;

      const dflt = res?.defaultTenant ?? this.defaultTenant;
      const preferred =
        this.tenantId && tenants.some((t) => t.id === this.tenantId)
          ? this.tenantId
          : dflt && tenants.some((t) => t.id === dflt)
            ? dflt
            : tenants[0]?.id ?? null;
      this.tenantId = preferred;
      await this.refreshDocuments();
    } catch (err) {
      this.error = String(err);
    } finally {
      this.loading = false;
    }
  }

  private async refreshDocuments() {
    if (!this.client || !this.connected || !this.tenantId) return;
    this.loading = true;
    this.error = null;
    this.okMsg = null;
    try {
      const res = (await this.client.request("rag.documents.list", {
        tenantId: this.tenantId,
      })) as { documents: RagDocument[] };
      this.documents = Array.isArray(res?.documents) ? res.documents : [];
    } catch (err) {
      this.error = String(err);
    } finally {
      this.loading = false;
    }
  }

  private async runSearch() {
    if (!this.client || !this.connected) return;
    const q = this.searchQuery.trim();
    if (!q) return;
    this.loading = true;
    this.error = null;
    this.okMsg = null;
    try {
      const res = (await this.client.request("rag.search", {
        query: q,
        limit: 5,
        minScore: 0,
      })) as { result?: { hits?: RagSearchHit[] } };
      const hits = (res?.result as { hits?: unknown })?.hits;
      this.searchHits = Array.isArray(hits) ? (hits as RagSearchHit[]) : [];
    } catch (err) {
      this.error = String(err);
    } finally {
      this.loading = false;
    }
  }

  private async ingestFile(file: File) {
    if (!this.client || !this.connected || !this.tenantId) return;
    this.loading = true;
    this.error = null;
    this.okMsg = null;
    try {
      const b64 = await fileToBase64(file);
      await this.client.request("rag.ingest", {
        tenantId: this.tenantId,
        filename: file.name,
        contentBase64: b64,
      });
      this.okMsg = `Uploaded ${file.name}.`;
      await this.refreshDocuments();
    } catch (err) {
      this.error = String(err);
    } finally {
      this.loading = false;
    }
  }

  private async deleteDoc(doc: RagDocument) {
    if (!this.client || !this.connected) return;
    const ok = confirm(`Delete ${doc.filename}? This removes it from the index.`);
    if (!ok) return;
    this.loading = true;
    this.error = null;
    this.okMsg = null;
    try {
      await this.client.request("rag.documents.delete", {
        tenantId: doc.tenant_id,
        docId: doc.doc_id,
      });
      this.okMsg = `Deleted ${doc.filename}.`;
      await this.refreshDocuments();
    } catch (err) {
      this.error = String(err);
    } finally {
      this.loading = false;
    }
  }

  private async ingestUrl(url: string) {
    if (!this.client || !this.connected || !this.tenantId) return;
    const u = (url || "").trim();
    if (!u) return;
    this.loading = true;
    this.error = null;
    this.okMsg = null;
    try {
      await this.client.request("rag.ingest_url", { tenantId: this.tenantId, url: u });
      this.okMsg = "Fetched and indexed URL.";
      this.urlInput = "";
      await this.refreshDocuments();
    } catch (err) {
      this.error = String(err);
    } finally {
      this.loading = false;
    }
  }

  private handleDragOver(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    this.dragOver = true;
  }

  private handleDragLeave(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    this.dragOver = false;
  }

  private async handleDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    this.dragOver = false;
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;
    for (let i = 0; i < files.length; i++) {
      await this.ingestFile(files[i]);
    }
  }

  private renderHeader(): TemplateResult {
    const showTenantSelector = this.tenants.length > 1;
    return html`
      <section class="card">
        <div class="row" style="justify-content: space-between; align-items: flex-start;">
          <div>
            <div class="card-title">Documents</div>
            <div class="card-sub">Tenant-scoped uploads + search. Token scope controlled by gateway config.</div>
          </div>
          <button class="btn" ?disabled=${this.loading || !this.connected} @click=${() => this.init()}>
            ${this.loading ? "Loading…" : "Refresh"}
          </button>
        </div>

        ${showTenantSelector
          ? html`
              <div style="margin-top: 12px; max-width: 320px;">
                <label class="muted">Tenant</label>
                <select
                  class="input"
                  ?disabled=${!this.connected || this.loading}
                  @change=${async (e: Event) => {
                    const v = (e.target as HTMLSelectElement).value;
                    this.tenantId = v || null;
                    await this.refreshDocuments();
                  }}
                >
                  ${this.tenants.map((t) => html`<option value=${t.id} ?selected=${t.id === this.tenantId}>${t.display_name ?? t.id}</option>`)}
                </select>
              </div>
            `
          : this.tenants.length === 1
            ? html`<div class="muted" style="margin-top: 12px;">Tenant: <strong>${this.tenants[0].display_name ?? this.tenants[0].id}</strong></div>`
            : nothing}

        ${this.error ? html`<div class="callout danger" style="margin-top: 12px;">${this.error}</div>` : nothing}
        ${this.okMsg ? html`<div class="callout success" style="margin-top: 12px;">${this.okMsg}</div>` : nothing}
      </section>
    `;
  }

  private renderUpload(): TemplateResult {
    const dropStyle = this.dragOver
      ? "border: 2px dashed var(--accent, #4a9eff); background: rgba(74,158,255,0.08); padding: 24px; border-radius: 8px; text-align: center; margin-top: 12px; transition: all 0.15s;"
      : "border: 2px dashed var(--border, #333); padding: 24px; border-radius: 8px; text-align: center; margin-top: 12px; transition: all 0.15s;";
    return html`
      <section class="card" style="margin-top: 18px;">
        <div class="card-title">Upload</div>
        <div class="card-sub">Drag files here, paste a URL, or use the file picker. Limit ~25 MB per file.</div>
        <div
          style=${dropStyle}
          @dragover=${(e: DragEvent) => this.handleDragOver(e)}
          @dragleave=${(e: DragEvent) => this.handleDragLeave(e)}
          @drop=${(e: DragEvent) => this.handleDrop(e)}
        >
          <div class="muted">${this.dragOver ? "Drop to upload" : "Drag & drop files here"}</div>
          <div class="row" style="gap: 12px; margin-top: 12px; align-items: center;">
            <input
              class="input"
              style="flex: 1;"
              placeholder="https://example.com/page"
              .value=${this.urlInput}
              ?disabled=${!this.connected || this.loading || !this.tenantId}
              @input=${(e: Event) => (this.urlInput = (e.target as HTMLInputElement).value)}
              @keydown=${(e: KeyboardEvent) => {
                if (e.key === "Enter") void this.ingestUrl(this.urlInput);
              }}
            />
            <button
              class="btn"
              ?disabled=${!this.connected || this.loading || !this.tenantId || !this.urlInput.trim()}
              @click=${() => this.ingestUrl(this.urlInput)}
            >
              Fetch URL
            </button>
          </div>
          <div style="margin-top: 10px;">
            <input
              class="input"
              type="file"
              multiple
              ?disabled=${!this.connected || this.loading || !this.tenantId}
              @change=${async (e: Event) => {
                const input = e.target as HTMLInputElement;
                const files = input.files;
                input.value = "";
                if (!files) return;
                for (let i = 0; i < files.length; i++) {
                  await this.ingestFile(files[i]);
                }
              }}
            />
          </div>
        </div>
      </section>
    `;
  }

  private renderDocs(): TemplateResult {
    const docs = this.documents ?? [];
    return html`
      <section class="card" style="margin-top: 18px;">
        <div class="row" style="justify-content: space-between;">
          <div>
            <div class="card-title">Indexed Documents</div>
            <div class="card-sub">${docs.length} item(s) in ${this.tenants.find((t) => t.id === this.tenantId)?.display_name ?? this.tenantId ?? "—"}</div>
          </div>
          <button class="btn" ?disabled=${this.loading || !this.connected || !this.tenantId} @click=${() => this.refreshDocuments()}>
            Reload
          </button>
        </div>

        ${docs.length === 0
          ? html`<div class="muted" style="margin-top: 12px;">No documents in this tenant yet.</div>`
          : html`
              <table class="table" style="margin-top: 12px;">
                <thead>
                  <tr>
                    <th>Filename</th>
                    <th>Status</th>
                    <th>Chunks</th>
                    <th>Created</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  ${docs.map(
                    (d) => html`
                      <tr>
                        <td class="mono">${d.filename}</td>
                        <td>${d.status}${d.error ? html`<div class="muted">${d.error}</div>` : nothing}</td>
                        <td class="mono">${d.chunk_count}</td>
                        <td class="mono">${d.created_at}</td>
                        <td style="text-align: right;">
                          <button class="btn danger" ?disabled=${this.loading || !this.connected} @click=${() => this.deleteDoc(d)}>
                            Delete
                          </button>
                        </td>
                      </tr>
                    `,
                  )}
                </tbody>
              </table>
            `}
      </section>
    `;
  }

  private renderSearch(): TemplateResult {
    return html`
      <section class="card" style="margin-top: 18px;">
        <div class="card-title">Search</div>
        <div class="card-sub">Searches across all tenants allowed by this gateway's RAG token.</div>
        <div class="row" style="gap: 12px; margin-top: 12px;">
          <input
            class="input"
            style="flex: 1;"
            placeholder="Search query"
            .value=${this.searchQuery}
            ?disabled=${!this.connected || this.loading}
            @input=${(e: Event) => (this.searchQuery = (e.target as HTMLInputElement).value)}
            @keydown=${(e: KeyboardEvent) => {
              if (e.key === "Enter") void this.runSearch();
            }}
          />
          <button class="btn" ?disabled=${!this.connected || this.loading || !this.searchQuery.trim()} @click=${() => this.runSearch()}>
            Search
          </button>
        </div>

        ${this.searchHits.length === 0
          ? html`<div class="muted" style="margin-top: 12px;">No results yet.</div>`
          : html`
              <div class="stack" style="margin-top: 12px;">
                ${this.searchHits.map(
                  (h) => html`
                    <div class="callout" style="white-space: normal;">
                      <div class="row" style="justify-content: space-between;">
                        <div class="mono">${h.filename}</div>
                        <div class="mono">${h.tenant_id} · ${(h.score ?? 0).toFixed(3)}</div>
                      </div>
                      ${h.source_url
                        ? html`<div class="muted" style="margin-top: 6px;">
                            Source: <span class="mono">${h.source_url}</span>
                          </div>`
                        : nothing}
                      <div class="muted" style="margin-top: 6px;">${h.text}</div>
                    </div>
                  `,
                )}
              </div>
            `}
      </section>
    `;
  }

  protected render(): TemplateResult {
    return html`
      ${this.renderHeader()}
      ${this.renderUpload()}
      ${this.renderDocs()}
      ${this.renderSearch()}
    `;
  }
}

function renderDocumentsTab(state: AppViewState): TemplateResult {
  return html`<openclaw-rag-documents .client=${state.client} .connected=${state.connected}></openclaw-rag-documents>`;
}

registerCustomTab({
  id: "custom:documents",
  title: "Documents",
  subtitle: "Upload, list, and search tenant-scoped RAG docs.",
  icon: "file-text",
  render: renderDocumentsTab,
});
