import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Scraper } from '../../src/tools/scraper.js';
import { McpTransport } from '../../src/transport/mcp.js';

let scraper: Scraper;
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
  scraper = new Scraper(mcp);
});

afterEach(() => { vi.restoreAllMocks(); });

describe('Scraper', () => {
  it('fetchHtml calls fetch_html tool', async () => {
    fetchSpy.mockResolvedValueOnce(mockMcpResponse('<html>Hi</html>'));
    const result = await scraper.fetchHtml({ url: 'https://example.com' });
    expect(result.text).toBe('<html>Hi</html>');
    const body = JSON.parse((fetchSpy.mock.calls[0] as [string, RequestInit])[1].body as string) as Record<string, unknown>;
    expect(body['params']).toEqual({ name: 'fetch_html', arguments: { url: 'https://example.com' } });
  });

  it('screenshot calls screenshot tool', async () => {
    fetchSpy.mockResolvedValueOnce(mockMcpResponse('base64data'));
    const result = await scraper.screenshot({ url: 'https://example.com', fullPage: true });
    expect(result.text).toBe('base64data');
  });
});
