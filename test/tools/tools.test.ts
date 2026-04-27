import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Tools } from '../../src/tools/tools.js';
import { McpTransport } from '../../src/transport/mcp.js';

let tools: Tools;
let fetchSpy: ReturnType<typeof vi.fn>;

const MOCK_TOOLS_LIST = {
  result: {
    tools: [
      { name: 'google_search', description: 'Search Google', inputSchema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] } },
      { name: 'fetch_html', description: 'Fetch HTML', inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } },
    ],
  },
};

beforeEach(() => {
  fetchSpy = vi.fn();
  globalThis.fetch = fetchSpy;
  const mcp = new McpTransport({ mcpUrl: 'https://mcp.test.com/mcp', apiKey: 'key', timeout: 60000 });
  tools = new Tools(mcp);
});

afterEach(() => { vi.restoreAllMocks(); });

describe('Tools.definitions', () => {
  it('returns tool definitions in OpenAI function calling format', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify(MOCK_TOOLS_LIST), { status: 200, headers: { 'content-type': 'application/json' } }));
    const defs = await tools.getDefinitions();
    expect(defs).toHaveLength(2);
    expect(defs[0]?.type).toBe('function');
    expect(defs[0]?.function.name).toBe('google_search');
    expect(defs[0]?.function.description).toBe('Search Google');
    expect(defs[0]?.function.parameters).toEqual({ type: 'object', properties: { q: { type: 'string' } }, required: ['q'] });
  });

  it('caches definitions', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify(MOCK_TOOLS_LIST), { status: 200, headers: { 'content-type': 'application/json' } }));
    await tools.getDefinitions();
    await tools.getDefinitions();
    expect(fetchSpy).toHaveBeenCalledOnce();
  });
});

describe('Tools.call()', () => {
  it('calls a tool by name', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({
      result: { content: [{ type: 'text', text: 'result' }] },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const result = await tools.call('google_search', { q: 'test' });
    expect(result).toBe('result');
  });
});

describe('Tools sub-modules', () => {
  it('exposes scraper, search, image sub-modules', () => {
    expect(tools.scraper).toBeDefined();
    expect(tools.search).toBeDefined();
    expect(tools.image).toBeDefined();
  });
});
