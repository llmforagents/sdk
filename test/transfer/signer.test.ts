import { describe, it, expect } from 'vitest';
import { ethers } from 'ethers';
import { signTypedData } from '../../src/transfer/signer.js';

const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const wallet = new ethers.Wallet(TEST_PRIVATE_KEY);

const permitTypedData = {
  domain: {
    name: 'USD Coin',
    version: '2',
    chainId: 137,
    verifyingContract: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
  },
  types: {
    Permit: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
    ],
  },
  primaryType: 'Permit',
  message: {
    owner: wallet.address,
    spender: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    value: '10500000',
    nonce: '0',
    deadline: '1714012345',
  },
} as const;

describe('signTypedData', () => {
  it('returns valid v, r, s components', async () => {
    const sig = await signTypedData(permitTypedData, TEST_PRIVATE_KEY);
    expect(sig.v).toBeGreaterThanOrEqual(27);
    expect(sig.v).toBeLessThanOrEqual(28);
    expect(sig.r).toMatch(/^0x[a-fA-F0-9]{64}$/);
    expect(sig.s).toMatch(/^0x[a-fA-F0-9]{64}$/);
  });

  it('produces a signature that recovers to the signer address', async () => {
    const sig = await signTypedData(permitTypedData, TEST_PRIVATE_KEY);
    const recovered = ethers.verifyTypedData(
      permitTypedData.domain,
      permitTypedData.types as unknown as Record<string, ethers.TypedDataField[]>,
      permitTypedData.message,
      { v: sig.v, r: sig.r, s: sig.s },
    );
    expect(recovered.toLowerCase()).toBe(wallet.address.toLowerCase());
  });
});
