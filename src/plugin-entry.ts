/**
 * @fileoverview Plugin entry point for OpenCode runtime. Conforms to OpenCode's
 * plugin module signature with default export { id, server }.
 */

import { ragPlugin } from "./plugin.js";

/** Unique identifier for the OpenCodeRAG plugin. */
export const id = "opencode-rag-plugin";

/** Plugin server hooks — the ragPlugin factory registered with OpenCode's plugin system. */
export const server = ragPlugin;

/**
 * Default export conforming to OpenCode's plugin module signature.
 * OpenCode discovers plugins by importing this default export.
 */
export default { id: "opencode-rag-plugin", server: ragPlugin };
