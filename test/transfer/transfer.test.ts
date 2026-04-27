import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Transfer } from '../../src/transfer/transfer.js';
import { HttpTransport } from '../../src/transport/http.js';
import { LLM4AgentsError } from '../../src/errors.js';

const API_KEY = 'sk-proxy-test-key';
const BASE_URL = 'https://api.test.com';
const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const TEST_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

let transfer: Transfer;
let fetchSpy: ReturnType<typeof vi.fn>;

const MOCK_QUOTE = {
  chain: 'polygon', chainId: 137, token: 'USDC',
  tokenAddress: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
  from: TEST_ADDRESS, to: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  amount: '10.50', amountBaseUnits: '10500000',
  fee: '150000', feeFormatted: '$0.15', feeDecimal: '0.15',
  deadline: 1714012345,
  nonces: { token: '0', forwarder: '0' },
  typedData: {
    permit: {
      domain: { name: 'USD Coin', version: '2', chainId: 137, verifyingContract: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359' },
      types: { Permit: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' }] },
      primaryType: 'Permit',
      message: { owner: TEST_ADDRESS, spender: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC', value: '10650000', nonce: '0', deadline: '1714012345' },
    },
    transferPermit: {
      domain: { name: 'StablecoinForwarder', version: '1', chainId: 137, verifyingContract: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC' },
      types: { TransferPermit: [{ name: 'token', type: 'address' }, { name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }, { name: 'fee', type: 'uint256' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' }] },
      primaryType: 'TransferPermit',
      message: { token: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', from: TEST_ADDRESS, to: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', amount: '10500000', fee: '150000', nonce: '0', deadline: '1714012345' },
    },
  },
  requestId: 'req_test123',
};

const MOCK_SEND_RESPONSE = {
  txHash: '0x' + 'ab'.repeat(32),
  explorerUrl: 'https://polygonscan.com/tx/0x' + 'ab'.repeat(32),
  from: TEST_ADDRESS, to: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  chain: 'polygon', chainId: 137, token: 'USDC',
  tokenAddress: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
  amount: '10.50', amountBaseUnits: '10500000',
  feeBaseUnits: '150000', feeDecimal: '0.15',
  requestId: 'req_test123',
};

function mockFetchResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'x-request-id': 'req_test123' },
  });
}

beforeEach(() => {
  fetchSpy = vi.fn();
  globalThis.fetch = fetchSpy;
  const http = new HttpTransport({ baseUrl: BASE_URL, apiKey: API_KEY, timeout: 5000 });
  transfer = new Transfer(http);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Transfer.quote()', () => {
  it('posts to /v1/tx/quote and returns QuoteResult', async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse(MOCK_QUOTE));
    const result = await transfer.quote({
      chain: 'polygon', token: 'USDC',
      from: TEST_ADDRESS, to: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
      amount: '10.50',
    });
    expect(result.fee).toBe('150000');
    expect(result.feeFormatted).toBe('$0.15');
    expect(result.requestId).toBe('req_test123');
    const [url] = fetchSpy.mock.calls[0] as [string];
    expect(url).toBe(`${BASE_URL}/v1/tx/quote`);
  });
});

describe('Transfer.submit()', () => {
  it('signs and posts to /v1/tx/send', async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse(MOCK_SEND_RESPONSE));
    const result = await transfer.submit(MOCK_QUOTE, TEST_PRIVATE_KEY);
    expect(result.txHash).toBe('0x' + 'ab'.repeat(32));
    expect(result.fee).toBe('0.15');
    const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}/v1/tx/send`);
    const body = JSON.parse(opts.body as string) as Record<string, unknown>;
    expect(body['permitSig']).toBeDefined();
    expect(body['transferPermitSig']).toBeDefined();
  });
});

describe('Transfer.send()', () => {
  it('derives from, quotes, then submits', async () => {
    fetchSpy
      .mockResolvedValueOnce(mockFetchResponse(MOCK_QUOTE))
      .mockResolvedValueOnce(mockFetchResponse(MOCK_SEND_RESPONSE));
    const result = await transfer.send({
      chain: 'polygon', token: 'USDC',
      to: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
      amount: '10.50', privateKey: TEST_PRIVATE_KEY,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result.txHash).toBe('0x' + 'ab'.repeat(32));
    expect(result.from).toBe(TEST_ADDRESS);
  });
});
