import os from "node:os";
import { statfs } from "node:fs/promises";
import { resolveMainSessionKeyFromConfig } from "../../config/sessions.js";
import { getLastHeartbeatEvent } from "../../infra/heartbeat-events.js";
import { setHeartbeatsEnabled } from "../../infra/heartbeat-runner.js";
import { enqueueSystemEvent, isSystemEventContextChanged } from "../../infra/system-events.js";
import { listSystemPresence, updateSystemPresence } from "../../infra/system-presence.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { broadcastPresenceSnapshot } from "../server/presence-events.js";
import type { GatewayRequestHandlers } from "./types.js";

type StatFs = Awaited<ReturnType<typeof statfs>>;

function toNumberMaybe(value: number | bigint): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return null;
  }
  // Guard against huge disks > MAX_SAFE_INTEGER.
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    return null;
  }
  return n;
}

async function getDiskSnapshot(pathname: string): Promise<{
  path: string;
  totalBytes: number | null;
  freeBytes: number | null;
  usedBytes: number | null;
  totalBytesStr: string;
  freeBytesStr: string;
  usedBytesStr: string;
} | null> {
  try {
    const s = (await statfs(pathname)) as StatFs & {
      bsize?: number | bigint;
      blocks?: number | bigint;
      bavail?: number | bigint;
    };
    const bsize = s.bsize ?? 0;
    const blocks = s.blocks ?? 0;
    const bavail = s.bavail ?? 0;

    const bsizeBig = typeof bsize === "bigint" ? bsize : BigInt(Math.max(0, bsize));
    const blocksBig = typeof blocks === "bigint" ? blocks : BigInt(Math.max(0, blocks));
    const bavailBig = typeof bavail === "bigint" ? bavail : BigInt(Math.max(0, bavail));

    const totalBig = bsizeBig * blocksBig;
    const freeBig = bsizeBig * bavailBig;
    const usedBig = totalBig >= freeBig ? totalBig - freeBig : BigInt(0);

    const totalBytes = toNumberMaybe(totalBig);
    const freeBytes = toNumberMaybe(freeBig);
    const usedBytes = toNumberMaybe(usedBig);

    return {
      path: pathname,
      totalBytes,
      freeBytes,
      usedBytes,
      totalBytesStr: totalBig.toString(),
      freeBytesStr: freeBig.toString(),
      usedBytesStr: usedBig.toString(),
    };
  } catch {
    return null;
  }
}

export const systemHandlers: GatewayRequestHandlers = {
  "last-heartbeat": ({ respond }) => {
    respond(true, getLastHeartbeatEvent(), undefined);
  },
  "system.metrics": async ({ respond }) => {
    const total = os.totalmem();
    const free = os.freemem();
    const used = Math.max(0, total - free);
    const load = os.loadavg();
    const cpuCount = os.cpus()?.length ?? null;
    const diskRoot = await getDiskSnapshot("/");
    respond(
      true,
      {
        ts: Date.now(),
        hostname: os.hostname(),
        platform: os.platform(),
        arch: os.arch(),
        uptimeMs: Math.round(process.uptime() * 1000),
        cpu: {
          cores: cpuCount,
          loadavg1: load?.[0] ?? null,
          loadavg5: load?.[1] ?? null,
          loadavg15: load?.[2] ?? null,
        },
        mem: { totalBytes: total, freeBytes: free, usedBytes: used },
        disk: diskRoot,
        process: {
          pid: process.pid,
          rssBytes: process.memoryUsage().rss,
        },
      },
      undefined,
    );
  },
  "set-heartbeats": ({ params, respond }) => {
    const enabled = params.enabled;
    if (typeof enabled !== "boolean") {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "invalid set-heartbeats params: enabled (boolean) required",
        ),
      );
      return;
    }
    setHeartbeatsEnabled(enabled);
    respond(true, { ok: true, enabled }, undefined);
  },
  "system-presence": ({ respond }) => {
    const presence = listSystemPresence();
    respond(true, presence, undefined);
  },
  "system-event": ({ params, respond, context }) => {
    const text = typeof params.text === "string" ? params.text.trim() : "";
    if (!text) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "text required"));
      return;
    }
    const sessionKey = resolveMainSessionKeyFromConfig();
    const deviceId = typeof params.deviceId === "string" ? params.deviceId : undefined;
    const instanceId = typeof params.instanceId === "string" ? params.instanceId : undefined;
    const host = typeof params.host === "string" ? params.host : undefined;
    const ip = typeof params.ip === "string" ? params.ip : undefined;
    const mode = typeof params.mode === "string" ? params.mode : undefined;
    const version = typeof params.version === "string" ? params.version : undefined;
    const platform = typeof params.platform === "string" ? params.platform : undefined;
    const deviceFamily = typeof params.deviceFamily === "string" ? params.deviceFamily : undefined;
    const modelIdentifier =
      typeof params.modelIdentifier === "string" ? params.modelIdentifier : undefined;
    const lastInputSeconds =
      typeof params.lastInputSeconds === "number" && Number.isFinite(params.lastInputSeconds)
        ? params.lastInputSeconds
        : undefined;
    const reason = typeof params.reason === "string" ? params.reason : undefined;
    const roles =
      Array.isArray(params.roles) && params.roles.every((t) => typeof t === "string")
        ? params.roles
        : undefined;
    const scopes =
      Array.isArray(params.scopes) && params.scopes.every((t) => typeof t === "string")
        ? params.scopes
        : undefined;
    const tags =
      Array.isArray(params.tags) && params.tags.every((t) => typeof t === "string")
        ? params.tags
        : undefined;
    const presenceUpdate = updateSystemPresence({
      text,
      deviceId,
      instanceId,
      host,
      ip,
      mode,
      version,
      platform,
      deviceFamily,
      modelIdentifier,
      lastInputSeconds,
      reason,
      roles,
      scopes,
      tags,
    });
    const isNodePresenceLine = text.startsWith("Node:");
    if (isNodePresenceLine) {
      const next = presenceUpdate.next;
      const changed = new Set(presenceUpdate.changedKeys);
      const reasonValue = next.reason ?? reason;
      const normalizedReason = (reasonValue ?? "").toLowerCase();
      const ignoreReason =
        normalizedReason.startsWith("periodic") || normalizedReason === "heartbeat";
      const hostChanged = changed.has("host");
      const ipChanged = changed.has("ip");
      const versionChanged = changed.has("version");
      const modeChanged = changed.has("mode");
      const reasonChanged = changed.has("reason") && !ignoreReason;
      const hasChanges = hostChanged || ipChanged || versionChanged || modeChanged || reasonChanged;
      if (hasChanges) {
        const contextChanged = isSystemEventContextChanged(sessionKey, presenceUpdate.key);
        const parts: string[] = [];
        if (contextChanged || hostChanged || ipChanged) {
          const hostLabel = next.host?.trim() || "Unknown";
          const ipLabel = next.ip?.trim();
          parts.push(`Node: ${hostLabel}${ipLabel ? ` (${ipLabel})` : ""}`);
        }
        if (versionChanged) {
          parts.push(`app ${next.version?.trim() || "unknown"}`);
        }
        if (modeChanged) {
          parts.push(`mode ${next.mode?.trim() || "unknown"}`);
        }
        if (reasonChanged) {
          parts.push(`reason ${reasonValue?.trim() || "event"}`);
        }
        const deltaText = parts.join(" · ");
        if (deltaText) {
          enqueueSystemEvent(deltaText, {
            sessionKey,
            contextKey: presenceUpdate.key,
          });
        }
      }
    } else {
      enqueueSystemEvent(text, { sessionKey });
    }
    broadcastPresenceSnapshot({
      broadcast: context.broadcast,
      incrementPresenceVersion: context.incrementPresenceVersion,
      getHealthVersion: context.getHealthVersion,
    });
    respond(true, { ok: true }, undefined);
  },
};
