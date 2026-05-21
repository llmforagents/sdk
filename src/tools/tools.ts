import type { McpTransport } from '../transport/mcp.js';
import type { ToolDefinition, McpToolResult } from './types.js';
import { connect as _connect, type McpServerConfig } from './connect.js';
import type { McpServerHandle } from '../transport/mcp-stdio.js';
import { Scraper } from './scraper.js';
import { Search } from './search.js';
import { Image } from './image.js';

export class Tools {
  readonly scraper: Scraper;
  readonly search: Search;
  readonly image: Image;

  private cachedDefinitions: readonly ToolDefinition[] | undefined;
  private readonly servers = new Map<string, McpServerHandle>();

  constructor(private readonly mcp: McpTransport) {
    this.scraper = new Scraper(mcp);
    this.search = new Search(mcp);
    this.image = new Image(mcp);
  }

  get definitions(): readonly ToolDefinition[] | undefined {
    return this.cachedDefinitions;
  }

  async getDefinitions(): Promise<readonly ToolDefinition[]> {
    if (this.cachedDefinitions) {
      return this.cachedDefinitions;
    }

    const mcpTools = await this.mcp.listTools();
    this.cachedDefinitions = mcpTools.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      },
    }));

    return this.cachedDefinitions;
  }

  async call(name: string, args: Readonly<Record<string, unknown>>, signal?: AbortSignal): Promise<McpToolResult> {
    return this.mcp.callTool(name, args, signal);
  }

  /**
   * Connect to an arbitrary MCP server (stdio or HTTP) and register it by name.
   * Throws if a server with the same name is already registered.
   */
  async connect(cfg: McpServerConfig, options?: { connectTimeoutMs?: number }): Promise<McpServerHandle> {
    if (this.servers.has(cfg.name)) {
      throw new Error(`MCP server "${cfg.name}" is already connected. Call disconnect("${cfg.name}") first.`);
    }
    const handle = await _connect(cfg, options);
    this.servers.set(cfg.name, handle);
    return handle;
  }

  /**
   * Disconnect a registered MCP server by name and remove it from the registry.
   * Throws if no server with that name is registered.
   */
  async disconnect(name: string): Promise<void> {
    const handle = this.servers.get(name);
    if (handle === undefined) {
      throw new Error(`No connected MCP server named "${name}".`);
    }
    await handle.disconnect();
    this.servers.delete(name);
  }

  /**
   * Disconnect all registered MCP servers and clear the registry.
   */
  async disconnectAll(): Promise<void> {
    const disconnects = [...this.servers.values()].map((h) => h.disconnect());
    await Promise.all(disconnects);
    this.servers.clear();
  }

  /**
   * Return the names of all currently registered MCP servers.
   */
  connectedServers(): readonly string[] {
    return [...this.servers.keys()];
  }

  /**
   * Call a tool by name.
   *
   * - If `options.server` is provided, dispatches to the named registered MCP server.
   * - Otherwise falls back to the proxy gateway path (existing behaviour).
   *
   * The CompatibilityCallToolResult returned by McpServerHandle.callTool is structurally
   * compatible with McpToolResult (both carry a `content` array), so the cast below is safe.
   */
  async callTool(
    name: string,
    args: Readonly<Record<string, unknown>>,
    options?: { server?: string },
  ): Promise<McpToolResult> {
    if (options?.server !== undefined) {
      const handle = this.servers.get(options.server);
      if (handle === undefined) {
        throw new Error(`No connected MCP server named "${options.server}".`);
      }
      // CompatibilityCallToolResult is a superset of the shape McpToolResult
      // consumers read (content array + optional text). The cast is safe at the
      // structural level; the `text` and `raw` convenience fields are absent from
      // the MCP SDK type but not required by callers of this method that pass
      // `options.server`.
      return handle.callTool(name, args) as unknown as Promise<McpToolResult>;
    }
    // Proxy gateway path — preserves backward compatibility with existing call sites.
    return this.mcp.callTool(name, args);
  }
}
