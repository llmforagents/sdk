/**
 * Signer abstraction + viem adapter for x402 EIP-3009 signatures.
 *
 * Two ways to bring a wallet:
 *
 *   1. Pass a `viem` `Account` directly via `viemAccountToSigner(account)`.
 *      Easiest if you're already on `viem` (the recommended Ethereum
 *      stack for new code).
 *
 *   2. Provide your own `Signer` implementation. Useful when wrapping
 *      MetaMask, hardware wallets, or any other signing primitive.
 *
 * Both paths produce the same `Signer` shape the rest of this module
 * consumes, so swapping wallets at the boundary doesn't ripple.
 *
 * Ports & Adapters (CLAUDE.md TypeScript Pattern 11): the SDK depends on
 * the `Signer` interface in `./types.ts`, not on `viem`. `viem` is an
 * optional peer dep and only imported by `viemAccountToSigner` users.
 */
import type { Signer, X402Network } from './types.js';
import {
  USDC_ADDRESS_BY_NETWORK,
  USDC_DOMAIN_NAME_BY_NETWORK,
  X402_CAIP2_BY_NETWORK,
} from './types.js';

/**
 * Convert a `viem` `Account` (e.g. from `privateKeyToAccount` or a
 * `WalletClient`) into the SDK's `Signer` shape. Imports `viem` types
 * via a structural duck-type so this module doesn't take a hard
 * runtime dependency on `viem` (peer dep is optional).
 */
export function viemAccountToSigner(account: {
  readonly address: `0x${string}`;
  readonly signTypedData?: (params: {
    readonly domain: {
      readonly name: string;
      readonly version: string;
      readonly chainId: number;
      readonly verifyingContract: `0x${string}`;
    };
    readonly types: Record<string, ReadonlyArray<{ readonly name: string; readonly type: string }>>;
    readonly primaryType: string;
    readonly message: Record<string, unknown>;
  }) => Promise<`0x${string}`>;
}): Signer {
  if (typeof account.signTypedData !== 'function') {
    throw new Error(
      'viemAccountToSigner: the supplied object lacks a signTypedData method. ' +
        'Pass an Account from privateKeyToAccount() or a wallet client.',
    );
  }
  const sign = account.signTypedData;
  return {
    address: account.address,
    signTypedData: (params) =>
      sign({
        domain: params.domain,
        types: params.types as Record<string, ReadonlyArray<{ readonly name: string; readonly type: string }>>,
        primaryType: params.primaryType,
        message: params.message as Record<string, unknown>,
      }),
  };
}

/** Chain ID for each supported network. */
const CHAIN_ID_BY_NETWORK: Record<X402Network, number> = {
  base: 8453,
  'base-sepolia': 84532,
};

/** EIP-3009 `TransferWithAuthorization` typed-data types. */
export const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const;

export interface BuildTypedDataInput {
  readonly signer: Signer;
  readonly network: X402Network;
  readonly to: `0x${string}`;
  readonly value: string;
  readonly validAfter: string;
  readonly validBefore: string;
  readonly nonce: `0x${string}`;
}

/**
 * Build the EIP-3009 `TransferWithAuthorization` typed-data payload
 * ready for the `Signer` to sign over. Constants per network come from
 * the proxy's on-chain-verified config (`USD Coin` on mainnet vs `USDC`
 * on Sepolia — a real gotcha that breaks signatures if copy-pasted from
 * the spec example).
 */
export function buildTransferWithAuthorizationTypedData(input: BuildTypedDataInput): {
  readonly domain: {
    readonly name: string;
    readonly version: string;
    readonly chainId: number;
    readonly verifyingContract: `0x${string}`;
  };
  readonly types: typeof TRANSFER_WITH_AUTHORIZATION_TYPES;
  readonly primaryType: 'TransferWithAuthorization';
  readonly message: {
    readonly from: `0x${string}`;
    readonly to: `0x${string}`;
    readonly value: string;
    readonly validAfter: string;
    readonly validBefore: string;
    readonly nonce: `0x${string}`;
  };
} {
  return {
    domain: {
      name: USDC_DOMAIN_NAME_BY_NETWORK[input.network],
      version: '2',
      chainId: CHAIN_ID_BY_NETWORK[input.network],
      verifyingContract: USDC_ADDRESS_BY_NETWORK[input.network],
    },
    types: TRANSFER_WITH_AUTHORIZATION_TYPES,
    primaryType: 'TransferWithAuthorization',
    message: {
      from: input.signer.address,
      to: input.to,
      value: input.value,
      validAfter: input.validAfter,
      validBefore: input.validBefore,
      nonce: input.nonce,
    },
  };
}

/** Generate a fresh 32-byte hex nonce using Web Crypto. */
export function generateNonce(): `0x${string}` {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let hex = '0x';
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex as `0x${string}`;
}

/**
 * Resolve the CAIP-2 network identifier the proxy emits in
 * `PaymentRequirements.network` (e.g. `eip155:8453`).
 */
export function networkToCaip2(network: X402Network): `${string}:${string}` {
  return X402_CAIP2_BY_NETWORK[network];
}
