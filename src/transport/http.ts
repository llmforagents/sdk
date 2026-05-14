import { LLM4AgentsError, mapHttpError } from '../errors.js';
import type { PaymentConfig, X402Network } from '../x402/types.js';
import { X402PaymentRequiredError } from '../x402/types.js';
import {
  signFromRequirements,
  decodePaymentRequiredHeader,
  pickSupportedRequirements,
} from '../x402/payment.js';

/** Routes that the proxy currently accepts x402 payment on. */
/**
 * Routes that the proxy accepts x402 walk-up payment on.
 *
 * - `/v1/chat/completions` — LLM chat (per-token, signed upper bound).
 * - `/v1/scrape/*` — scraper-worker one-shots forwarded by the main proxy:
 *   markdown, fetch_html, screenshot, pdf, extract, links.
 * - `/v1/search/*` — search-worker tools: google, news, maps, batch.
 * - `/v1/image/*` — image tools: generate, edit, analyze.
 *
 * Browser sessions (`session_*` MCP tools) are intentionally NOT in this
 * allowlist — sessions stay Bearer-only because the launch + per-30s +
 * per-action billing model is fundamentally incompatible with a single
 * per-call signed authorization. Use a Bearer-mode client for sessions.
 */
const X402_ALLOWED_PATHS = new Set<string>([
  '/v1/chat/completions',
  '/v1/scrape/fetch_html',
  '/v1/scrape/markdown',
  '/v1/scrape/links',
  '/v1/scrape/screenshot',
  '/v1/scrape/pdf',
  '/v1/scrape/extract',
  '/v1/search/google',
  '/v1/search/news',
  '/v1/search/maps',
  '/v1/search/batch',
  '/v1/image/generate',
  '/v1/image/edit',
  '/v1/image/analyze',
]);

export interface HttpTransportOptions {
  readonly baseUrl: string;
  /** Required in Bearer mode; ignored in x402 mode. */
  readonly apiKey: string;
  readonly timeout: number;
  /** Defaults to `{ mode: 'bearer' }`. */
  readonly payment?: PaymentConfig | undefined;
}

export interface StreamResponse {
  readonly stream: ReadableStream<Uint8Array>;
  readonly requestId: string | undefined;
  readonly headers: Headers;
}

export class HttpTransport {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeout: number;
  private readonly payment: PaymentConfig;

  constructor(opts: HttpTransportOptions) {
    this.baseUrl = opts.baseUrl;
    this.apiKey = opts.apiKey;
    this.timeout = opts.timeout;
    this.payment = opts.payment ?? { mode: 'bearer' };
  }

  /** Network used when in x402 mode (defaults to `'base'`). */
  private get x402Network(): X402Network {
    return this.payment.mode === 'x402' ? this.payment.network ?? 'base' : 'base';
  }

  /**
   * Compose the auth header(s) for a given path. In Bearer mode this is
   * unconditional. In x402 mode it's a probe-and-sign per call: an
   * unauthenticated POST first (to read the live `PAYMENT-REQUIRED`
   * header), then re-POST with `X-PAYMENT`. We expose `probe` so callers
   * who already have requirements (e.g. via `client.x402.probe()`) can
   * skip the second round-trip.
   */
  private async resolveAuthHeaders(
    path: string,
    method: string,
    body: unknown,
  ): Promise<Record<string, string>> {
    if (this.payment.mode === 'bearer') {
      return { authorization: `Bearer ${this.apiKey}` };
    }
    if (!X402_ALLOWED_PATHS.has(path)) {
      throw new LLM4AgentsError(
        `x402 mode is only available on ${[...X402_ALLOWED_PATHS].join(', ')}; ` +
          `cannot use it on ${method} ${path}. Instantiate a Bearer-mode client for this endpoint.`,
        'x402_payment_required',
        undefined,
        undefined,
      );
    }
    const requirements = await this.probeForRequirements(path, body);
    const signed = await signFromRequirements({
      signer: this.payment.signer,
      network: this.x402Network,
      requirements,
      ...(this.payment.payTo !== undefined ? { recipientOverride: this.payment.payTo } : {}),
    });
    return { 'x-payment': signed.encodedHeader };
  }

  /** Issue an unauthenticated POST to read the `PAYMENT-REQUIRED` header. */
  private async probeForRequirements(path: string, body: unknown) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: this.buildSignal(),
    });
    if (res.status !== 402) {
      const text = await res.text().catch(() => '');
      throw new LLM4AgentsError(
        `x402 probe expected HTTP 402 but got ${res.status}: ${text.slice(0, 200)}`,
        'api_error',
        res.status,
        res.headers.get('x-request-id') ?? undefined,
      );
    }
    return this.parsePaymentRequiredFromResponse(res);
  }

  /**
   * Decode the `PAYMENT-REQUIRED` response header (preferred) or, as
   * fallback, the JSON body's `accepts[]`. Picks the first scheme this
   * SDK supports (currently `exact` only).
   */
  private async parsePaymentRequiredFromResponse(res: Response) {
    const headerValue = res.headers.get('payment-required');
    if (headerValue !== null) {
      const decoded = decodePaymentRequiredHeader(headerValue);
      return pickSupportedRequirements(decoded.accepts);
    }
    const text = await res.text().catch(() => '');
    let parsed: { accepts?: unknown } = {};
    try {
      parsed = JSON.parse(text) as { accepts?: unknown };
    } catch {
      throw new LLM4AgentsError(
        'x402 probe: server returned 402 with no PAYMENT-REQUIRED header and no parseable JSON body',
        'api_error',
        res.status,
        res.headers.get('x-request-id') ?? undefined,
      );
    }
    if (!Array.isArray(parsed.accepts)) {
      throw new LLM4AgentsError(
        'x402 probe: 402 body has no accepts[] array',
        'api_error',
        res.status,
        res.headers.get('x-request-id') ?? undefined,
      );
    }
    return pickSupportedRequirements(parsed.accepts as never);
  }

  /**
   * Inspect a 402 response and, if it carries x402 paymentRequirements,
   * throw a typed error. Otherwise (Bearer mode + insufficient balance)
   * defer to mapHttpError.
   */
  private throwFor402(res: Response, body: string): never {
    const requestId = res.headers.get('x-request-id') ?? undefined;
    const headerValue = res.headers.get('payment-required');
    if (headerValue !== null) {
      const decoded = decodePaymentRequiredHeader(headerValue);
      throw new X402PaymentRequiredError(
        body || 'Payment required',
        decoded.accepts,
        decoded.x402Version,
        res.status,
        requestId,
      );
    }
    try {
      const parsed = JSON.parse(body) as { accepts?: unknown; x402Version?: unknown };
      if (Array.isArray(parsed.accepts) && typeof parsed.x402Version === 'number') {
        throw new X402PaymentRequiredError(
          body,
          parsed.accepts as never,
          parsed.x402Version,
          res.status,
          requestId,
        );
      }
    } catch (e) {
      if (e instanceof X402PaymentRequiredError) throw e;
      // fall through to insufficient_balance
    }
    throw mapHttpError(res.status, body, requestId);
  }

  async post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
    const { res, text } = await this.request('POST', path, body, signal);

    if (!res.ok) {
      if (res.status === 402) this.throwFor402(res, text);
      throw mapHttpError(res.status, text, res.headers.get('x-request-id') ?? undefined);
    }

    try {
      return JSON.parse(text) as T;
    } catch {
      throw new LLM4AgentsError(
        'Invalid JSON in API response',
        'api_error',
        res.status,
        res.headers.get('x-request-id') ?? undefined,
      );
    }
  }

  async postWithMeta<T>(path: string, body: unknown, signal?: AbortSignal): Promise<{ data: T; headers: Headers }> {
    const { res, text } = await this.request('POST', path, body, signal);

    if (!res.ok) {
      if (res.status === 402) this.throwFor402(res, text);
      throw mapHttpError(res.status, text, res.headers.get('x-request-id') ?? undefined);
    }

    try {
      const data = JSON.parse(text) as T;
      return { data, headers: res.headers };
    } catch {
      throw new LLM4AgentsError(
        'Invalid JSON in API response',
        'api_error',
        res.status,
        res.headers.get('x-request-id') ?? undefined,
      );
    }
  }

  async get<T>(path: string, params?: Readonly<Record<string, string>>): Promise<T> {
    let url = `${this.baseUrl}${path}`;
    if (params) {
      const qs = new URLSearchParams(params).toString();
      if (qs) {
        url = `${url}?${qs}`;
      }
    }

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'GET',
        headers: {
          'authorization': `Bearer ${this.apiKey}`,
        },
        signal: AbortSignal.timeout(this.timeout),
      });
    } catch (err) {
      throw this.mapFetchError(err);
    }

    const text = await res.text();

    if (!res.ok) {
      throw mapHttpError(res.status, text, res.headers.get('x-request-id') ?? undefined);
    }

    try {
      return JSON.parse(text) as T;
    } catch {
      throw new LLM4AgentsError(
        'Invalid JSON in API response',
        'api_error',
        res.status,
        res.headers.get('x-request-id') ?? undefined,
      );
    }
  }

  async postStream(path: string, body: unknown, signal?: AbortSignal): Promise<StreamResponse> {
    const authHeaders = await this.resolveAuthHeaders(path, 'POST', body);
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify(body),
        signal: this.buildSignal(signal),
      });
    } catch (err) {
      throw this.mapFetchError(err);
    }

    if (!res.ok) {
      const text = await res.text();
      if (res.status === 402) this.throwFor402(res, text);
      throw mapHttpError(res.status, text, res.headers.get('x-request-id') ?? undefined);
    }

    if (!res.body) {
      throw new LLM4AgentsError(
        'Response body is null',
        'api_error',
        res.status,
        res.headers.get('x-request-id') ?? undefined,
      );
    }

    return {
      stream: res.body,
      requestId: res.headers.get('x-request-id') ?? undefined,
      headers: res.headers,
    };
  }

  private async request(
    method: string,
    path: string,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<{ res: Response; text: string }> {
    const authHeaders = await this.resolveAuthHeaders(path, method, body);
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          'content-type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify(body),
        signal: this.buildSignal(signal),
      });
    } catch (err) {
      throw this.mapFetchError(err);
    }

    const text = await res.text();
    return { res, text };
  }

  private buildSignal(userSignal?: AbortSignal): AbortSignal {
    const timeout = AbortSignal.timeout(this.timeout);
    if (!userSignal) return timeout;
    // AbortSignal.any is Node 20+ / modern browsers; fall back to user signal on older runtimes
    const any = (AbortSignal as unknown as Record<string, unknown>)['any'];
    if (typeof any === 'function') {
      return (any as (signals: AbortSignal[]) => AbortSignal)([timeout, userSignal]);
    }
    return userSignal;
  }

  private mapFetchError(err: unknown): LLM4AgentsError {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return new LLM4AgentsError('Request timed out', 'timeout', undefined, undefined);
    }
    const message = err instanceof Error ? err.message : 'Network request failed';
    return new LLM4AgentsError(message, 'network_error', undefined, undefined);
  }
}
