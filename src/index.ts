// === Client ===
export { LLM4AgentsClient } from './client.js';

// === Error ===
export { LLM4AgentsError, type ErrorCode } from './errors.js';

// === Types — Config ===
export type { ClientOptions, ModelInfo, ModelListParams, ModelListResult } from './types.js';

// === Types — Chat ===
export type {
  ChatMessage,
  ContentPart,
  TextContentPart,
  ImageUrlContentPart,
  ToolCall,
  ToolChoice,
  ChatCompletionParams,
  ChatResponse,
  ChatChoice,
  ChatUsage,
  StreamChunk,
  StreamDelta,
  StreamEvent,
  ResponseMeta,
  CompletionOptions,
  ConversationOptions,
  ConversationResponse,
  ToolCallRecord,
  CustomTools,
} from './chat/types.js';

// === Types — Wallets ===
export type {
  WalletGenerateParams,
  WalletInfo,
  Balance,
  WalletBalance,
  Transaction,
  TransactionFilter,
  TransactionList,
} from './wallets/types.js';

// === Types — Transfer ===
export type {
  QuoteParams,
  QuoteResult,
  TransferSendParams,
  TransferResult,
  EIP712TypedData,
} from './transfer/types.js';

// === Types — Agents ===
export type { AgentRegistration, AgentRegistrationParams } from './agents/agents.js';

// === Types — Embeddings ===
export type {
  EmbeddingsCreateParams,
  EmbeddingsResponse,
  EmbeddingItem,
  EmbeddingsUsage,
  EmbeddingsOptions,
} from './embeddings/types.js';

// === x402 walk-up payment ===
export {
  X402PaymentRequiredError,
  USDC_ADDRESS_BY_NETWORK,
  USDC_DOMAIN_NAME_BY_NETWORK,
  X402_CAIP2_BY_NETWORK,
} from './x402/types.js';
export type {
  Signer,
  PaymentConfig,
  PaymentPayload,
  PaymentRequirements,
  X402Network,
  X402Receipt,
} from './x402/types.js';
export {
  viemAccountToSigner,
  buildTransferWithAuthorizationTypedData,
  generateNonce,
  TRANSFER_WITH_AUTHORIZATION_TYPES,
} from './x402/signer.js';
export {
  signFromRequirements,
  encodePaymentHeader,
  decodePaymentRequiredHeader,
  pickSupportedRequirements,
  type SignedPayment,
} from './x402/payment.js';
export type { X402Namespace, SignArgs } from './x402/client.js';

// === Types — Tools ===
export type {
  ToolDefinition,
  McpTextContent,
  McpImageContent,
  McpResourceContent,
  McpContent,
  McpToolResult,
  FetchHtmlParams,
  MarkdownParams,
  LinksParams,
  ScreenshotParams,
  PdfParams,
  ExtractParams,
  SessionCreateParams,
  SessionExecParams,
  SessionParams,
  GoogleSearchParams,
  GoogleBatchSearchParams,
  ImageGenerateParams,
  ImageEditParams,
  ImageAnalyzeParams,
} from './tools/types.js';

// === Types — MCP Server (arbitrary server connections) ===
export type { McpServerConfig } from './tools/connect.js';
export type { McpServerHandle } from './transport/mcp-stdio.js';
export type { StdioServerConfig } from './transport/mcp-stdio.js';
export type { HttpServerConfig } from './transport/mcp-http.js';
