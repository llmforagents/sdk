import type { HttpTransport } from '../transport/http.js';
import { signTypedData, computeAddress } from './signer.js';
import type { QuoteParams, QuoteResult, TransferSendParams, TransferResult } from './types.js';

interface SendApiResponse {
  readonly txHash: string;
  readonly explorerUrl: string;
  readonly from: string;
  readonly to: string;
  readonly chain: string;
  readonly chainId: number;
  readonly token: string;
  readonly tokenAddress: string;
  readonly amount: string;
  readonly amountBaseUnits: string;
  readonly feeBaseUnits: string;
  readonly feeDecimal: string;
  readonly requestId: string;
}

export class Transfer {
  constructor(private readonly http: HttpTransport) {}

  async quote(params: QuoteParams): Promise<QuoteResult> {
    return this.http.post<QuoteResult>('/v1/tx/quote', {
      chain: params.chain,
      token: params.token,
      from: params.from,
      to: params.to,
      amount: params.amount,
    });
  }

  async submit(quote: QuoteResult, privateKey: string): Promise<TransferResult> {
    const [permitSig, transferPermitSig] = await Promise.all([
      signTypedData(quote.typedData.permit, privateKey),
      signTypedData(quote.typedData.transferPermit, privateKey),
    ]);

    const raw = await this.http.post<SendApiResponse>('/v1/tx/send', {
      chain: quote.chain,
      token: quote.token,
      from: quote.from,
      to: quote.to,
      amount: quote.amount,
      fee: quote.fee,
      deadline: quote.deadline,
      nonces: quote.nonces,
      permitSig,
      transferPermitSig,
    });

    return {
      txHash: raw.txHash,
      explorerUrl: raw.explorerUrl,
      from: raw.from,
      to: raw.to,
      chain: raw.chain,
      token: raw.token,
      amount: raw.amount,
      fee: raw.feeDecimal,
      requestId: raw.requestId,
    };
  }

  async send(params: TransferSendParams): Promise<TransferResult> {
    const from = await computeAddress(params.privateKey);
    const quote = await this.quote({
      chain: params.chain,
      token: params.token,
      from,
      to: params.to,
      amount: params.amount,
    });
    return this.submit(quote, params.privateKey);
  }
}
