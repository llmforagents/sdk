import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Image } from '../../src/tools/image.js';
import { McpTransport } from '../../src/transport/mcp.js';

let image: Image;
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
  image = new Image(mcp);
});

afterEach(() => { vi.restoreAllMocks(); });

describe('Image', () => {
  it('generate calls generate_image tool', async () => {
    fetchSpy.mockResolvedValueOnce(mockMcpResponse('https://img.url/result.png'));
    const result = await image.generate({ prompt: 'A robot' });
    expect(result.text).toBe('https://img.url/result.png');
  });

  it('analyze calls analyze_image tool', async () => {
    fetchSpy.mockResolvedValueOnce(mockMcpResponse('This is a cat'));
    const result = await image.analyze({ prompt: 'What is this?', imageUrl: 'https://img.url/cat.png' });
    expect(result.text).toBe('This is a cat');
  });
});
