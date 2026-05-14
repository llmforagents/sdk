import { describe, it, expect } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import {
  viemAccountToSigner,
  buildTransferWithAuthorizationTypedData,
  generateNonce,
  networkToCaip2,
  TRANSFER_WITH_AUTHORIZATION_TYPES,
} from '../../src/x402/signer.js';

// Deterministic test key — DO NOT use anywhere real.
const TEST_PRIVATE_KEY = '0x' + '1'.repeat(64);

describe('viemAccountToSigner', () => {
  it('produces a Signer with the account address and a signTypedData method', () => {
    const account = privateKeyToAccount(TEST_PRIVATE_KEY);
    const signer = viemAccountToSigner(account);
    expect(signer.address).toBe(account.address);
    expect(typeof signer.signTypedData).toBe('function');
  });

  it('rejects an object without signTypedData', () => {
    expect(() =>
      viemAccountToSigner({ address: '0x0000000000000000000000000000000000000001' } as never),
    ).toThrow(/lacks a signTypedData method/);
  });

  it('signs typed data and returns a 0x-prefixed 132-char hex (65 bytes)', async () => {
    const account = privateKeyToAccount(TEST_PRIVATE_KEY);
    const signer = viemAccountToSigner(account);
    const typedData = buildTransferWithAuthorizationTypedData({
      signer,
      network: 'base-sepolia',
      to: '0x0000000000000000000000000000000000000002' as `0x${string}`,
      value: '10000',
      validAfter: '0',
      validBefore: String(Math.floor(Date.now() / 1000) + 600),
      nonce: '0x' + 'a'.repeat(64) as `0x${string}`,
    });
    const sig = await signer.signTypedData(typedData);
    expect(sig).toMatch(/^0x[0-9a-f]{130}$/i);
  });

  it('produces a deterministic signature for fixed inputs (cross-language fixture)', async () => {
    const account = privateKeyToAccount(TEST_PRIVATE_KEY);
    const signer = viemAccountToSigner(account);
    const typedData = buildTransferWithAuthorizationTypedData({
      signer,
      network: 'base-sepolia',
      to: '0x0000000000000000000000000000000000000002' as `0x${string}`,
      value: '10000',
      validAfter: '0',
      validBefore: '2000000000',
      nonce: '0x' + 'a'.repeat(64) as `0x${string}`,
    });
    const sig1 = await signer.signTypedData(typedData);
    const sig2 = await signer.signTypedData(typedData);
    expect(sig1).toBe(sig2);
  });
});

describe('buildTransferWithAuthorizationTypedData', () => {
  it('uses "USD Coin" as the EIP-712 domain name on base mainnet', () => {
    const account = privateKeyToAccount(TEST_PRIVATE_KEY);
    const signer = viemAccountToSigner(account);
    const td = buildTransferWithAuthorizationTypedData({
      signer,
      network: 'base',
      to: '0x0000000000000000000000000000000000000002' as `0x${string}`,
      value: '1',
      validAfter: '0',
      validBefore: '1',
      nonce: '0x' + '0'.repeat(64) as `0x${string}`,
    });
    expect(td.domain.name).toBe('USD Coin');
    expect(td.domain.chainId).toBe(8453);
    expect(td.domain.verifyingContract).toBe('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
  });

  it('uses "USDC" as the EIP-712 domain name on base-sepolia', () => {
    const account = privateKeyToAccount(TEST_PRIVATE_KEY);
    const signer = viemAccountToSigner(account);
    const td = buildTransferWithAuthorizationTypedData({
      signer,
      network: 'base-sepolia',
      to: '0x0000000000000000000000000000000000000002' as `0x${string}`,
      value: '1',
      validAfter: '0',
      validBefore: '1',
      nonce: '0x' + '0'.repeat(64) as `0x${string}`,
    });
    expect(td.domain.name).toBe('USDC');
    expect(td.domain.chainId).toBe(84532);
  });

  it('emits the EIP-3009 TransferWithAuthorization types verbatim', () => {
    const account = privateKeyToAccount(TEST_PRIVATE_KEY);
    const signer = viemAccountToSigner(account);
    const td = buildTransferWithAuthorizationTypedData({
      signer,
      network: 'base',
      to: '0x0000000000000000000000000000000000000002' as `0x${string}`,
      value: '1',
      validAfter: '0',
      validBefore: '1',
      nonce: '0x' + '0'.repeat(64) as `0x${string}`,
    });
    expect(td.types).toBe(TRANSFER_WITH_AUTHORIZATION_TYPES);
    expect(td.primaryType).toBe('TransferWithAuthorization');
  });
});

describe('generateNonce', () => {
  it('returns a 0x-prefixed 64-hex string (32 bytes)', () => {
    const n = generateNonce();
    expect(n).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('produces distinct values on consecutive calls', () => {
    const a = generateNonce();
    const b = generateNonce();
    expect(a).not.toBe(b);
  });
});

describe('networkToCaip2', () => {
  it('returns eip155:8453 for base mainnet', () => {
    expect(networkToCaip2('base')).toBe('eip155:8453');
  });
  it('returns eip155:84532 for base-sepolia', () => {
    expect(networkToCaip2('base-sepolia')).toBe('eip155:84532');
  });
});
