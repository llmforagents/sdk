import type { McpTransport } from '../transport/mcp.js';
import type {
  FetchHtmlParams, MarkdownParams, LinksParams, ScreenshotParams,
  PdfParams, ExtractParams, SessionCreateParams, SessionExecParams, SessionParams,
} from './types.js';

export class Scraper {
  constructor(private readonly mcp: McpTransport) {}

  async fetchHtml(params: FetchHtmlParams): Promise<string> { return this.mcp.callTool('fetch_html', params); }
  async markdown(params: MarkdownParams): Promise<string> { return this.mcp.callTool('markdown', params); }
  async links(params: LinksParams): Promise<string> { return this.mcp.callTool('links', params); }
  async screenshot(params: ScreenshotParams): Promise<string> { return this.mcp.callTool('screenshot', params); }
  async pdf(params: PdfParams): Promise<string> { return this.mcp.callTool('pdf', params); }
  async extract(params: ExtractParams): Promise<string> { return this.mcp.callTool('extract', params); }
  async sessionCreate(params: SessionCreateParams): Promise<string> { return this.mcp.callTool('session_create', params); }
  async sessionExec(params: SessionExecParams): Promise<string> { return this.mcp.callTool('session_exec', params); }
  async sessionClose(params: SessionParams): Promise<string> { return this.mcp.callTool('session_close', params); }
  async sessionStatus(params: SessionParams): Promise<string> { return this.mcp.callTool('session_status', params); }
}
