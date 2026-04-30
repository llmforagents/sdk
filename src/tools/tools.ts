import type { McpTransport } from '../transport/mcp.js';
import type { ToolDefinition, McpToolResult } from './types.js';
import { Scraper } from './scraper.js';
import { Search } from './search.js';
import { Image } from './image.js';

export class Tools {
  readonly scraper: Scraper;
  readonly search: Search;
  readonly image: Image;

  private cachedDefinitions: readonly ToolDefinition[] | undefined;

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
}
