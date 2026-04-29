import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { McpTransport } from '../../src/transport/mcp.js';
import { LLM4AgentsError } from '../../src/errors.js';

const API_KEY = 'sk-proxy-test-key';
const MCP_URL = 'https://mcp.test.com/mcp';

let transport: McpTransport;
let fetchSpy: ReturnType<typeof vi.fn>;

const MOCK_TOOLS_RESPONSE = {
  result: {
    tools: [
      {
        name: 'google_search',
        description: 'Search Google',
        inputSchema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
      },
      {
        name: 'fetch_html',
        description: 'Fetch HTML from URL',
        inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
      },
    ],
  },
};

const MOCK_CALL_RESPONSE = {
  result: {
    content: [
      { type: 'text', text: '<html>Hello</html>' },
    ],
  },
};

function mockResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  fetchSpy = vi.fn();
  globalThis.fetch = fetchSpy;
  transport = new McpTransport({ mcpUrl: MCP_URL, apiKey: API_KEY, timeout: 60000 });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('McpTransport.listTools()', () => {
  it('fetches tools from MCP endpoint', async () => {
    fetchSpy.mockResolvedValueOnce(mockResponse(MOCK_TOOLS_RESPONSE));

    const tools = await transport.listTools();

    expect(tools).toHaveLength(2);
    expect(tools[0]?.name).toBe('google_search');
    expect(tools[1]?.name).toBe('fetch_html');

    const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(MCP_URL);
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body as string) as Record<string, unknown>;
    expect(body['jsonrpc']).toBe('2.0');
    expect(body['id']).toBe(1);
    expect(body['method']).toBe('tools/list');
  });

  it('caches tools after first call', async () => {
    fetchSpy.mockResolvedValueOnce(mockResponse(MOCK_TOOLS_RESPONSE));

    await transport.listTools();
    await transport.listTools();

    expect(fetchSpy).toHaveBeenCalledOnce();
  });
});

describe('McpTransport.callTool()', () => {
  it('calls a tool and returns text content', async () => {
    fetchSpy.mockResolvedValueOnce(mockResponse(MOCK_CALL_RESPONSE));

    const result = await transport.callTool('fetch_html', { url: 'https://example.com' });

    expect(result.text).toBe('<html>Hello</html>');
    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toEqual({ type: 'text', text: '<html>Hello</html>' });

    const [, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(opts.body as string) as Record<string, unknown>;
    expect(body['method']).toBe('tools/call');
    expect(body['params']).toEqual({ name: 'fetch_html', arguments: { url: 'https://example.com' } });
  });

  it('throws tool_execution_error when MCP returns isError', async () => {
    fetchSpy.mockResolvedValueOnce(mockResponse({
      result: {
        isError: true,
        content: [{ type: 'text', text: 'Tool failed: timeout' }],
      },
    }));

    try {
      await transport.callTool('fetch_html', { url: 'https://slow.com' });
      expect.unreachable('should have thrown');
    } catch (err) {
      const e = err as LLM4AgentsError;
      expect(e.code).toBe('tool_execution_error');
      expect(e.message).toBe('Tool failed: timeout');
    }
  });

  it('throws auth_error on 401', async () => {
    fetchSpy.mockResolvedValueOnce(mockResponse({ error: 'Unauthorized' }, 401));

    await expect(transport.callTool('fetch_html', { url: '...' }))
      .rejects.toThrow(LLM4AgentsError);
  });

  it('returns empty string when content array is empty', async () => {
    fetchSpy.mockResolvedValueOnce(mockResponse({
      result: { content: [] },
    }));

    const result = await transport.callTool('fetch_html', { url: '...' });
    expect(result.text).toBe('');
    expect(result.content).toHaveLength(0);
  });

  it('increments JSON-RPC id on each call', async () => {
    fetchSpy.mockResolvedValueOnce(mockResponse(MOCK_CALL_RESPONSE));
    fetchSpy.mockResolvedValueOnce(mockResponse(MOCK_CALL_RESPONSE));

    await transport.callTool('fetch_html', { url: '1' });
    await transport.callTool('fetch_html', { url: '2' });

    const body1 = JSON.parse((fetchSpy.mock.calls[0] as [string, RequestInit])[1].body as string) as Record<string, unknown>;
    const body2 = JSON.parse((fetchSpy.mock.calls[1] as [string, RequestInit])[1].body as string) as Record<string, unknown>;
    expect(body1['id']).toBe(1);
    expect(body2['id']).toBe(2);
  });
});
