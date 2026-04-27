import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ChatCompletions } from '../../src/chat/completions.js';
import { HttpTransport } from '../../src/transport/http.js';

const API_KEY = 'sk-proxy-test-key';
const BASE_URL = 'https://api.test.com';

let chat: ChatCompletions;
let fetchSpy: ReturnType<typeof vi.fn>;

function mockResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'x-request-id': 'req_c' },
  });
}

beforeEach(() => {
  fetchSpy = vi.fn();
  globalThis.fetch = fetchSpy;
  const http = new HttpTransport({ baseUrl: BASE_URL, apiKey: API_KEY, timeout: 5000 });
  chat = new ChatCompletions(http);
});

afterEach(() => { vi.restoreAllMocks(); });

describe('ChatCompletions.create() non-streaming', () => {
  it('posts to /v1/chat/completions and returns ChatResponse', async () => {
    fetchSpy.mockResolvedValueOnce(mockResponse({
      id: 'chatcmpl-1',
      choices: [{ index: 0, message: { role: 'assistant', content: 'Hello!' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
      model: 'anthropic/claude-sonnet-4',
    }));

    const result = await chat.create({
      model: 'anthropic/claude-sonnet-4',
      messages: [{ role: 'user', content: 'Hi' }],
    });

    expect(result.choices[0]?.message.content).toBe('Hello!');
    expect(result.usage.prompt_tokens).toBe(10);
    const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}/v1/chat/completions`);
    const body = JSON.parse(opts.body as string) as Record<string, unknown>;
    expect(body['model']).toBe('anthropic/claude-sonnet-4');
    expect(body['stream']).toBeUndefined();
  });
});

describe('ChatCompletions.create() streaming', () => {
  it('returns async iterable of StreamChunks', async () => {
    const sseData = [
      'data: {"id":"c1","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}\n\n',
      'data: {"id":"c1","choices":[{"index":0,"delta":{"content":"Hi"},"finish_reason":null}]}\n\n',
      'data: {"id":"c1","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":1}}\n\n',
      'data: [DONE]\n\n',
    ].join('');

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(sseData));
        controller.close();
      },
    });

    fetchSpy.mockResolvedValueOnce(new Response(stream, {
      status: 200,
      headers: { 'content-type': 'text/event-stream', 'x-request-id': 'req_s' },
    }));

    const result = await chat.create({
      model: 'anthropic/claude-sonnet-4',
      messages: [{ role: 'user', content: 'Hi' }],
      stream: true,
    });

    const chunks: unknown[] = [];
    for await (const chunk of result) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });
});
