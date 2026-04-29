import type { McpTransport } from '../transport/mcp.js';
import type {
  McpToolResult,
  FetchHtmlParams, MarkdownParams, LinksParams, ScreenshotParams,
  PdfParams, ExtractParams, SessionCreateParams, SessionExecParams, SessionParams,
} from './types.js';

export class Scraper {
  constructor(private readonly mcp: McpTransport) {}

  async fetchHtml(params: FetchHtmlParams): Promise<McpToolResult> { return this.mcp.callTool('fetch_html', params); }
  async markdown(params: MarkdownParams): Promise<McpToolResult> { return this.mcp.callTool('markdown', params); }
  async links(params: LinksParams): Promise<McpToolResult> { return this.mcp.callTool('links', params); }
  async screenshot(params: ScreenshotParams): Promise<McpToolResult> { return this.mcp.callTool('screenshot', params); }
  async pdf(params: PdfParams): Promise<McpToolResult> { return this.mcp.callTool('pdf', params); }
  async extract(params: ExtractParams): Promise<McpToolResult> { return this.mcp.callTool('extract', params); }
  async sessionCreate(params: SessionCreateParams): Promise<McpToolResult> { return this.mcp.callTool('session_create', params); }
  async sessionExec(params: SessionExecParams): Promise<McpToolResult> { return this.mcp.callTool('session_exec', params); }
  async sessionClose(params: SessionParams): Promise<McpToolResult> { return this.mcp.callTool('session_close', params); }
  async sessionStatus(params: SessionParams): Promise<McpToolResult> { return this.mcp.callTool('session_status', params); }
}
