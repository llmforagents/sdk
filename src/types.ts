import type { PaymentConfig } from './x402/types.js';

export interface ClientOptions {
  /**
   * API key (`sk-proxy-…`) for Bearer mode. Required unless using x402
   * walk-up mode (then it may be set to an empty string).
   */
  readonly apiKey: string;
  readonly baseUrl?: string | undefined;
  readonly mcpUrl?: string | undefined;
  readonly timeout?: number | undefined;
  /**
   * Optional walk-up payment configuration. When `payment.mode === 'x402'`,
   * the SDK signs an EIP-3009 authorization per chat completion call
   * instead of sending `Authorization: Bearer …`. The signer is supplied
   * by the caller (see `viemAccountToSigner` or roll your own `Signer`).
   * Defaults to `{ mode: 'bearer' }`.
   *
   * x402 mode is currently available only on `/v1/chat/completions`.
   * Calling other endpoints (wallets, embeddings, transfer, tools) on
   * an x402-only client will throw a clear error.
   */
  readonly payment?: PaymentConfig | undefined;
}

export interface ModelInfo {
  readonly slug: string;
  readonly displayName: string;
  readonly provider: string | null;
  readonly inputPricePer1M: number;
  readonly outputPricePer1M: number;
  readonly contextWindow: number;
  readonly lastSyncedAt: string | null;
  readonly feePct?: number | undefined;
}

export interface ModelListParams {
  readonly search?: string | undefined;
}

export interface ModelListResult {
  readonly models: readonly ModelInfo[];
  readonly requestId: string | undefined;
  readonly feePct?: number | undefined;
}
