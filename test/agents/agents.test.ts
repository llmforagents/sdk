import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Agents } from '../../src/agents/agents.js';
import { HttpTransport } from '../../src/transport/http.js';
import { LLM4AgentsError } from '../../src/errors.js';

const API_KEY = '';
const BASE_URL = 'https://api.test.com';

let agents: Agents;
let fetchSpy: ReturnType<typeof vi.fn>;

function mockRegisterResponse(overrides: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({
    uuid: 'agt_test-uuid',
    apiKey: 'sk-proxy-test-key-abc123',
    name: 'My Agent',
    createdAt: '2026-04-30T00:00:00.000Z',
    requestId: 'req_reg_1',
    depositDeadline: '2026-04-30T00:15:00.000Z',
    depositRequiredWithinMinutes: 15,
    notice: 'Fund within 15 min to avoid deletion.',
    ...overrides,
  }), {
    status: 201,
    headers: { 'content-type': 'application/json', 'x-request-id': 'req_reg_1' },
  });
}

beforeEach(() => {
  fetchSpy = vi.fn();
  globalThis.fetch = fetchSpy;
  const http = new HttpTransport({ baseUrl: BASE_URL, apiKey: API_KEY, timeout: 5000 });
  agents = new Agents(http);
});

afterEach(() => { vi.restoreAllMocks(); });

describe('Agents.register()', () => {
  it('posts to /api/v1/agents/register and returns registration info', async () => {
    fetchSpy.mockResolvedValueOnce(mockRegisterResponse());

    const result = await agents.register({ name: 'My Agent' });

    expect(result.uuid).toBe('agt_test-uuid');
    expect(result.apiKey).toBe('sk-proxy-test-key-abc123');
    expect(result.name).toBe('My Agent');
    expect(result.depositRequiredWithinMinutes).toBe(15);
    expect(result.depositDeadline).toBe('2026-04-30T00:15:00.000Z');
    expect(result.notice).toBeTruthy();

    const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}/api/v1/agents/register`);
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body as string) as Record<string, unknown>;
    expect(body['name']).toBe('My Agent');
  });

  it('throws LLM4AgentsError on 429 rate limit', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('rate_limited', { status: 429 }));

    await expect(agents.register({ name: 'Spam' }))
      .rejects.toThrow(LLM4AgentsError);
  });

  it('throws LLM4AgentsError on 400 validation error', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(
      JSON.stringify({ error: 'validation_error', message: 'name is required' }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    ));

    await expect(agents.register({ name: '' }))
      .rejects.toThrow(LLM4AgentsError);
  });
});
