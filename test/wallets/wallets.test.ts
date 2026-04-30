import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Wallets } from '../../src/wallets/wallets.js';
import { HttpTransport } from '../../src/transport/http.js';
import { LLM4AgentsError } from '../../src/errors.js';

const API_KEY = 'sk-proxy-test-key';
const BASE_URL = 'https://api.test.com';

let wallets: Wallets;
let fetchSpy: ReturnType<typeof vi.fn>;

function mockResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'x-request-id': 'req_mock' },
  });
}

beforeEach(() => {
  fetchSpy = vi.fn();
  globalThis.fetch = fetchSpy;
  const http = new HttpTransport({ baseUrl: BASE_URL, apiKey: API_KEY, timeout: 5000 });
  wallets = new Wallets(http);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Wallets.generate()', () => {
  it('posts to /api/v1/wallets/generate', async () => {
    fetchSpy.mockResolvedValueOnce(mockResponse({
      chain: 'polygon', token: 'USDC', address: '0xabc', createdAt: '2026-01-01T00:00:00Z', requestId: 'req_1',
    }));
    const result = await wallets.generate({ chain: 'polygon', token: 'USDC' });
    expect(result.address).toBe('0xabc');
    expect(result.chain).toBe('polygon');
    const [url] = fetchSpy.mock.calls[0] as [string];
    expect(url).toBe(`${BASE_URL}/api/v1/wallets/generate`);
  });
});

describe('Wallets.balance()', () => {
  it('gets /api/v1/balance', async () => {
    fetchSpy.mockResolvedValueOnce(mockResponse({
      uuid: 'agent-1', availableUsdCents: 1250, availableUsd: '12.50',
      totalDepositedUsd: '20.00', totalSpentUsd: '7.50',
      wallets: [{ chain: 'polygon', token: 'USDC', availableCents: 1250, availableUsd: '12.50', depositedUsd: '20.00', spentUsd: '7.50' }],
      requestId: 'req_2',
    }));
    const result = await wallets.balance();
    expect(result.availableUsd).toBe('12.50');
    expect(result.wallets).toHaveLength(1);
    const [url] = fetchSpy.mock.calls[0] as [string];
    expect(url).toBe(`${BASE_URL}/api/v1/balance`);
  });
});

describe('Wallets.transactions()', () => {
  it('gets /api/v1/transactions with query params', async () => {
    fetchSpy.mockResolvedValueOnce(mockResponse({
      transactions: [{ id: 1, type: 'deposit', amountUsdCents: 500, model: null, promptTokens: null, completionTokens: null, totalTokens: null, chain: 'polygon', txHash: '0x123', description: 'Deposit', createdAt: '2026-01-01' }],
      limit: 20, offset: 0, total: 1, requestId: 'req_3',
    }));
    const result = await wallets.transactions({ limit: 20, type: 'deposit' });
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0]?.type).toBe('deposit');
    const [url] = fetchSpy.mock.calls[0] as [string];
    expect(url).toContain('limit=20');
    expect(url).toContain('type=deposit');
  });

  it('gets transactions without filters', async () => {
    fetchSpy.mockResolvedValueOnce(mockResponse({
      transactions: [], limit: 50, offset: 0, total: 0, requestId: 'req_4',
    }));
    await wallets.transactions();
    const [url] = fetchSpy.mock.calls[0] as [string];
    expect(url).toBe(`${BASE_URL}/api/v1/transactions`);
  });
});

describe('Wallets error propagation', () => {
  it('throws auth_error on 401 from balance', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('Unauthorized', {
      status: 401,
      headers: { 'x-request-id': 'req_err' },
    }));
    try {
      await wallets.balance();
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(LLM4AgentsError);
      expect((err as LLM4AgentsError).code).toBe('auth_error');
    }
  });

  it('throws insufficient_balance on 402 from generate', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('Insufficient balance', {
      status: 402,
      headers: { 'x-request-id': 'req_err2' },
    }));
    try {
      await wallets.generate({ chain: 'polygon', token: 'USDC' });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(LLM4AgentsError);
      expect((err as LLM4AgentsError).code).toBe('insufficient_balance');
    }
  });
});
