/**
 * Payment-payload assembly + header (de)serialization for x402.
 *
 * Two-step sign flow:
 *   1. `probeAndSign(probeFn, signer, recipientOverride)` — issue the
 *      unauthenticated POST first (caller supplies the probe function so
 *      we don't drag in HTTP details here), receive 402 with live
 *      requirements, sign them, return the encoded X-PAYMENT header.
 *   2. `signFromRequirements(signer, requirements, recipientOverride)` —
 *      skip the probe, sign against caller-supplied requirements.
 *
 * Both return `{ paymentPayload, encodedHeader, requirements }` so users
 * who want full control (the low-level helper exposed as
 * `client.x402.sign`) can introspect the signed payload.
 */
import type {
  PaymentPayload,
  PaymentRequirements,
  Signer,
  X402Network,
} from './types.js';
import {
  buildTransferWithAuthorizationTypedData,
  generateNonce,
} from './signer.js';

const DEFAULT_VALID_FOR_SECONDS = 5 * 60; // 5min — generous for slow clients

export interface SignedPayment {
  readonly paymentPayload: PaymentPayload;
  readonly encodedHeader: string;
  readonly requirements: PaymentRequirements;
}

export interface SignFromRequirementsInput {
  readonly signer: Signer;
  readonly network: X402Network;
  readonly requirements: PaymentRequirements;
  /** Override the recipient. Defaults to `requirements.payTo`. */
  readonly recipientOverride?: `0x${string}` | undefined;
}

/**
 * Sign a payment authorization against caller-supplied requirements. No
 * HTTP traffic. Returns the full payload + the encoded X-PAYMENT header
 * value (base64-of-JSON).
 */
export async function signFromRequirements(input: SignFromRequirementsInput): Promise<SignedPayment> {
  const recipient = input.recipientOverride ?? assertHexAddress(input.requirements.payTo);
  const nowSec = Math.floor(Date.now() / 1000);
  const validAfter = '0';
  const validBefore = String(nowSec + DEFAULT_VALID_FOR_SECONDS);
  const nonce = generateNonce();

  const typedData = buildTransferWithAuthorizationTypedData({
    signer: input.signer,
    network: input.network,
    to: recipient,
    value: input.requirements.maxAmountRequired,
    validAfter,
    validBefore,
    nonce,
  });

  const signature = await input.signer.signTypedData(typedData);

  const paymentPayload: PaymentPayload = {
    x402Version: 1,
    scheme: input.requirements.scheme,
    network: input.requirements.network,
    payload: {
      signature,
      authorization: {
        from: input.signer.address,
        to: recipient,
        value: input.requirements.maxAmountRequired,
        validAfter,
        validBefore,
        nonce,
      },
    },
  };

  return {
    paymentPayload,
    encodedHeader: encodePaymentHeader(paymentPayload),
    requirements: input.requirements,
  };
}

/**
 * Base64-encode a `PaymentPayload` for the `X-PAYMENT` request header.
 * Uses Web-standard `btoa` (works in Node 18+, browsers, Workers).
 */
export function encodePaymentHeader(payload: PaymentPayload): string {
  return btoa(JSON.stringify(payload));
}

/**
 * Decode a base64 `PAYMENT-REQUIRED` response header. The proxy emits
 * it on 402 responses alongside the JSON body.
 */
export function decodePaymentRequiredHeader(value: string): {
  readonly x402Version: number;
  readonly accepts: readonly PaymentRequirements[];
} {
  const json = atob(value);
  const parsed = JSON.parse(json) as { x402Version?: unknown; accepts?: unknown };
  if (typeof parsed.x402Version !== 'number') {
    throw new Error('PAYMENT-REQUIRED header: missing x402Version');
  }
  if (!Array.isArray(parsed.accepts)) {
    throw new Error('PAYMENT-REQUIRED header: accepts is not an array');
  }
  return {
    x402Version: parsed.x402Version,
    accepts: parsed.accepts as readonly PaymentRequirements[],
  };
}

/**
 * Pick the first scheme the SDK supports from a list of accepted
 * requirements. Today we only support `exact` — `upto` (Permit2) is
 * out of scope per the SDK plan.
 */
export function pickSupportedRequirements(
  accepts: readonly PaymentRequirements[],
): PaymentRequirements {
  const exact = accepts.find((r) => r.scheme === 'exact');
  if (exact !== undefined) return exact;
  throw new Error(
    `No supported x402 scheme in proxy 402 response. Accepted: ${accepts
      .map((r) => r.scheme)
      .join(', ')}. This SDK supports: exact.`,
  );
}

function assertHexAddress(value: string): `0x${string}` {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`Invalid EVM address: ${value}`);
  }
  return value as `0x${string}`;
}
