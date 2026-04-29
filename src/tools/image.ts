import type { McpTransport } from '../transport/mcp.js';
import type { McpToolResult, ImageGenerateParams, ImageEditParams, ImageAnalyzeParams } from './types.js';

export class Image {
  constructor(private readonly mcp: McpTransport) {}

  async generate(params: ImageGenerateParams): Promise<McpToolResult> { return this.mcp.callTool('generate_image', params); }
  async edit(params: ImageEditParams): Promise<McpToolResult> { return this.mcp.callTool('edit_image', params); }
  async analyze(params: ImageAnalyzeParams): Promise<McpToolResult> { return this.mcp.callTool('analyze_image', params); }
}
