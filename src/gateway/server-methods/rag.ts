import { ErrorCodes, errorShape } from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";

// Stub handlers -- the real implementation lives in the rag-docs plugin.
// These exist only so the method names are recognized by the gateway's
// authorization layer. When the plugin is loaded its handlers take precedence
// via the plugin registry's extraHandlers merge.

export const ragHandlers: GatewayRequestHandlers = {};
