import type { HttpTransport } from '../transport/http.js';
import type { ImagesGenerateParams, ImagesGenerateResponse } from './types.js';

export class Images {
  constructor(private readonly http: HttpTransport) {}

  async generate(
    params: ImagesGenerateParams,
    options?: { signal?: AbortSignal },
  ): Promise<ImagesGenerateResponse> {
    return this.http.post<ImagesGenerateResponse>('/v1/images/generations', params, options?.signal);
  }
}
