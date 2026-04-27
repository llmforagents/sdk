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
  readonly inputPricePer1m: number;
  readonly outputPricePer1m: number;
  readonly contextWindow: number;
  readonly lastSyncedAt: string;
}
