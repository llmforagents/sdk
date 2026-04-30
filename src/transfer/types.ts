export interface EIP712TypedData {
  readonly domain: Readonly<Record<string, unknown>>;
  readonly types: Readonly<Record<string, readonly { readonly name: string; readonly type: string }[]>>;
  readonly primaryType: string;
  readonly message: Readonly<Record<string, unknown>>;
}

export interface QuoteParams {
  readonly chain: string;
  readonly token: string;
  readonly from: string;
  readonly to: string;
  readonly amount: string;
}

export interface TransferSendParams {
  readonly chain: string;
  readonly token: string;
  readonly to: string;
  readonly amount: string;
  readonly privateKey: string;
}

export interface QuoteResult {
  readonly fee: string;
  readonly feeFormatted: string;
  readonly feeDecimal: string;
  readonly chain: string;
  readonly chainId: number;
  readonly token: string;
  readonly tokenAddress: string;
  readonly from: string;
  readonly to: string;
  readonly amount: string;
  readonly amountBaseUnits: string;
  readonly deadline: number;
  readonly nonces: { readonly token: string; readonly forwarder: string };
  readonly typedData: {
    readonly permit: EIP712TypedData;
    readonly transferPermit: EIP712TypedData;
  };
  readonly forwarderAddress: string;
  readonly requestId: string;
}

export interface TransferResult {
  readonly txHash: string;
  readonly explorerUrl: string;
  readonly from: string;
  readonly to: string;
  readonly chain: string;
  readonly token: string;
  readonly amount: string;
  readonly fee: string;
  readonly requestId: string;
}

export interface SigComponents {
  readonly v: number;
  readonly r: string;
  readonly s: string;
}
