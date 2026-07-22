import type { HttpTransport } from '../transport/http.js';
import type { SpeechCreateParams, SpeechResult } from './types.js';

export class Speech {
  constructor(private readonly http: HttpTransport) {}

  async create(params: SpeechCreateParams, options?: { signal?: AbortSignal }): Promise<SpeechResult> {
    const { data, headers } = await this.http.postBinary('/v1/audio/speech', params, options?.signal);
    const requestId = headers.get('x-request-id');
    const cents = headers.get('x-charged-usd-cents');
    const modelUsed = headers.get('x-model-used');
    return {
      data,
      contentType: headers.get('content-type') ?? 'audio/mpeg',
      ...(requestId !== null ? { requestId } : {}),
      ...(cents !== null ? { chargedUsdCents: Number(cents) } : {}),
      ...(modelUsed !== null ? { modelUsed } : {}),
    };
  }
}

export class Audio {
  readonly speech: Speech;
  constructor(http: HttpTransport) {
    this.speech = new Speech(http);
  }
}
