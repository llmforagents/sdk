import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Workspace } from '../../src/tools/workspace.js';
import { McpTransport } from '../../src/transport/mcp.js';

let workspace: Workspace;
let fetchSpy: ReturnType<typeof vi.fn>;

function mockMcpResponse(text: string): Response {
  return new Response(JSON.stringify({
    result: { content: [{ type: 'text', text }] },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  fetchSpy = vi.fn();
  globalThis.fetch = fetchSpy;
  const mcp = new McpTransport({ mcpUrl: 'https://mcp.test.com/mcp', apiKey: 'key', timeout: 60000 });
  workspace = new Workspace(mcp);
});

afterEach(() => { vi.restoreAllMocks(); });

describe('Workspace', () => {
  it('create calls workspace_create tool', async () => {
    fetchSpy.mockResolvedValueOnce(mockMcpResponse('ws-abc123'));
    const result = await workspace.create();
    expect(result.text).toBe('ws-abc123');
    const body = JSON.parse((fetchSpy.mock.calls[0] as [string, RequestInit])[1].body as string) as Record<string, unknown>;
    expect(body['params']).toEqual({ name: 'workspace_create', arguments: {} });
  });

  it('list calls workspace_list tool with params', async () => {
    fetchSpy.mockResolvedValueOnce(mockMcpResponse('[]'));
    const result = await workspace.list({ prefix: 'reports/', limit: 10 });
    expect(result.text).toBe('[]');
    const body = JSON.parse((fetchSpy.mock.calls[0] as [string, RequestInit])[1].body as string) as Record<string, unknown>;
    expect(body['params']).toEqual({ name: 'workspace_list', arguments: { prefix: 'reports/', limit: 10 } });
  });

  it('list calls workspace_list tool with no params', async () => {
    fetchSpy.mockResolvedValueOnce(mockMcpResponse('[]'));
    await workspace.list();
    const body = JSON.parse((fetchSpy.mock.calls[0] as [string, RequestInit])[1].body as string) as Record<string, unknown>;
    expect(body['params']).toEqual({ name: 'workspace_list', arguments: {} });
  });

  it('upload calls workspace_upload tool', async () => {
    fetchSpy.mockResolvedValueOnce(mockMcpResponse('ok'));
    await workspace.upload({ filename: 'report.pdf', content_base64: 'abc=', days_to_store: 7 });
    const body = JSON.parse((fetchSpy.mock.calls[0] as [string, RequestInit])[1].body as string) as Record<string, unknown>;
    expect(body['params']).toEqual({
      name: 'workspace_upload',
      arguments: { filename: 'report.pdf', content_base64: 'abc=', days_to_store: 7 },
    });
  });

  it('download calls workspace_download tool', async () => {
    fetchSpy.mockResolvedValueOnce(mockMcpResponse('https://cdn.example.com/file'));
    const result = await workspace.download({ filename: 'report.pdf', format: 'url' });
    expect(result.text).toBe('https://cdn.example.com/file');
  });

  it('uploadInit calls workspace_upload_init tool', async () => {
    fetchSpy.mockResolvedValueOnce(mockMcpResponse('upload-id-xyz'));
    await workspace.uploadInit({ filename: 'big.zip', size_bytes: 1024000, days_to_store: 3 });
    const body = JSON.parse((fetchSpy.mock.calls[0] as [string, RequestInit])[1].body as string) as Record<string, unknown>;
    expect(body['params']).toEqual({
      name: 'workspace_upload_init',
      arguments: { filename: 'big.zip', size_bytes: 1024000, days_to_store: 3 },
    });
  });

  it('uploadFinalize calls workspace_upload_finalize tool', async () => {
    fetchSpy.mockResolvedValueOnce(mockMcpResponse('ok'));
    await workspace.uploadFinalize({ upload_id: 'upload-id-xyz' });
    const body = JSON.parse((fetchSpy.mock.calls[0] as [string, RequestInit])[1].body as string) as Record<string, unknown>;
    expect(body['params']).toEqual({ name: 'workspace_upload_finalize', arguments: { upload_id: 'upload-id-xyz' } });
  });

  it('stat calls workspace_stat tool', async () => {
    fetchSpy.mockResolvedValueOnce(mockMcpResponse('{"size":42}'));
    await workspace.stat({ filename: 'report.pdf' });
    const body = JSON.parse((fetchSpy.mock.calls[0] as [string, RequestInit])[1].body as string) as Record<string, unknown>;
    expect(body['params']).toEqual({ name: 'workspace_stat', arguments: { filename: 'report.pdf' } });
  });

  it('delete calls workspace_delete tool', async () => {
    fetchSpy.mockResolvedValueOnce(mockMcpResponse('deleted'));
    await workspace.delete({ filename: 'report.pdf' });
    const body = JSON.parse((fetchSpy.mock.calls[0] as [string, RequestInit])[1].body as string) as Record<string, unknown>;
    expect(body['params']).toEqual({ name: 'workspace_delete', arguments: { filename: 'report.pdf' } });
  });

  it('extend calls workspace_extend tool', async () => {
    fetchSpy.mockResolvedValueOnce(mockMcpResponse('ok'));
    await workspace.extend({ filename: 'report.pdf', additional_days: 14 });
    const body = JSON.parse((fetchSpy.mock.calls[0] as [string, RequestInit])[1].body as string) as Record<string, unknown>;
    expect(body['params']).toEqual({ name: 'workspace_extend', arguments: { filename: 'report.pdf', additional_days: 14 } });
  });

  it('copy calls workspace_copy tool', async () => {
    fetchSpy.mockResolvedValueOnce(mockMcpResponse('ok'));
    await workspace.copy({ source_filename: 'a.pdf', dest_filename: 'b.pdf', days_to_store: 5 });
    const body = JSON.parse((fetchSpy.mock.calls[0] as [string, RequestInit])[1].body as string) as Record<string, unknown>;
    expect(body['params']).toEqual({
      name: 'workspace_copy',
      arguments: { source_filename: 'a.pdf', dest_filename: 'b.pdf', days_to_store: 5 },
    });
  });
});
