import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HttpTransport } from '../../src/transport/http.js';
import { Images } from '../../src/images/images.js';
import { LLM4AgentsError } from '../../src/errors.js';

const API_KEY = 'sk-proxy-test-key';
const BASE_URL = 'https://api.test.com';

let transport: HttpTransport;
let images: Images;
let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy = vi.fn();
  globalThis.fetch = fetchSpy;
  transport = new HttpTransport({ baseUrl: BASE_URL, apiKey: API_KEY, timeout: 5000 });
  images = new Images(transport);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Images.generate()', () => {
  it('posts to /v1/images/generations and passes through data/usage', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          created: 1700000000,
          data: [{ b64_json: 'aGVsbG8=', media_type: 'image/png' }],
          usage: { cost: 0.04 },
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'x-request-id': 'req_img_1',
            'x-charged-usd-cents': '4',
            'x-model-used': 'x-ai/grok-image-1.0',
          },
        },
      ),
    );

    const result = await images.generate({
      prompt: 'A robot writing code',
      model: 'x-ai/grok-image-1.0',
      n: 1,
      resolution: '1K',
    });

    expect(result).toEqual({
      created: 1700000000,
      data: [{ b64_json: 'aGVsbG8=', media_type: 'image/png' }],
      usage: { cost: 0.04 },
    });

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}/v1/images/generations`);
    expect(opts.method).toBe('POST');
    expect(opts.headers).toEqual(expect.objectContaining({
      'content-type': 'application/json',
      'authorization': `Bearer ${API_KEY}`,
    }));
    expect(JSON.parse(opts.body as string)).toEqual({
      prompt: 'A robot writing code',
      model: 'x-ai/grok-image-1.0',
      n: 1,
      resolution: '1K',
    });
  });

  it('supports multiple images in the data array', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            { b64_json: 'aaaa' },
            { b64_json: 'bbbb', media_type: 'image/webp' },
          ],
          usage: { cost: 0.08 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const result = await images.generate({ prompt: 'Two cats', n: 2 });

    expect(result.data).toHaveLength(2);
    expect(result.data[1]?.media_type).toBe('image/webp');
  });

  it('throws a typed insufficient_balance error on 402', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'insufficient balance' }), {
        status: 402,
        headers: { 'content-type': 'application/json', 'x-request-id': 'req_402' },
      }),
    );

    try {
      await images.generate({ prompt: 'A robot writing code' });
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
