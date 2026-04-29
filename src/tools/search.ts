import type { McpTransport } from '../transport/mcp.js';
import type { McpToolResult, GoogleSearchParams, GoogleBatchSearchParams } from './types.js';

export class Search {
  constructor(private readonly mcp: McpTransport) {}

  async google(params: GoogleSearchParams): Promise<McpToolResult> { return this.mcp.callTool('google_search', params); }
  async googleNews(params: GoogleSearchParams): Promise<McpToolResult> { return this.mcp.callTool('google_news', params); }
  async googleMaps(params: GoogleSearchParams): Promise<McpToolResult> { return this.mcp.callTool('google_maps', params); }
  async batchSearch(params: GoogleBatchSearchParams): Promise<McpToolResult> { return this.mcp.callTool('google_batch_search', params); }
}
