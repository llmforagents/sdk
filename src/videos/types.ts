export interface VideoCreateParams {
  readonly prompt: string;
  readonly model?: string;
  readonly image?: string;
  readonly duration?: number;
  readonly resolution?: '480p' | '720p' | '1080p';
  readonly aspect_ratio?: string;
  readonly generate_audio?: boolean;
  readonly seed?: number;
  readonly [key: string]: unknown;
}

export interface VideoJobAccepted {
  readonly id: string;
  readonly status: string;
  readonly polling_url: string;
  readonly charged_usd_cents: number;
}

export interface VideoJobStatus {
  readonly id: string;
  readonly status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled' | 'expired';
  readonly video_url?: string;
  readonly error?: string;
  readonly refunded?: boolean;
  readonly charged_usd_cents: number;
}

export interface VideoContentResult {
  readonly data: Uint8Array;
  readonly contentType: string;
  readonly requestId?: string;
}
