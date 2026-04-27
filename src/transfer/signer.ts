import type { TypedDataField } from 'ethers';
import type { EIP712TypedData, SigComponents } from './types.js';
import { LLM4AgentsError } from '../errors.js';

export async function signTypedData(
  typedData: EIP712TypedData,
  privateKey: string,
): Promise<SigComponents> {
  let ethers: typeof import('ethers');
  try {
    ethers = await import('ethers');
  } catch {
    throw new LLM4AgentsError(
      'ethers is required for gasless transfers. Install it: npm install ethers',
      'api_error',
      undefined,
      undefined,
    );
  }

  const wallet = new ethers.Wallet(privateKey);
  const sig = await wallet.signTypedData(
    typedData.domain,
    typedData.types as Record<string, TypedDataField[]>,
    typedData.message,
  );

  const parsed = ethers.Signature.from(sig);
  return { v: parsed.v, r: parsed.r, s: parsed.s };
}

export async function computeAddress(privateKey: string): Promise<string> {
  let ethers: typeof import('ethers');
  try {
    ethers = await import('ethers');
  } catch {
    throw new LLM4AgentsError(
      'ethers is required for gasless transfers. Install it: npm install ethers',
      'api_error',
      undefined,
      undefined,
    );
  }

  return ethers.computeAddress(privateKey);
}
