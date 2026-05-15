import { describe, it, expect } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import {
  signFromRequirements,
  encodePaymentHeader,
  decodePaymentRequiredHeader,
  pickSupportedRequirements,
} from '../../src/x402/payment.js';
import { viemAccountToSigner } from '../../src/x402/signer.js';
import type { PaymentPayload, PaymentRequirements } from '../../src/x402/types.js';

const TEST_KEY = '0x' + '1'.repeat(64);

function makeRequirements(overrides: Partial<PaymentRequirements> = {}): PaymentRequirements {
  return {
    scheme: 'exact',
    network: 'eip155:84532',
    maxAmountRequired: '10000',
    asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    payTo: '0x0000000000000000000000000000000000000003',
    maxTimeoutSeconds: 60,
    extra: { name: 'USDC', version: '2' },
    ...overrides,
  };
}

describe('signFromRequirements', () => {
  it('produces a fully-formed PaymentPayload with the signer address as `from`', async () => {
    const signer = viemAccountToSigner(privateKeyToAccount(TEST_KEY));
    const res = await signFromRequirements({
      signer,
      network: 'base-sepolia',
      requirements: makeRequirements(),
    });

    expect(res.paymentPayload.x402Version).toBe(1);
    expect(res.paymentPayload.scheme).toBe('exact');
    expect(res.paymentPayload.network).toBe('eip155:84532');
    expect(res.paymentPayload.payload.authorization.from).toBe(signer.address);
    expect(res.paymentPayload.payload.authorization.to).toBe(makeRequirements().payTo);
    expect(res.paymentPayload.payload.authorization.value).toBe('10000');
    expect(res.paymentPayload.payload.authorization.nonce).toMatch(/^0x[0-9a-f]{64}$/);
    expect(res.paymentPayload.payload.signature).toMatch(/^0x[0-9a-f]{130}$/i);
  });

  it('uses recipientOverride when supplied (instead of requirements.payTo)', async () => {
    const signer = viemAccountToSigner(privateKeyToAccount(TEST_KEY));
    const override = '0x0000000000000000000000000000000000000099' as `0x${string}`;
    const res = await signFromRequirements({
      signer,
      network: 'base-sepolia',
      requirements: makeRequirements(),
      recipientOverride: override,
    });
    expect(res.paymentPayload.payload.authorization.to).toBe(override);
  });

  it('generates a fresh nonce for every call (anti-replay)', async () => {
    const signer = viemAccountToSigner(privateKeyToAccount(TEST_KEY));
    const a = await signFromRequirements({
      signer,
      network: 'base-sepolia',
      requirements: makeRequirements(),
    });
    const b = await signFromRequirements({
      signer,
      network: 'base-sepolia',
      requirements: makeRequirements(),
    });
    expect(a.paymentPayload.payload.authorization.nonce).not.toBe(
      b.paymentPayload.payload.authorization.nonce,
    );
  });

  it('throws on a malformed recipient address in requirements.payTo', async () => {
    const signer = viemAccountToSigner(privateKeyToAccount(TEST_KEY));
    await expect(
      signFromRequirements({
        signer,
        network: 'base-sepolia',
        requirements: makeRequirements({ payTo: 'not-an-address' }),
      }),
    ).rejects.toThrow(/Invalid EVM address/);
  });
});

describe('encodePaymentHeader', () => {
  it('round-trips through base64 + JSON', () => {
    const payload: PaymentPayload = {
      x402Version: 1,
      scheme: 'exact',
      network: 'eip155:84532',
      payload: {
        signature: '0x' + 'a'.repeat(130) as `0x${string}`,
        authorization: {
          from: '0x0000000000000000000000000000000000000001' as `0x${string}`,
          to: '0x0000000000000000000000000000000000000002' as `0x${string}`,
          value: '10000',
          validAfter: '0',
          validBefore: '2000000000',
          nonce: '0x' + 'b'.repeat(64) as `0x${string}`,
        },
      },
    };
    const encoded = encodePaymentHeader(payload);
    const decoded = JSON.parse(atob(encoded));
    expect(decoded.x402Version).toBe(1);
    expect(decoded.payload.authorization.value).toBe('10000');
  });
});

describe('decodePaymentRequiredHeader', () => {
  it('decodes a base64 PAYMENT-REQUIRED header into x402Version + accepts[]', () => {
    const body = {
      x402Version: 2,
      accepts: [makeRequirements()],
    };
    const encoded = btoa(JSON.stringify(body));
    const decoded = decodePaymentRequiredHeader(encoded);
    expect(decoded.x402Version).toBe(2);
    expect(decoded.accepts).toHaveLength(1);
    expect(decoded.accepts[0]!.scheme).toBe('exact');
  });

  it('throws on missing x402Version', () => {
    const encoded = btoa(JSON.stringify({ accepts: [] }));
    expect(() => decodePaymentRequiredHeader(encoded)).toThrow(/missing x402Version/);
  });

  it('throws on non-array accepts', () => {
    const encoded = btoa(JSON.stringify({ x402Version: 1, accepts: {} }));
    expect(() => decodePaymentRequiredHeader(encoded)).toThrow(/not an array/);
  });
});

describe('pickSupportedRequirements', () => {
  it('returns the `exact` entry when present', () => {
    const upto = makeRequirements({ scheme: 'upto' });
    const exact = makeRequirements({ scheme: 'exact' });
    expect(pickSupportedRequirements([upto, exact])).toBe(exact);
  });

  it('throws when no supported scheme is present', () => {
    const upto = makeRequirements({ scheme: 'upto' });
    expect(() => pickSupportedRequirements([upto])).toThrow(/No supported x402 scheme/);
  });
});
