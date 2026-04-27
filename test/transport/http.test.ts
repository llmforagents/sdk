import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HttpTransport } from '../../src/transport/http.js';
import { LLM4AgentsError } from '../../src/errors.js';

const API_KEY = 'sk-proxy-test-key';
const BASE_URL = 'https://api.test.com';

let transport: HttpTransport;
let fetchSpy: ReturnType<typeof vi.fn>;

function mockResponse(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'x-request-id': 'req_mock',
      ...headers,
    },
  });
}

beforeEach(() => {
  fetchSpy = vi.fn();
  globalThis.fetch = fetchSpy;
  transport = new HttpTransport({ baseUrl: BASE_URL, apiKey: API_KEY, timeout: 5000 });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('HttpTransport.post()', () => {
  it('sends POST with auth header and JSON body', async () => {
    fetchSpy.mockResolvedValueOnce(mockResponse({ ok: true }));

    const result = await transport.post<{ ok: boolean }>('/test', { foo: 'bar' });

    expect(result).toEqual({ ok: true });
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}/test`);
    expect(opts.method).toBe('POST');
    expect(opts.headers).toEqual(expect.objectContaining({
      'content-type': 'application/json',
      'authorization': `Bearer ${API_KEY}`,
    }));
    expect(JSON.parse(opts.body as string)).toEqual({ foo: 'bar' });
  });

  it('throws LLM4AgentsError with requestId on HTTP error', async () => {
    fetchSpy.mockResolvedValueOnce(mockResponse(
      { error: 'Unauthorized' },
      401,
      { 'x-request-id': 'req_abc' },
    ));

    try {
      await transport.post('/test', {});
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(LLM4AgentsError);
      const e = err as LLM4AgentsError;
      expect(e.code).toBe('auth_error');
      expect(e.statusCode).toBe(401);
      expect(e.requestId).toBe('req_abc');
    }
  });

  it('throws network_error on fetch failure', async () => {
    fetchSpy.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    try {
      await transport.post('/test', {});
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(LLM4AgentsError);
      const e = err as LLM4AgentsError;
      expect(e.code).toBe('network_error');
      expect(e.statusCode).toBeUndefined();
    }
  });

  it('throws timeout on AbortError', async () => {
    const abortErr = new DOMException('The operation was aborted', 'AbortError');
    fetchSpy.mockRejectedValueOnce(abortErr);

    try {
      await transport.post('/test', {});
      expect.unreachable('should have thrown');
    } catch (err) {
      const e = err as LLM4AgentsError;
      expect(e.code).toBe('timeout');
    }
  });
});

describe('HttpTransport.get()', () => {
  it('sends GET with query params', async () => {
    fetchSpy.mockResolvedValueOnce(mockResponse({ items: [] }));

    await transport.get('/list', { limit: '10', type: 'deposit' });

    const [url] = fetchSpy.mock.calls[0] as [string];
    expect(url).toBe(`${BASE_URL}/list?limit=10&type=deposit`);
  });

  it('sends GET without params when none provided', async () => {
    fetchSpy.mockResolvedValueOnce(mockResponse({ items: [] }));

    await transport.get('/list');

    const [url] = fetchSpy.mock.calls[0] as [string];
    expect(url).toBe(`${BASE_URL}/list`);
  });
});

describe('HttpTransport.postStream()', () => {
  it('returns ReadableStream on success', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"test": true}\n\n'));
        controller.close();
      },
    });
    fetchSpy.mockResolvedValueOnce(new Response(stream, {
      status: 200,
      headers: { 'content-type': 'text/event-stream', 'x-request-id': 'req_s' },
    }));

    const result = await transport.postStream('/stream', { stream: true });

    expect(result.stream).toBeInstanceOf(ReadableStream);
    expect(result.requestId).toBe('req_s');
  });

  it('throws on HTTP error even for stream requests', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('Unauthorized', {
      status: 401,
      headers: { 'x-request-id': 'req_err' },
    }));

    await expect(transport.postStream('/stream', {})).rejects.toThrow(LLM4AgentsError);
  });
});
