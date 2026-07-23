import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HttpTransport } from '../../src/transport/http.js';
import { Videos } from '../../src/videos/videos.js';
import { LLM4AgentsError } from '../../src/errors.js';

const API_KEY = 'sk-proxy-test-key';
const BASE_URL = 'https://api.test.com';

let transport: HttpTransport;
let videos: Videos;
let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy = vi.fn();
  globalThis.fetch = fetchSpy;
  transport = new HttpTransport({ baseUrl: BASE_URL, apiKey: API_KEY, timeout: 5000 });
  videos = new Videos(transport);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Videos.create()', () => {
  it('posts to /v1/videos and returns the 202 accepted shape', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'job_1',
          status: 'pending',
          polling_url: '/v1/videos/job_1',
          charged_usd_cents: 250,
        }),
        {
          status: 202,
          headers: { 'content-type': 'application/json', 'x-request-id': 'req_video_1' },
        },
      ),
    );

    const result = await videos.create({
      prompt: 'A cat riding a skateboard',
      model: 'kling-2.5',
      duration: 5,
      resolution: '720p',
    });

    expect(result).toEqual({
      id: 'job_1',
      status: 'pending',
      polling_url: '/v1/videos/job_1',
      charged_usd_cents: 250,
    });

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}/v1/videos`);
    expect(opts.method).toBe('POST');
    expect(opts.headers).toEqual(expect.objectContaining({
      'content-type': 'application/json',
      'authorization': `Bearer ${API_KEY}`,
    }));
    expect(JSON.parse(opts.body as string)).toEqual({
      prompt: 'A cat riding a skateboard',
      model: 'kling-2.5',
      duration: 5,
      resolution: '720p',
    });
  });

  it('throws a typed insufficient_balance error on 402', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'insufficient balance' }), {
        status: 402,
        headers: { 'content-type': 'application/json', 'x-request-id': 'req_402' },
      }),
    );

    try {
      await videos.create({ prompt: 'A cat riding a skateboard' });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(LLM4AgentsError);
      const e = err as LLM4AgentsError;
      expect(e.code).toBe('insufficient_balance');
      expect(e.statusCode).toBe(402);
      expect(e.requestId).toBe('req_402');
    }
  });
});

describe('Videos.get()', () => {
  it('gets /v1/videos/{id} and returns the status shape', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'job_1',
          status: 'completed',
          video_url: 'https://cdn.example.com/job_1.mp4',
          charged_usd_cents: 250,
        }),
        { status: 200, headers: { 'content-type': 'application/json', 'x-request-id': 'req_video_2' } },
      ),
    );

    const result = await videos.get('job_1');

    expect(result.status).toBe('completed');
    expect(result.video_url).toBe('https://cdn.example.com/job_1.mp4');
    expect(result.charged_usd_cents).toBe(250);

    const [url] = fetchSpy.mock.calls[0] as [string];
    expect(url).toBe(`${BASE_URL}/v1/videos/job_1`);
  });

  it('encodes the id in the URL', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'job/1', status: 'pending', charged_usd_cents: 0 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    await videos.get('job/1');

    const [url] = fetchSpy.mock.calls[0] as [string];
    expect(url).toBe(`${BASE_URL}/v1/videos/job%2F1`);
  });

  it('surfaces a failed job with an error and refund flag', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'job_2',
          status: 'failed',
          error: 'provider timeout',
          refunded: true,
          charged_usd_cents: 0,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const result = await videos.get('job_2');

    expect(result.status).toBe('failed');
    expect(result.error).toBe('provider timeout');
    expect(result.refunded).toBe(true);
  });
});

describe('Videos.content()', () => {
  it('returns bytes and contentType from a successful response', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    fetchSpy.mockResolvedValueOnce(
      new Response(bytes, {
        status: 200,
        headers: { 'content-type': 'video/mp4', 'x-request-id': 'req_video_3' },
      }),
    );

    const result = await videos.content('job_1');

    expect(result.data).toBeInstanceOf(Uint8Array);
    expect(Array.from(result.data)).toEqual([1, 2, 3, 4]);
    expect(result.contentType).toBe('video/mp4');
    expect(result.requestId).toBe('req_video_3');

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}/v1/videos/job_1/content`);
    expect(opts.method).toBe('GET');
    expect(opts.headers).toEqual({ authorization: `Bearer ${API_KEY}` });
  });

  it('falls back to video/mp4 when content-type header is absent', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(new Uint8Array([9]), { status: 200, headers: { 'x-request-id': 'req_x' } }),
    );

    const result = await videos.content('job_1');

    expect(result.contentType).toBe('video/mp4');
  });

  it('throws a typed insufficient_balance error on 402', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'insufficient balance' }), {
        status: 402,
        headers: { 'content-type': 'application/json', 'x-request-id': 'req_402' },
      }),
    );

    try {
      await videos.content('job_1');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(LLM4AgentsError);
      const e = err as LLM4AgentsError;
      expect(e.code).toBe('insufficient_balance');
      expect(e.statusCode).toBe(402);
      expect(e.requestId).toBe('req_402');
    }
  });
});
