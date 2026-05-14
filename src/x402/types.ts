/**
 * x402 walk-up payment types — public surface of the SDK's x402 module.
 *
 * Mirrors `src/services/x402Streaming.ts` constants in the proxy. See
 * `https://github.com/x402-foundation/x402` for the wire protocol.
 */
import { LLM4AgentsError } from '../errors.js';

/** Networks supported by the proxy's x402 wire today. */
export type X402Network = 'base' | 'base-sepolia';

/** CAIP-2 identifiers used internally (mechanisms shape). */
export const X402_CAIP2_BY_NETWORK = {
  base: 'eip155:8453',
  'base-sepolia': 'eip155:84532',
} as const satisfies Record<X402Network, `${string}:${string}`>;

/** USDC contract addresses per network. */
export const USDC_ADDRESS_BY_NETWORK = {
  base: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  'base-sepolia': '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
} as const satisfies Record<X402Network, `0x${string}`>;

/**
 * EIP-712 domain `name()` differs per chain — verified on-chain by the
 * proxy. Base mainnet returns "USD Coin"; Base Sepolia returns "USDC".
 * The spec example uses "USDC" everywhere, which silently breaks mainnet
 * signatures.
 */
export const USDC_DOMAIN_NAME_BY_NETWORK = {
  base: 'USD Coin',
  'base-sepolia': 'USDC',
} as const satisfies Record<X402Network, string>;

/**
 * Minimal signer abstraction. Both `viem`'s `Account` and a user-supplied
 * adapter satisfy this — see `viemAccountToSigner` in `./signer.ts`.
 */
export interface Signer {
  /** 20-byte EVM address, 0x-prefixed, mixed or lower case. */
  readonly address: `0x${string}`;
  /**
   * Sign EIP-712 typed data. The proxy uses EIP-3009
   * `TransferWithAuthorization` for the `exact` scheme.
   */
  signTypedData(params: {
    readonly domain: {
      readonly name: string;
      readonly version: string;
      readonly chainId: number;
      readonly verifyingContract: `0x${string}`;
    };
    readonly types: Readonly<Record<string, ReadonlyArray<{ readonly name: string; readonly type: string }>>>;
    readonly primaryType: string;
    readonly message: Readonly<Record<string, unknown>>;
  }): Promise<`0x${string}`>;
}

/**
 * `payment` constructor option for `LLM4AgentsClient`. When absent, the
 * client operates in Bearer mode (current default).
 */
export type PaymentConfig =
  | {
      readonly mode: 'bearer';
    }
  | {
      readonly mode: 'x402';
      readonly signer: Signer;
      /** Defaults to `'base'`. */
      readonly network?: X402Network | undefined;
      /**
       * Optional override for the recipient address. If unset, the SDK
       * uses whatever the proxy advertises in its 402 response.
       */
      readonly payTo?: `0x${string}` | undefined;
    };

/**
 * `PaymentRequirements` as returned by the proxy in 402 responses. Decoded
 * from either the JSON body's `accepts[]` or the base64-encoded
 * `PAYMENT-REQUIRED` response header.
 */
export interface PaymentRequirements {
  readonly scheme: string;
  readonly network: string;
  readonly maxAmountRequired: string;
  readonly asset: string;
  readonly payTo: string;
  readonly resource?: string | undefined;
  readonly description?: string | undefined;
  readonly mimeType?: string | undefined;
  readonly maxTimeoutSeconds: number;
  readonly extra?: Readonly<Record<string, unknown>> | undefined;
}

/** The signed payment payload — the inner content of the X-PAYMENT header. */
export interface PaymentPayload {
  readonly x402Version: 1;
  readonly scheme: string;
  readonly network: string;
  readonly payload: {
    readonly signature: `0x${string}`;
    readonly authorization: {
      readonly from: `0x${string}`;
      readonly to: `0x${string}`;
      readonly value: string;
      readonly validAfter: string;
      readonly validBefore: string;
      readonly nonce: `0x${string}`;
    };
  };
}

/**
 * Receipt returned to the caller after a successful x402 settlement.
 * Available as `response.x402Receipt` on non-streaming calls and as a
 * `{ type: 'x402_receipt', ... }` event on streaming.
 */
export interface X402Receipt {
  readonly transaction: string;
  readonly network: string;
  readonly amount: string;
  readonly payer: string;
}

/**
 * Thrown on HTTP 402 responses carrying x402 paymentRequirements (i.e.
 * walk-up payment is required — distinct from `insufficient_balance`
 * which means a Bearer agent's pre-deposited balance is too low).
 */
export class X402PaymentRequiredError extends LLM4AgentsError {
  // The parent class pins `name = 'LLM4AgentsError'` via a literal type.
  // We don't override it — callers distinguish via `instanceof` instead.
  constructor(
    message: string,
    public readonly paymentRequirements: readonly PaymentRequirements[],
    public readonly x402Version: number,
    statusCode: number | undefined,
    requestId: string | undefined,
  ) {
    super(message, 'x402_payment_required', statusCode, requestId);
  }
}
