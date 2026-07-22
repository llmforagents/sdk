export interface SpeechCreateParams {
  readonly model: string;
  readonly input: string;
  readonly voice: string;
  readonly response_format?: 'mp3' | 'wav' | 'pcm';
  readonly speed?: number;
  readonly [key: string]: unknown;
}

export interface SpeechResult {
  readonly data: Uint8Array;
  readonly contentType: string;
  readonly requestId?: string;
  readonly chargedUsdCents?: number;
  readonly modelUsed?: string;
}
