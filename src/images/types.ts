export interface ImagesGenerateParams {
  readonly prompt: string;
  readonly model?: string;
  readonly n?: number;
  readonly resolution?: '512' | '1K' | '2K' | '4K';
  readonly aspect_ratio?: string;
  readonly quality?: 'auto' | 'low' | 'medium' | 'high';
  readonly output_format?: 'png' | 'jpeg' | 'webp' | 'svg';
  readonly background?: 'auto' | 'transparent' | 'opaque';
  readonly output_compression?: number;
  readonly seed?: number;
  readonly input_references?: readonly string[];
  readonly [key: string]: unknown;
}

export interface GeneratedImage {
  readonly b64_json: string;
  readonly media_type?: string;
}

export interface ImagesGenerateResponse {
  readonly created?: number;
  readonly data: ReadonlyArray<GeneratedImage>;
  readonly usage?: { readonly cost?: number };
}
