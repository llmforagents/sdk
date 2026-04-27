import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Search } from '../../src/tools/search.js';
import { McpTransport } from '../../src/transport/mcp.js';

let search: Search;
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
  search = new Search(mcp);
});

afterEach(() => { vi.restoreAllMocks(); });

describe('Search', () => {
  it('google calls google_search tool', async () => {
    fetchSpy.mockResolvedValueOnce(mockMcpResponse('{"results":[]}'));
    const result = await search.google({ q: 'test query' });
    expect(result).toBe('{"results":[]}');
    const body = JSON.parse((fetchSpy.mock.calls[0] as [string, RequestInit])[1].body as string) as Record<string, unknown>;
    expect(body['params']).toEqual({ name: 'google_search', arguments: { q: 'test query' } });
  });

  it('googleNews calls google_news tool', async () => {
    fetchSpy.mockResolvedValueOnce(mockMcpResponse('news'));
    await search.googleNews({ q: 'Bitcoin', tbs: 'qdr:d' });
    const body = JSON.parse((fetchSpy.mock.calls[0] as [string, RequestInit])[1].body as string) as Record<string, unknown>;
    expect(body['params']).toEqual({ name: 'google_news', arguments: { q: 'Bitcoin', tbs: 'qdr:d' } });
  });

  it('batchSearch calls google_batch_search tool', async () => {
    fetchSpy.mockResolvedValueOnce(mockMcpResponse('{"results":[]}'));
    await search.batchSearch({ queries: ['query1', 'query2'] });
    const body = JSON.parse((fetchSpy.mock.calls[0] as [string, RequestInit])[1].body as string) as Record<string, unknown>;
    expect(body['params']).toEqual({ name: 'google_batch_search', arguments: { queries: ['query1', 'query2'] } });
  });
});
