export interface ClientOptions {
  readonly apiKey: string;
  readonly baseUrl?: string | undefined;
  readonly mcpUrl?: string | undefined;
  readonly timeout?: number | undefined;
}

export interface ModelInfo {
  readonly slug: string;
  readonly displayName: string;
  readonly provider: string;
  readonly inputPricePer1M: number;
  readonly outputPricePer1M: number;
  readonly contextWindow: number;
  readonly lastSyncedAt: string;
}

export interface ModelListParams {
  readonly search?: string | undefined;
}

export interface ModelListResult {
  readonly models: readonly ModelInfo[];
  readonly requestId: string | undefined;
}
