import type { HttpTransport } from '../transport/http.js';
import type { VideoCreateParams, VideoJobAccepted, VideoJobStatus, VideoContentResult } from './types.js';

export class Videos {
  constructor(private readonly http: HttpTransport) {}

  async create(params: VideoCreateParams, options?: { signal?: AbortSignal }): Promise<VideoJobAccepted> {
    return this.http.post<VideoJobAccepted>('/v1/videos', params, options?.signal);
  }

  async get(id: string): Promise<VideoJobStatus> {
    return this.http.get<VideoJobStatus>(`/v1/videos/${encodeURIComponent(id)}`);
  }

  async content(id: string): Promise<VideoContentResult> {
    const { data, headers } = await this.http.getBinary(`/v1/videos/${encodeURIComponent(id)}/content`);
    const requestId = headers.get('x-request-id');
    return {
      data,
      contentType: headers.get('content-type') ?? 'video/mp4',
      ...(requestId !== null ? { requestId } : {}),
    };
  }
}
