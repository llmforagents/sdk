import type { HttpTransport } from '../transport/http.js';
import type {
  WalletGenerateParams,
  WalletInfo,
  Balance,
  TransactionFilter,
  TransactionList,
} from './types.js';

export class Wallets {
  constructor(private readonly http: HttpTransport) {}

  async generate(params: WalletGenerateParams): Promise<WalletInfo> {
    return this.http.post<WalletInfo>('/api/v1/wallets/generate', {
      chain: params.chain,
      token: params.token,
    });
  }

  async balance(): Promise<Balance> {
    return this.http.get<Balance>('/api/v1/balance');
  }

  async transactions(filter?: TransactionFilter): Promise<TransactionList> {
    const params: Record<string, string> = {};
    if (filter?.type) params['type'] = filter.type;
    if (filter?.limit !== undefined) params['limit'] = String(filter.limit);
    if (filter?.offset !== undefined) params['offset'] = String(filter.offset);

    const hasParams = Object.keys(params).length > 0;
    return this.http.get<TransactionList>('/api/v1/transactions', hasParams ? params : undefined);
  }
}
