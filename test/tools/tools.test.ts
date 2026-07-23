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
    expect(result.text).toBe('result');
  });
});

describe('Tools.textToSpeech()', () => {
  it('delegates to mcp.callTool with the text_to_speech tool name', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({
      result: { content: [{ type: 'text', text: 'audio://workspace/speech.mp3' }] },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    const result = await tools.textToSpeech({ text: 'Hola mundo', voice: 'sal', format: 'mp3' });

    expect(result.text).toBe('audio://workspace/speech.mp3');
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(opts.body as string) as { params: { name: string; arguments: unknown } };
    expect(body.params.name).toBe('text_to_speech');
    expect(body.params.arguments).toEqual({ text: 'Hola mundo', voice: 'sal', format: 'mp3' });
  });
});

describe('Tools.generateVideo()', () => {
  it('delegates to mcp.callTool with the generate_video tool name', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({
      result: { content: [{ type: 'text', text: '{"id":"job_1","status":"pending"}' }] },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    const result = await tools.generateVideo({ prompt: 'A cat riding a skateboard', model: 'x-ai/grok-imagine-video-1.5' });

    expect(result.text).toBe('{"id":"job_1","status":"pending"}');
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(opts.body as string) as { params: { name: string; arguments: unknown } };
    expect(body.params.name).toBe('generate_video');
    expect(body.params.arguments).toEqual({ prompt: 'A cat riding a skateboard', model: 'x-ai/grok-imagine-video-1.5' });
  });
});

describe('Tools.videoStatus()', () => {
  it('delegates to mcp.callTool with the video_status tool name and job_id argument', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({
      result: { content: [{ type: 'text', text: '{"id":"job_1","status":"completed"}' }] },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    const result = await tools.videoStatus('job_1');

    expect(result.text).toBe('{"id":"job_1","status":"completed"}');
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(opts.body as string) as { params: { name: string; arguments: unknown } };
    expect(body.params.name).toBe('video_status');
    expect(body.params.arguments).toEqual({ job_id: 'job_1' });
  });
});

describe('Tools sub-modules', () => {
  it('exposes scraper, search, image sub-modules', () => {
    expect(tools.scraper).toBeDefined();
    expect(tools.search).toBeDefined();
    expect(tools.image).toBeDefined();
  });
});
