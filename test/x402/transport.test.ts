import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { HttpTransport } from '../../src/transport/http.js';
import { viemAccountToSigner } from '../../src/x402/signer.js';
import { X402PaymentRequiredError } from '../../src/x402/types.js';
import { encodePaymentHeader } from '../../src/x402/payment.js';
import { LLM4AgentsError } from '../../src/errors.js';

const TEST_KEY = '0x' + '1'.repeat(64);

function makeRequirementsBody() {
  return {
    x402Version: 2,
    accepts: [
      {
        scheme: 'exact',
        network: 'eip155:84532',
        maxAmountRequired: '10000',
        asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
        payTo: '0x0000000000000000000000000000000000000033',
        maxTimeoutSeconds: 60,
        extra: { name: 'USDC', version: '2' },
      },
    ],
  };
}

describe('HttpTransport — Bearer mode (regression)', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
  });
  afterEach(() => { fetchSpy.mockRestore(); });

  it('sends Authorization: Bearer when payment is omitted', async () => {
    const http = new HttpTransport({ baseUrl: 'https://api.test', apiKey: 'sk-test', timeout: 5000 });
    await http.post('/api/v1/balance', {});
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['authorization']).toBe('Bearer sk-test');
    expect(headers['x-payment']).toBeUndefined();
  });
});

describe('HttpTransport — x402 mode', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  afterEach(() => { fetchSpy?.mockRestore(); });

  it('probes + signs on each chat completion call, sending X-PAYMENT (not Authorization)', async () => {
    const signer = viemAccountToSigner(privateKeyToAccount(TEST_KEY));
    fetchSpy = vi.spyOn(globalThis, 'fetch')
      // 1st: probe → 402 with paymentRequirements in body
      .mockResolvedValueOnce(new Response(JSON.stringify(makeRequirementsBody()), { status: 402, headers: { 'content-type': 'application/json' } }))
      // 2nd: signed call → 200
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'gen-test', choices: [] }), { status: 200 }));

    const http = new HttpTransport({
      baseUrl: 'https://api.test',
      apiKey: '',
      timeout: 5000,
      payment: { mode: 'x402', signer, network: 'base-sepolia' },
    });
    const res = await http.post<{ id: string }>('/v1/chat/completions', { messages: [{ role: 'user', content: 'hi' }] });

    expect(res.id).toBe('gen-test');
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    const probeInit = fetchSpy.mock.calls[0]![1] as RequestInit;
    const probeHeaders = probeInit.headers as Record<string, string>;
    expect(probeHeaders['authorization']).toBeUndefined();
    expect(probeHeaders['x-payment']).toBeUndefined();

    const signedInit = fetchSpy.mock.calls[1]![1] as RequestInit;
    const signedHeaders = signedInit.headers as Record<string, string>;
    expect(signedHeaders['authorization']).toBeUndefined();
    expect(signedHeaders['x-payment']).toBeTruthy();
    const decoded = JSON.parse(atob(signedHeaders['x-payment']!));
    expect(decoded.scheme).toBe('exact');
    expect(decoded.payload.authorization.from.toLowerCase()).toBe(signer.address.toLowerCase());
  });

  it('produces distinct nonces across successive calls', async () => {
    const signer = viemAccountToSigner(privateKeyToAccount(TEST_KEY));
    // probe + signed × 2 = 4 fetch calls
    fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify(makeRequirementsBody()), { status: 402 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'a' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(makeRequirementsBody()), { status: 402 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'b' }), { status: 200 }));

    const http = new HttpTransport({
      baseUrl: 'https://api.test',
      apiKey: '',
      timeout: 5000,
      payment: { mode: 'x402', signer, network: 'base-sepolia' },
    });
    await http.post('/v1/chat/completions', { messages: [] });
    await http.post('/v1/chat/completions', { messages: [] });

    const sig1 = JSON.parse(atob((fetchSpy.mock.calls[1]![1] as RequestInit).headers!['x-payment' as never] as string));
    const sig2 = JSON.parse(atob((fetchSpy.mock.calls[3]![1] as RequestInit).headers!['x-payment' as never] as string));
    expect(sig1.payload.authorization.nonce).not.toBe(sig2.payload.authorization.nonce);
  });

  it('throws X402PaymentRequiredError on 402 from the signed call (verify failure)', async () => {
    const signer = viemAccountToSigner(privateKeyToAccount(TEST_KEY));
    fetchSpy = vi.spyOn(globalThis, 'fetch')
      // probe
      .mockResolvedValueOnce(new Response(JSON.stringify(makeRequirementsBody()), { status: 402 }))
      // signed → 402 (e.g., facilitator says signature invalid)
      .mockResolvedValueOnce(new Response(JSON.stringify(makeRequirementsBody()), { status: 402, headers: { 'content-type': 'application/json' } }));

    const http = new HttpTransport({
      baseUrl: 'https://api.test',
      apiKey: '',
      timeout: 5000,
      payment: { mode: 'x402', signer, network: 'base-sepolia' },
    });

    await expect(http.post('/v1/chat/completions', {})).rejects.toBeInstanceOf(X402PaymentRequiredError);
  });

  it('throws X402PaymentRequiredError on 402 via PAYMENT-REQUIRED header in Bearer mode', async () => {
    // Even Bearer-mode clients should surface a typed error when the
    // server emits an x402-shaped 402 (e.g., proxy migration in progress).
    const headerValue = encodePaymentHeader({
      x402Version: 1,
      scheme: 'exact',
      network: 'eip155:8453',
      payload: {
        signature: '0x' + 'a'.repeat(130) as `0x${string}`,
        authorization: {
          from: '0x' + '1'.repeat(40) as `0x${string}`,
          to: '0x' + '2'.repeat(40) as `0x${string}`,
          value: '1', validAfter: '0', validBefore: '2000000000',
          nonce: '0x' + 'b'.repeat(64) as `0x${string}`,
        },
      },
    });
    // Re-encode just the accepts[] for the header
    const acceptsBlob = btoa(JSON.stringify({ x402Version: 2, accepts: makeRequirementsBody().accepts }));
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'payment required' }), {
        status: 402,
        headers: { 'content-type': 'application/json', 'payment-required': acceptsBlob },
      }),
    );

    const http = new HttpTransport({ baseUrl: 'https://api.test', apiKey: 'sk-test', timeout: 5000 });
    await expect(http.post('/v1/chat/completions', {})).rejects.toBeInstanceOf(X402PaymentRequiredError);
    void headerValue;
  });

  it('blocks x402 mode on non-allowed paths (per-endpoint allowlist)', async () => {
    const signer = viemAccountToSigner(privateKeyToAccount(TEST_KEY));
    const http = new HttpTransport({
      baseUrl: 'https://api.test',
      apiKey: '',
      timeout: 5000,
      payment: { mode: 'x402', signer, network: 'base-sepolia' },
    });
    await expect(http.post('/api/v1/wallets/generate', {})).rejects.toBeInstanceOf(LLM4AgentsError);
    await expect(http.post('/v1/embeddings', {})).rejects.toThrow(/x402 mode is only available/);
  });
});
