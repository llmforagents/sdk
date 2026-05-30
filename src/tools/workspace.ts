import type { McpTransport } from '../transport/mcp.js';
import type {
  McpToolResult,
  WorkspaceListParams,
  WorkspaceFileParams,
  WorkspaceUploadParams,
  WorkspaceUploadInitParams,
  WorkspaceUploadFinalizeParams,
  WorkspaceDownloadParams,
  WorkspaceExtendParams,
  WorkspaceCopyParams,
} from './types.js';

export class Workspace {
  constructor(private readonly mcp: McpTransport) {}

  async create(): Promise<McpToolResult> { return this.mcp.callTool('workspace_create', {}); }
  async list(params: WorkspaceListParams = {}): Promise<McpToolResult> { return this.mcp.callTool('workspace_list', params); }
  async stat(params: WorkspaceFileParams): Promise<McpToolResult> { return this.mcp.callTool('workspace_stat', params); }
  async delete(params: WorkspaceFileParams): Promise<McpToolResult> { return this.mcp.callTool('workspace_delete', params); }
  async upload(params: WorkspaceUploadParams): Promise<McpToolResult> { return this.mcp.callTool('workspace_upload', params); }
  async uploadInit(params: WorkspaceUploadInitParams): Promise<McpToolResult> { return this.mcp.callTool('workspace_upload_init', params); }
  async uploadFinalize(params: WorkspaceUploadFinalizeParams): Promise<McpToolResult> { return this.mcp.callTool('workspace_upload_finalize', params); }
  async download(params: WorkspaceDownloadParams): Promise<McpToolResult> { return this.mcp.callTool('workspace_download', params); }
  async extend(params: WorkspaceExtendParams): Promise<McpToolResult> { return this.mcp.callTool('workspace_extend', params); }
  async copy(params: WorkspaceCopyParams): Promise<McpToolResult> { return this.mcp.callTool('workspace_copy', params); }
}
