export interface ClientOptions {
  readonly apiKey: string;
  readonly baseUrl?: string | undefined;
  readonly mcpUrl?: string | undefined;
  readonly timeout?: number | undefined;
}

export interface ModelInfo {
  readonly slug: string;
  readonly displayName: string;
  readonly provider: string | null;
  readonly inputPricePer1M: number;
  readonly outputPricePer1M: number;
  readonly contextWindow: number;
  readonly lastSyncedAt: string | null;
  readonly feePct?: number | undefined;
}

export interface ModelListParams {
  readonly search?: string | undefined;
}

export interface ModelListResult {
  readonly models: readonly ModelInfo[];
  readonly requestId: string | undefined;
  readonly feePct?: number | undefined;
}
