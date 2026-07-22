import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HttpTransport } from '../../src/transport/http.js';
import { Audio } from '../../src/audio/audio.js';
import { LLM4AgentsError } from '../../src/errors.js';

const API_KEY = 'sk-proxy-test-key';
const BASE_URL = 'https://api.test.com';

let transport: HttpTransport;
let audio: Audio;
let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy = vi.fn();
  globalThis.fetch = fetchSpy;
  transport = new HttpTransport({ baseUrl: BASE_URL, apiKey: API_KEY, timeout: 5000 });
  audio = new Audio(transport);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Audio.speech.create()', () => {
  it('returns bytes, contentType, and chargedUsdCents from a successful response', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    fetchSpy.mockResolvedValueOnce(
      new Response(bytes, {
        status: 200,
        headers: {
          'content-type': 'audio/mpeg',
          'x-request-id': 'req_speech_1',
          'x-charged-usd-cents': '12',
          'x-model-used': 'x-ai/grok-voice-tts-1.0',
        },
      }),
    );

    const result = await audio.speech.create({
      model: 'x-ai/grok-voice-tts-1.0',
      input: 'Hola mundo',
      voice: 'sal',
      response_format: 'mp3',
    });

    expect(result.data).toBeInstanceOf(Uint8Array);
    expect(Array.from(result.data)).toEqual([1, 2, 3, 4]);
    expect(result.contentType).toBe('audio/mpeg');
    expect(result.requestId).toBe('req_speech_1');
    expect(result.chargedUsdCents).toBe(12);
    expect(result.modelUsed).toBe('x-ai/grok-voice-tts-1.0');

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}/v1/audio/speech`);
    expect(opts.method).toBe('POST');
    expect(opts.headers).toEqual(expect.objectContaining({
      'content-type': 'application/json',
      'authorization': `Bearer ${API_KEY}`,
    }));
    expect(JSON.parse(opts.body as string)).toEqual({
      model: 'x-ai/grok-voice-tts-1.0',
      input: 'Hola mundo',
      voice: 'sal',
      response_format: 'mp3',
    });
  });

  it('falls back to audio/mpeg when content-type header is absent', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(new Uint8Array([9]), { status: 200, headers: { 'x-request-id': 'req_x' } }),
    );

    const result = await audio.speech.create({
      model: 'x-ai/grok-voice-tts-1.0',
      input: 'hi',
      voice: 'eve',
    });

    expect(result.contentType).toBe('audio/mpeg');
  });

  it('throws a typed insufficient_balance error on 402', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'insufficient balance' }), {
        status: 402,
        headers: { 'content-type': 'application/json', 'x-request-id': 'req_402' },
      }),
    );

    try {
      await audio.speech.create({ model: 'x-ai/grok-voice-tts-1.0', input: 'hi', voice: 'eve' });
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
