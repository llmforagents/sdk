import type { McpTransport } from '../transport/mcp.js';
import type { GoogleSearchParams, GoogleBatchSearchParams } from './types.js';

export class Search {
  constructor(private readonly mcp: McpTransport) {}

  async google(params: GoogleSearchParams): Promise<string> { return this.mcp.callTool('google_search', params); }
  async googleNews(params: GoogleSearchParams): Promise<string> { return this.mcp.callTool('google_news', params); }
  async googleMaps(params: GoogleSearchParams): Promise<string> { return this.mcp.callTool('google_maps', params); }
  async batchSearch(params: GoogleBatchSearchParams): Promise<string> { return this.mcp.callTool('google_batch_search', params); }
}
