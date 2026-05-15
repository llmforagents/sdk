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
    tokensReasoning: parseIntHeader('x-tokens-reasoning'),
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
    return this.parseSSE(streamResp.stream, options);
  }

  private async *parseSSE(stream: ReadableStream<Uint8Array>, options?: CompletionOptions): AsyncIterable<StreamChunk> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let lastUsage: StreamChunk['usage'] | undefined;
    /**
     * SSE events can be multi-line. The proxy emits a trailing
     * `event: x402-receipt\ndata: {...}` chunk AFTER `data: [DONE]` in
     * x402 walk-up streams. We remember the most recent `event: …` line
     * so the next `data:` is dispatched to the right handler.
     */
    let currentEventName: string | null = null;
    let doneSeen = false;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed === '') {
            // SSE event boundary — clear pending event name
            currentEventName = null;
            continue;
          }
          if (trimmed.startsWith('event: ')) {
            currentEventName = trimmed.slice(7).trim();
            continue;
          }
          if (!trimmed.startsWith('data: ')) continue;
          const data = trimmed.slice(6);

          // Trailing x402 receipt — emit via callback and keep reading
          // until the stream actually closes. Do NOT yield as a chat
          // StreamChunk (different shape).
          if (currentEventName === 'x402-receipt') {
            try {
              const receipt = JSON.parse(data) as {
                transaction?: string;
                network?: string;
                amount?: string;
                payer?: string;
              };
              if (options?.onX402Receipt && typeof receipt.transaction === 'string' && typeof receipt.network === 'string' && typeof receipt.amount === 'string' && typeof receipt.payer === 'string') {
                options.onX402Receipt({
                  transaction: receipt.transaction,
                  network: receipt.network,
                  amount: receipt.amount,
                  payer: receipt.payer,
                });
              }
            } catch {
              // malformed receipt — ignore (the chat response was still
              // delivered successfully; the receipt is best-effort)
            }
            currentEventName = null;
            continue;
          }

          if (data === '[DONE]') {
            if (lastUsage && options?.onFinalUsage) {
              options.onFinalUsage({
                promptTokens: lastUsage.prompt_tokens,
                completionTokens: lastUsage.completion_tokens,
                totalTokens: lastUsage.prompt_tokens + lastUsage.completion_tokens,
                ...(lastUsage.reasoning_tokens !== undefined ? { reasoningTokens: lastUsage.reasoning_tokens } : {}),
              });
            }
            doneSeen = true;
            // Don't return — keep reading for a possible trailing
            // x402-receipt event before the stream actually closes.
            continue;
          }

          try {
            const chunk = JSON.parse(data) as StreamChunk;
            if (chunk.usage) lastUsage = chunk.usage;
            yield chunk;
          } catch {
            // skip malformed SSE lines
          }
        }
      }

      if (!doneSeen && lastUsage && options?.onFinalUsage) {
        options.onFinalUsage({
          promptTokens: lastUsage.prompt_tokens,
          completionTokens: lastUsage.completion_tokens,
          totalTokens: lastUsage.prompt_tokens + lastUsage.completion_tokens,
          ...(lastUsage.reasoning_tokens !== undefined ? { reasoningTokens: lastUsage.reasoning_tokens } : {}),
        });
      }
    } finally {
      reader.releaseLock();
    }
  }
}
