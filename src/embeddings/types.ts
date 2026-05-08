import type { ResponseMeta } from '../chat/types.js';

export interface EmbeddingsCreateParams {
  readonly model: string;
  readonly input: string | readonly string[];
  readonly encoding_format?: 'float' | 'base64' | undefined;
  readonly dimensions?: number | undefined;
  readonly user?: string | undefined;
}

export interface EmbeddingItem {
  readonly object: 'embedding';
  readonly embedding: readonly number[] | string;
  readonly index: number;
}

export interface EmbeddingsUsage {
  readonly prompt_tokens: number;
  readonly total_tokens: number;
}

export interface EmbeddingsResponse {
  readonly object: 'list';
  readonly data: readonly EmbeddingItem[];
  readonly model: string;
  readonly usage: EmbeddingsUsage;
}

export interface EmbeddingsOptions {
  readonly signal?: AbortSignal | undefined;
  readonly onMeta?: ((meta: ResponseMeta) => void) | undefined;
}
