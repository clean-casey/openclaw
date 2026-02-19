import type { OpenClawPluginApi, RespondFn } from "openclaw/plugin-sdk";

type RagClient = {
  baseUrl: string;
  headers: Record<string, string>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function errorInvalid(respond: RespondFn, message: string) {
  respond(false, undefined, { code: "invalid_request", message });
}

function errorUnavailable(respond: RespondFn, message: string) {
  respond(false, undefined, { code: "unavailable", message });
}

async function fetchJsonOrThrow(res: Response): Promise<unknown> {
  const ct = res.headers.get("content-type") ?? "";
  if (!res.ok) {
    const body = ct.includes("application/json") ? await res.json().catch(() => null) : await res.text();
    throw new Error(`RAG API error ${res.status}: ${typeof body === "string" ? body : JSON.stringify(body)}`);
  }
  if (ct.includes("application/json")) {
    return await res.json();
  }
  return await res.text();
}

export default async function register(api: OpenClawPluginApi) {
  const cfg = (api.pluginConfig ?? {}) as Record<string, unknown>;
  const rawBaseUrl = typeof cfg.ragBaseUrl === "string" ? cfg.ragBaseUrl.trim().replace(/\/+$/, "") : "";
  const rawToken = typeof cfg.ragToken === "string" ? cfg.ragToken.trim() : "";
  const defaultTenant = typeof cfg.defaultTenant === "string" ? cfg.defaultTenant.trim() : "";

  if (!rawBaseUrl || !rawToken) {
    api.logger.warn("[rag-docs] ragBaseUrl and ragToken must be set in plugin config; rag.* methods will return errors");
  }

  const client: RagClient = {
    baseUrl: rawBaseUrl,
    headers: {
      Authorization: rawToken.startsWith("Bearer ") ? rawToken : `Bearer ${rawToken}`,
    },
  };

  api.registerGatewayMethod("rag.config", ({ respond }) => {
    respond(true, { defaultTenant: defaultTenant || null, configured: Boolean(rawBaseUrl && rawToken) }, undefined);
  });

  api.registerGatewayMethod("rag.tenants", async ({ respond }) => {
    if (!client.baseUrl) {
      errorUnavailable(respond, "rag-docs plugin not configured (missing ragBaseUrl)");
      return;
    }
    try {
      const res = await fetch(`${client.baseUrl}/tenants`, { headers: client.headers });
      const data = await fetchJsonOrThrow(res);
      respond(true, { tenants: data, defaultTenant: defaultTenant || null }, undefined);
    } catch (err) {
      errorUnavailable(respond, String(err));
    }
  });

  api.registerGatewayMethod("rag.documents.list", async ({ params, respond }) => {
    const tenantId = typeof params.tenantId === "string" ? params.tenantId : "";
    if (!tenantId) {
      errorInvalid(respond, "tenantId (string) required");
      return;
    }
    try {
      const res = await fetch(`${client.baseUrl}/tenants/${encodeURIComponent(tenantId)}/documents`, {
        headers: client.headers,
      });
      const data = await fetchJsonOrThrow(res);
      respond(true, { tenantId, documents: data }, undefined);
    } catch (err) {
      errorUnavailable(respond, String(err));
    }
  });

  api.registerGatewayMethod("rag.search", async ({ params, respond }) => {
    const query = typeof params.query === "string" ? params.query : "";
    const limit = typeof params.limit === "number" ? params.limit : 5;
    const minScore = typeof params.minScore === "number" ? params.minScore : 0;
    const tenants = Array.isArray(params.tenants)
      ? (params.tenants as unknown[]).filter((t): t is string => typeof t === "string")
      : undefined;
    const filters = isRecord(params.filters) ? (params.filters as Record<string, unknown>) : undefined;

    if (!query.trim()) {
      errorInvalid(respond, "query (string) required");
      return;
    }
    try {
      const res = await fetch(`${client.baseUrl}/search`, {
        method: "POST",
        headers: { ...client.headers, "Content-Type": "application/json" },
        body: JSON.stringify({ query, limit, min_score: minScore, tenants, filters }),
      });
      const data = await fetchJsonOrThrow(res);
      respond(true, { result: data }, undefined);
    } catch (err) {
      errorUnavailable(respond, String(err));
    }
  });

  api.registerGatewayMethod("rag.ingest", async ({ params, respond }) => {
    const tenantId = typeof params.tenantId === "string" ? params.tenantId : "";
    const filename = typeof params.filename === "string" ? params.filename : "upload";
    const contentBase64 = typeof params.contentBase64 === "string" ? params.contentBase64 : "";

    if (!tenantId || !contentBase64) {
      errorInvalid(respond, "tenantId (string) and contentBase64 (string) required");
      return;
    }

    const approxBytes = Math.floor((contentBase64.length * 3) / 4);
    if (approxBytes > 25 * 1024 * 1024) {
      errorInvalid(respond, "Upload too large for dashboard transport (limit ~25MB)");
      return;
    }

    try {
      const bytes = Buffer.from(contentBase64, "base64");
      const form = new FormData();
      form.append("file", new Blob([bytes]), filename);
      const res = await fetch(`${client.baseUrl}/tenants/${encodeURIComponent(tenantId)}/ingest`, {
        method: "POST",
        headers: client.headers,
        body: form,
      });
      const data = await fetchJsonOrThrow(res);
      respond(true, { tenantId, result: data }, undefined);
    } catch (err) {
      errorUnavailable(respond, String(err));
    }
  });

  api.registerGatewayMethod("rag.ingest_url", async ({ params, respond }) => {
    const tenantId = typeof params.tenantId === "string" ? params.tenantId : "";
    const url = typeof params.url === "string" ? params.url : "";
    if (!tenantId || !url.trim()) {
      errorInvalid(respond, "tenantId (string) and url (string) required");
      return;
    }
    try {
      const res = await fetch(`${client.baseUrl}/tenants/${encodeURIComponent(tenantId)}/ingest-url`, {
        method: "POST",
        headers: { ...client.headers, "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await fetchJsonOrThrow(res);
      respond(true, { tenantId, result: data }, undefined);
    } catch (err) {
      errorUnavailable(respond, String(err));
    }
  });

  api.registerGatewayMethod("rag.documents.delete", async ({ params, respond }) => {
    const tenantId = typeof params.tenantId === "string" ? params.tenantId : "";
    const docId = typeof params.docId === "string" ? params.docId : "";
    if (!tenantId || !docId) {
      errorInvalid(respond, "tenantId (string) and docId (string) required");
      return;
    }
    try {
      const res = await fetch(
        `${client.baseUrl}/tenants/${encodeURIComponent(tenantId)}/documents/${encodeURIComponent(docId)}`,
        { method: "DELETE", headers: client.headers },
      );
      const data = await fetchJsonOrThrow(res);
      respond(true, { tenantId, docId, result: data }, undefined);
    } catch (err) {
      errorUnavailable(respond, String(err));
    }
  });

  api.logger.info(`[rag-docs] registered rag.* gateway methods (default tenant: ${defaultTenant || "none"})`);
}
