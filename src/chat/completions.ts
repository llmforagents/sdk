import type { HttpTransport } from '../transport/http.js';
import type { ChatCompletionParams, ChatResponse, StreamChunk } from './types.js';

export class ChatCompletions {
  constructor(private readonly http: HttpTransport) {}

  async create(params: ChatCompletionParams & { stream: true }): Promise<AsyncIterable<StreamChunk>>;
  async create(params: ChatCompletionParams & { stream?: false | undefined }): Promise<ChatResponse>;
  async create(params: ChatCompletionParams): Promise<ChatResponse | AsyncIterable<StreamChunk>> {
    if (params.stream) {
      return this.createStream(params);
    }
    return this.http.post<ChatResponse>('/v1/chat/completions', params);
  }

  private async createStream(params: ChatCompletionParams): Promise<AsyncIterable<StreamChunk>> {
    const { stream } = await this.http.postStream('/v1/chat/completions', params);
    return this.parseSSE(stream);
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
