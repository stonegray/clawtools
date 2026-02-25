/**
 * plugin-loader-poc.ts
 *
 * Proof-of-concept: Load an OpenClaw-compatible plugin from a directory,
 * call its register function, and collect registered tools/hooks.
 *
 * This PoC creates a temporary plugin on disk, loads it with jiti,
 * and exercises the registration API.
 *
 * Run: bun respec/example/plugin-loader-poc.ts
 *   or: npx tsx respec/example/plugin-loader-poc.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ── Plugin manifest type ────────────────────────────────────────────

interface PluginManifest {
  id: string;
  name?: string;
  description?: string;
  version?: string;
  main?: string;
  configSchema?: {
    type: "object";
    properties: Record<string, unknown>;
  };
}

// ── Plugin registry ─────────────────────────────────────────────────

interface PluginToolRegistration {
  pluginId: string;
  name: string;
  tool: any;
}

interface PluginHookRegistration {
  pluginId: string;
  event: string;
  handler: Function;
  priority?: number;
}

interface PluginCommandRegistration {
  pluginId: string;
  name: string;
  description: string;
  handler: Function;
}

interface PluginRecord {
  id: string;
  name: string;
  version?: string;
  source: string;
  status: "loaded" | "error";
  error?: string;
  toolNames: string[];
  hookNames: string[];
  commands: string[];
}

interface PluginRegistry {
  plugins: PluginRecord[];
  tools: PluginToolRegistration[];
  hooks: PluginHookRegistration[];
  commands: PluginCommandRegistration[];
}

function createPluginRegistry(): PluginRegistry {
  return { plugins: [], tools: [], hooks: [], commands: [] };
}

// ── Plugin API builder ──────────────────────────────────────────────

interface PluginApi {
  id: string;
  name: string;
  version?: string;
  registerTool: (tool: any, opts?: { name?: string }) => void;
  registerHook: (event: string | string[], handler: Function, opts?: { priority?: number }) => void;
  registerCommand: (command: { name: string; description: string; handler: Function }) => void;
  on: (hookName: string, handler: Function, opts?: { priority?: number }) => void;
}

function buildPluginApi(
  manifest: PluginManifest,
  registry: PluginRegistry,
  record: PluginRecord,
): PluginApi {
  return {
    id: manifest.id,
    name: manifest.name ?? manifest.id,
    version: manifest.version,

    registerTool(tool, opts) {
      const name = opts?.name ?? tool.name;
      registry.tools.push({ pluginId: manifest.id, name, tool });
      record.toolNames.push(name);
      console.log(`    [${manifest.id}] Registered tool: ${name}`);
    },

    registerHook(events, handler, opts) {
      const eventList = Array.isArray(events) ? events : [events];
      for (const event of eventList) {
        registry.hooks.push({
          pluginId: manifest.id,
          event,
          handler,
          priority: opts?.priority,
        });
        record.hookNames.push(event);
        console.log(`    [${manifest.id}] Registered hook: ${event}`);
      }
    },

    registerCommand(command) {
      registry.commands.push({
        pluginId: manifest.id,
        name: command.name,
        description: command.description,
        handler: command.handler,
      });
      record.commands.push(command.name);
      console.log(`    [${manifest.id}] Registered command: ${command.name}`);
    },

    on(hookName, handler, opts) {
      this.registerHook(hookName, handler, opts);
    },
  };
}

// ── Plugin loader ───────────────────────────────────────────────────

async function loadPlugin(
  pluginDir: string,
  registry: PluginRegistry,
): Promise<PluginRecord> {
  const manifestPath = path.join(pluginDir, "openclaw.plugin.json");

  // 1. Read manifest
  if (!fs.existsSync(manifestPath)) {
    const record: PluginRecord = {
      id: "unknown",
      name: "unknown",
      source: pluginDir,
      status: "error",
      error: "Missing openclaw.plugin.json",
      toolNames: [],
      hookNames: [],
      commands: [],
    };
    registry.plugins.push(record);
    return record;
  }

  const manifest: PluginManifest = JSON.parse(
    fs.readFileSync(manifestPath, "utf-8"),
  );

  const record: PluginRecord = {
    id: manifest.id,
    name: manifest.name ?? manifest.id,
    version: manifest.version,
    source: pluginDir,
    status: "loaded",
    toolNames: [],
    hookNames: [],
    commands: [],
  };

  // 2. Resolve entry point
  const entryFile =
    manifest.main ??
    (fs.existsSync(path.join(pluginDir, "index.ts"))
      ? "index.ts"
      : "index.js");
  const entryPath = path.join(pluginDir, entryFile);

  if (!fs.existsSync(entryPath)) {
    record.status = "error";
    record.error = `Entry file not found: ${entryFile}`;
    registry.plugins.push(record);
    return record;
  }

  // 3. Load module
  let mod: any;
  try {
    // Try jiti first (for .ts files)
    const { createJiti } = await import("jiti");
    const jiti = createJiti(import.meta.url, { interopDefault: true });
    mod = await jiti.import(entryPath);
  } catch {
    // Fallback to native import (for .js/.mjs files)
    try {
      mod = await import(entryPath);
    } catch (err: any) {
      record.status = "error";
      record.error = `Failed to load: ${err.message}`;
      registry.plugins.push(record);
      return record;
    }
  }

  // 4. Resolve register function
  const registerFn: Function | undefined =
    typeof mod === "function"
      ? mod
      : typeof mod.default === "function"
        ? mod.default
        : mod.register ?? mod.activate ?? mod.default?.register ?? mod.default?.activate;

  if (typeof registerFn !== "function") {
    record.status = "error";
    record.error = "No register/activate function exported";
    registry.plugins.push(record);
    return record;
  }

  // 5. Build API and call register
  const api = buildPluginApi(manifest, registry, record);
  try {
    await registerFn(api);
  } catch (err: any) {
    record.status = "error";
    record.error = `register() failed: ${err.message}`;
  }

  registry.plugins.push(record);
  return record;
}

// ── Create sample plugins on disk ───────────────────────────────────

function createSamplePlugin(
  baseDir: string,
  id: string,
  code: string,
  manifest: Partial<PluginManifest> = {},
): string {
  const pluginDir = path.join(baseDir, id);
  fs.mkdirSync(pluginDir, { recursive: true });

  const fullManifest: PluginManifest = {
    id,
    name: manifest.name ?? `Sample ${id}`,
    version: manifest.version ?? "1.0.0",
    ...manifest,
  };

  fs.writeFileSync(
    path.join(pluginDir, "openclaw.plugin.json"),
    JSON.stringify(fullManifest, null, 2),
  );

  fs.writeFileSync(path.join(pluginDir, "index.js"), code);

  return pluginDir;
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  console.log("=== OpenClaw Plugin Loader PoC ===\n");

  // Create temp directory for sample plugins
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-poc-"));
  console.log(`Temp dir: ${tmpDir}\n`);

  try {
    // Plugin 1: Simple tool registration
    const plugin1Dir = createSamplePlugin(
      tmpDir,
      "hello-tool",
      `
module.exports = function register(api) {
  api.registerTool({
    name: "hello",
    label: "Hello World",
    description: "A simple hello world tool.",
    parameters: { type: "object", properties: { name: { type: "string" } } },
    execute: async (id, args) => ({
      content: [{ type: "text", text: "Hello, " + (args.name || "world") + "!" }],
    }),
  });

  api.registerHook("agent_end", async (event) => {
    // Post-processing hook
  });
};
`,
    );

    // Plugin 2: Multiple registrations
    const plugin2Dir = createSamplePlugin(
      tmpDir,
      "multi-plugin",
      `
module.exports = {
  register(api) {
    // Register multiple tools
    api.registerTool({
      name: "echo",
      label: "Echo",
      description: "Echo back the input.",
      parameters: { type: "object", properties: { text: { type: "string" } } },
      execute: async (id, args) => ({
        content: [{ type: "text", text: String(args.text) }],
      }),
    });

    api.registerTool({
      name: "timestamp",
      label: "Timestamp",
      description: "Return current timestamp.",
      parameters: { type: "object", properties: {} },
      execute: async () => ({
        content: [{ type: "text", text: String(Date.now()) }],
      }),
    });

    // Register a hook
    api.on("before_tool_call", async (event) => {
      console.log("      [multi-plugin] before_tool_call:", event.toolName);
    }, { priority: 10 });

    // Register a command
    api.registerCommand({
      name: "ping",
      description: "Respond with pong.",
      handler: async () => ({ text: "pong!" }),
    });
  }
};
`,
      { name: "Multi Plugin", version: "2.0.0" },
    );

    // Plugin 3: Bad plugin (missing register)
    const plugin3Dir = createSamplePlugin(
      tmpDir,
      "broken-plugin",
      `module.exports = { notARegisterFunction: true };`,
    );

    // Load all plugins
    const registry = createPluginRegistry();

    console.log("Loading plugins...\n");

    for (const dir of [plugin1Dir, plugin2Dir, plugin3Dir]) {
      const pluginName = path.basename(dir);
      console.log(`  Loading: ${pluginName}`);
      const record = await loadPlugin(dir, registry);
      if (record.status === "error") {
        console.log(`    ❌ Error: ${record.error}`);
      } else {
        console.log(`    ✅ Loaded successfully`);
      }
      console.log();
    }

    // Registry summary
    console.log("── Registry Summary ──");
    console.log(`  Plugins: ${registry.plugins.length} (${registry.plugins.filter((p) => p.status === "loaded").length} loaded, ${registry.plugins.filter((p) => p.status === "error").length} errored)`);
    console.log(`  Tools: ${registry.tools.length} [${registry.tools.map((t) => t.name).join(", ")}]`);
    console.log(`  Hooks: ${registry.hooks.length} [${registry.hooks.map((h) => h.event).join(", ")}]`);
    console.log(`  Commands: ${registry.commands.length} [${registry.commands.map((c) => c.name).join(", ")}]`);

    // Test tool execution
    console.log("\n── Tool Execution Test ──");
    for (const reg of registry.tools) {
      const result = await reg.tool.execute(`test_${Date.now()}`, { name: "OpenClaw", text: "hello" });
      const text = result.content.map((c: any) => c.text).join("");
      console.log(`  ${reg.name}("...") → ${text}`);
    }

    // Test hook dispatch
    console.log("\n── Hook Dispatch Test ──");
    const beforeToolHooks = registry.hooks
      .filter((h) => h.event === "before_tool_call")
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

    for (const hook of beforeToolHooks) {
      await hook.handler({ toolName: "read", params: { file_path: "test.txt" } });
    }
    if (beforeToolHooks.length === 0) {
      console.log("  (no before_tool_call hooks registered)");
    }

    // Plugin records
    console.log("\n── Plugin Records ──");
    for (const plugin of registry.plugins) {
      console.log(`  ${plugin.id}:`);
      console.log(`    Status: ${plugin.status}`);
      console.log(`    Version: ${plugin.version ?? "unknown"}`);
      console.log(`    Tools: [${plugin.toolNames.join(", ")}]`);
      console.log(`    Hooks: [${plugin.hookNames.join(", ")}]`);
      console.log(`    Commands: [${plugin.commands.join(", ")}]`);
      if (plugin.error) console.log(`    Error: ${plugin.error}`);
    }
  } finally {
    // Cleanup
    fs.rmSync(tmpDir, { recursive: true, force: true });
    console.log(`\nCleaned up temp dir: ${tmpDir}`);
  }

  console.log("\n=== Done ===");
}

main().catch(console.error);
