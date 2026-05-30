import type { McpTransport } from '../transport/mcp.js';
import type { ToolDefinition, McpToolResult } from './types.js';
import { connect as _connect, type McpServerConfig } from './connect.js';
import type { McpServerHandle } from '../transport/mcp-stdio.js';
import { Scraper } from './scraper.js';
import { Search } from './search.js';
import { Image } from './image.js';
import { Workspace } from './workspace.js';

export class Tools {
  readonly scraper: Scraper;
  readonly search: Search;
  readonly image: Image;
  readonly workspace: Workspace;

  private cachedDefinitions: readonly ToolDefinition[] | undefined;
  private readonly servers = new Map<string, McpServerHandle>();

  constructor(private readonly mcp: McpTransport) {
    this.scraper = new Scraper(mcp);
    this.search = new Search(mcp);
    this.image = new Image(mcp);
    this.workspace = new Workspace(mcp);
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
   *
   * The SDK does NOT auto-reconnect when a stdio server's child process dies —
   * the transport's `onclose` fires and the handle becomes unusable. Subsequent
   * `callTool` calls will reject. Callers detecting this must call
   * `client.tools.connect(cfg)` again with the original config to rebuild.
   *
   * Rationale: auto-reconnect with state replay (e.g. restoring tool registrations
   * or session state) is non-trivial and the official SDK doesn't provide
   * primitives for it. Leaving recovery to the caller keeps the abstraction
   * predictable.
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
   *
   * Best-effort: every handle's `disconnect()` is dispatched even if some
   * fail. Errors are collected and re-raised as an `AggregateError` AFTER
   * all disconnects have settled, so a single broken handle can't leak the
   * rest of the registry — each underlying child process / HTTP transport
   * still gets the close signal. The registry is cleared in all cases.
   */
  async disconnectAll(): Promise<void> {
    const settled = await Promise.allSettled(
      [...this.servers.values()].map((h) => h.disconnect()),
    );
    this.servers.clear();
    const errors = settled
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map((r) => (r.reason instanceof Error ? r.reason : new Error(String(r.reason))));
    if (errors.length > 0) {
      // Compose a single Error whose message includes all failure reasons; the
      // underlying errors are attached as a `causes` property for inspection.
      // (We avoid `AggregateError` directly because it requires ES2021 lib.)
      const msg = `disconnectAll: ${errors.length} handle(s) failed to disconnect: ${errors.map((e) => e.message).join('; ')}`;
      const aggregate = new Error(msg);
      (aggregate as Error & { causes: readonly Error[] }).causes = errors;
      throw aggregate;
    }
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
