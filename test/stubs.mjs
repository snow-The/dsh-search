// Host-module stubs for unit tests: the plugin bundles import @deepseek-ai/dsh-tools,
// which only exists inside a running DSH. Tests only need defineTool's identity behaviour.
export function defineTool(def) { return def; }
export default { defineTool };
