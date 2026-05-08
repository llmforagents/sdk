import type { HttpTransport } from '../transport/http.js';
import type { ResponseMeta } from '../chat/types.js';
import type { EmbeddingsCreateParams, EmbeddingsResponse, EmbeddingsOptions } from './types.js';

function buildMeta(headers: Headers): ResponseMeta {
  const parseIntHeader = (name: string): number | undefined => {
    const val = headers.get(name);
    if (val === null) return undefined;
    const n = parseInt(val, 10);
    return isNaN(n) ? undefined : n;
  };
  return {
    requestId: headers.get('x-request-id') ?? undefined,
    modelUsed: headers.get('x-model-used') ?? undefined,
    costUsdCents: parseIntHeader('x-cost-usd-cents'),
    balanceRemainingCents: parseIntHeader('x-balance-remaining-cents'),
    tokensInput: parseIntHeader('x-tokens-input'),
    // Embeddings have no output/reasoning tokens — set explicitly so the
    // shape matches ResponseMeta even though the route never emits these.
    tokensOutput: undefined,
    tokensReasoning: undefined,
    headers,
  };
}

export class Embeddings {
  constructor(private readonly http: HttpTransport) {}

  async create(
    params: EmbeddingsCreateParams,
    options?: EmbeddingsOptions,
  ): Promise<EmbeddingsResponse> {
    const { data, headers } = await this.http.postWithMeta<EmbeddingsResponse>(
      '/v1/embeddings',
      params,
      options?.signal,
    );
    if (options?.onMeta) {
      options.onMeta(buildMeta(headers));
    }
    return data;
  }
}
