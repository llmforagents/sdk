import type { McpTransport } from '../transport/mcp.js';
import type { ImageGenerateParams, ImageEditParams, ImageAnalyzeParams } from './types.js';

export class Image {
  constructor(private readonly mcp: McpTransport) {}

  async generate(params: ImageGenerateParams): Promise<string> { return this.mcp.callTool('generate_image', params); }
  async edit(params: ImageEditParams): Promise<string> { return this.mcp.callTool('edit_image', params); }
  async analyze(params: ImageAnalyzeParams): Promise<string> { return this.mcp.callTool('analyze_image', params); }
}
