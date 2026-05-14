/**
 * `client.x402` namespace — low-level helpers for x402 walk-up payments.
 *
 * `sign(...)` probes the proxy for live `PaymentRequirements` and signs
 * over them. `signFromRequirements(...)` skips the probe (faster, but
 * the caller must pass valid requirements). `probe()` exposes the probe
 * step on its own so users can introspect the proxy's current pricing
 * before deciding whether to sign.
 *
 * Only available when the client is constructed with `payment.mode === 'x402'`.
 * Constructing without `payment` (Bearer mode) throws on first use.
 */
import type { LLM4AgentsClient } from '../client.js';
import { LLM4AgentsError } from '../errors.js';
import {
  signFromRequirements,
  decodePaymentRequiredHeader,
  pickSupportedRequirements,
  type SignedPayment,
} from './payment.js';
import type {
  PaymentConfig,
  PaymentRequirements,
  Signer,
  X402Network,
} from './types.js';

export interface SignArgs {
  /**
   * USD amount to authorize for the next call, e.g. `'$0.05'` or `'$2.00'`.
   * The probe overrides this — `amount` is only honored when
   * `bypassProbe` is true OR `signFromRequirements` is used directly.
   */
  readonly amount?: string | undefined;
  /** Override the recipient address. Defaults to the proxy's advertised payTo. */
  readonly recipient?: `0x${string}` | undefined;
  /**
   * Skip the probe and use `amount` literally. Requires that the caller
   * knows the proxy's current `payTo`, `asset`, etc. — rarely useful
   * outside testing; prefer `signFromRequirements()` if you already have
   * a `PaymentRequirements` object.
   */
  readonly bypassProbe?: boolean | undefined;
}

export class X402Namespace {
  constructor(
    private readonly payment: PaymentConfig,
    private readonly baseUrl: string,
  ) {}

  private get signer(): Signer {
    if (this.payment.mode !== 'x402') {
      throw new LLM4AgentsError(
        'client.x402 is only available when LLM4AgentsClient is constructed with payment.mode = "x402"',
        'x402_payment_required',
        undefined,
        undefined,
      );
    }
    return this.payment.signer;
  }

  private get network(): X402Network {
    if (this.payment.mode !== 'x402') {
      throw new LLM4AgentsError(
        'client.x402 is only available when LLM4AgentsClient is constructed with payment.mode = "x402"',
        'x402_payment_required',
        undefined,
        undefined,
      );
    }
    return this.payment.network ?? 'base';
  }

  /**
   * Probe the proxy for the current `PaymentRequirements` without
   * signing anything. Issues an unauthenticated POST to
   * `/v1/chat/completions` with an empty body and reads the 402
   * response.
   */
  async probe(): Promise<PaymentRequirements> {
    if (this.payment.mode !== 'x402') {
      throw new LLM4AgentsError(
        'client.x402 is only available when LLM4AgentsClient is constructed with payment.mode = "x402"',
        'x402_payment_required',
        undefined,
        undefined,
      );
    }
    const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'probe' }] }),
    });
    if (res.status !== 402) {
      const text = await res.text().catch(() => '');
      throw new LLM4AgentsError(
        `Expected HTTP 402 from probe, got ${res.status}: ${text.slice(0, 200)}`,
        'api_error',
        res.status,
        res.headers.get('x-request-id') ?? undefined,
      );
    }
    const headerValue = res.headers.get('payment-required');
    if (headerValue !== null) {
      return pickSupportedRequirements(decodePaymentRequiredHeader(headerValue).accepts);
    }
    const text = await res.text().catch(() => '');
    try {
      const parsed = JSON.parse(text) as { accepts?: unknown };
      if (Array.isArray(parsed.accepts)) {
        return pickSupportedRequirements(parsed.accepts as never);
      }
    } catch {
      // fall through
    }
    throw new LLM4AgentsError(
      'Probe response had no PAYMENT-REQUIRED header and no parseable accepts[] in body',
      'api_error',
      res.status,
      res.headers.get('x-request-id') ?? undefined,
    );
  }

  /**
   * Probe + sign. Returns the encoded `X-PAYMENT` header value and the
   * fully-formed payload object.
   *
   * `amount` is informational only when `bypassProbe` is false — the
   * proxy's advertised amount is what's actually signed.
   */
  async sign(args: SignArgs = {}): Promise<SignedPayment> {
    const requirements = await this.probe();
    return this.signFromRequirements(requirements, args.recipient);
  }

  /**
   * Sign against caller-supplied requirements. No HTTP traffic. Useful
   * for testing, batch signing, or when the caller already fetched the
   * requirements via `probe()` and wants to reuse them across calls.
   */
  async signFromRequirements(
    requirements: PaymentRequirements,
    recipientOverride?: `0x${string}` | undefined,
  ): Promise<SignedPayment> {
    return signFromRequirements({
      signer: this.signer,
      network: this.network,
      requirements,
      ...(recipientOverride !== undefined ? { recipientOverride } : {}),
    });
  }
}

/**
 * Public re-export so consumers can construct a fresh `X402Namespace`
 * outside of `LLM4AgentsClient` (e.g. for unit tests).
 */
export type { LLM4AgentsClient };
