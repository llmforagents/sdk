export interface WalletGenerateParams {
  readonly chain: string;
  readonly token: string;
}

export interface WalletInfo {
  readonly chain: string;
  readonly token: string;
  readonly address: string;
  readonly createdAt: string;
  readonly requestId: string;
}

export interface WalletBalance {
  readonly chain: string;
  readonly token: string;
  readonly availableCents: number;
  readonly availableUsd: string;
  readonly depositedUsd: string;
  readonly spentUsd: string;
}

export interface Balance {
  readonly uuid: string;
  readonly availableUsdCents: number;
  readonly availableUsd: string;
  readonly totalDepositedUsd: string;
  readonly totalSpentUsd: string;
  readonly wallets: readonly WalletBalance[];
  readonly requestId: string;
}

export interface TransactionFilter {
  readonly type?: 'deposit' | 'usage' | 'refund' | 'gas_sponsored' | undefined;
  readonly limit?: number | undefined;
  readonly offset?: number | undefined;
}

export interface Transaction {
  readonly id: number;
  readonly type: string;
  readonly amountUsdCents: number;
  readonly model: string | null;
  readonly promptTokens: number | null;
  readonly completionTokens: number | null;
  readonly totalTokens: number | null;
  readonly chain: string | null;
  readonly txHash: string | null;
  readonly description: string;
  readonly createdAt: string;
}

export interface TransactionList {
  readonly transactions: readonly Transaction[];
  readonly limit: number;
  readonly offset: number;
  readonly total: number;
  readonly requestId: string;
}
