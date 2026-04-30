import type { HttpTransport } from '../transport/http.js';
import type { ChatCompletionParams, ChatResponse, StreamChunk, CompletionOptions, ResponseMeta } from './types.js';

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
    tokensOutput: parseIntHeader('x-tokens-output'),
    headers,
  };
}

export class ChatCompletions {
  constructor(private readonly http: HttpTransport) {}

  async create(params: ChatCompletionParams & { stream: true }, options?: CompletionOptions): Promise<AsyncIterable<StreamChunk>>;
  async create(params: ChatCompletionParams & { stream?: false | undefined }, options?: CompletionOptions): Promise<ChatResponse>;
  async create(params: ChatCompletionParams, options?: CompletionOptions): Promise<ChatResponse | AsyncIterable<StreamChunk>> {
    if (params.stream) {
      return this.createStream(params, options);
    }
    return this.createNonStream(params, options);
  }

  private async createNonStream(params: ChatCompletionParams, options?: CompletionOptions): Promise<ChatResponse> {
    const { data, headers } = await this.http.postWithMeta<ChatResponse>(
      '/v1/chat/completions',
      params,
      options?.signal,
    );
    if (options?.onMeta) {
      options.onMeta(buildMeta(headers));
    }
    return data;
  }

  private async createStream(params: ChatCompletionParams, options?: CompletionOptions): Promise<AsyncIterable<StreamChunk>> {
    const streamResp = await this.http.postStream('/v1/chat/completions', params, options?.signal);
    if (options?.onMeta) {
      options.onMeta(buildMeta(streamResp.headers));
    }
    return this.parseSSE(streamResp.stream);
  }

  private async *parseSSE(stream: ReadableStream<Uint8Array>): AsyncIterable<StreamChunk> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          const data = trimmed.slice(6);
          if (data === '[DONE]') return;

          try {
            yield JSON.parse(data) as StreamChunk;
          } catch {
            // skip malformed SSE lines
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
