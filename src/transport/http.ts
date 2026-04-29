import { LLM4AgentsError, mapHttpError } from '../errors.js';

export interface HttpTransportOptions {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly timeout: number;
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

  constructor(opts: HttpTransportOptions) {
    this.baseUrl = opts.baseUrl;
    this.apiKey = opts.apiKey;
    this.timeout = opts.timeout;
  }

  async post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
    const { res, text } = await this.request('POST', path, body, signal);

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

  async postWithMeta<T>(path: string, body: unknown, signal?: AbortSignal): Promise<{ data: T; headers: Headers }> {
    const { res, text } = await this.request('POST', path, body, signal);

    if (!res.ok) {
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
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: this.buildSignal(signal),
      });
    } catch (err) {
      throw this.mapFetchError(err);
    }

    if (!res.ok) {
      const text = await res.text();
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
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          'content-type': 'application/json',
          'authorization': `Bearer ${this.apiKey}`,
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
