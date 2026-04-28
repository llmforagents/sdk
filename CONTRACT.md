# SDK Contract

version: 1.0.0

> **Naming convention:** Fields in API wire responses (ChatResponse, StreamChunk, ChatMessage, Transaction) use `snake_case` to match the OpenAI-compatible wire format. Fields in SDK wrapper objects (ConversationResponse, WalletInfo, Balance, TransferResult, etc.) use `camelCase`. Python implementers should match this convention per layer.

## client

### LLM4AgentsClient(options)
options:
  apiKey: string (required)
  baseUrl: string (optional, default: https://api.llm4agents.com)
  mcpUrl: string (optional, default: https://mcp.llm4agents.com/mcp)
  timeout: number ms (optional, default: 30000)

## chat.completions

### create(params) → ChatResponse
### create(params) → AsyncIterable<StreamChunk>  [when params.stream === true]
Note: `stream` is a field inside `params` (not a second argument). The two signatures represent overloads dispatched by the value of `params.stream`.
params:
  model: string (required)
  messages: ChatMessage[] (required)
  temperature: float (optional)
  max_tokens: int (optional)
  tools: ToolDefinition[] (optional)
  stream: bool (optional, default: false)
ChatResponse:
  id: string
  choices: ChatChoice[]
  usage: { prompt_tokens: int, completion_tokens: int }
  model: string
ChatChoice:
  index: int
  message: ChatMessage
  finish_reason: string
StreamChunk:
  id: string
  choices: [{ index: int, delta: StreamDelta, finish_reason: string|null }]
  usage: { prompt_tokens: int, completion_tokens: int } | null
  model: string | null
StreamDelta:
  role: string | null
  content: string | null
  tool_calls: [{ index: int, id: string|null, type: string|null, function: { name: string|null, arguments: string|null }|null }] | null
ChatMessage:
  role: "system"|"user"|"assistant"|"tool"
  content: string | null
  tool_calls: ToolCall[] | null
  tool_call_id: string | null
ToolCall:
  id: string
  type: "function"
  function: { name: string, arguments: string }
errors: model_not_found, model_disabled, insufficient_balance, context_overflow,
        auth_error, rate_limited, network_error, timeout, api_error

## chat.conversation

Instantiate via `client.chat.conversation(options)` — it is a factory method on the client, not a standalone constructor. The returned object is a `Conversation` instance.

### Conversation(options)
options:
  model: string (required)
  system: string (optional)
  tools: Tools (optional) — the `client.tools` object; provides getDefinitions() and sub-modules scraper, search, image
  history: ChatMessage[] (optional, default: [])
  onToolCall: (name: string, args: object) → bool | Promise<bool> (optional, return false to cancel)
  onToolResult: (name: string, result: string) → void (optional)
  maxToolRounds: int (optional, default: 10)

### conversation.say(message: string) → ConversationResponse
ConversationResponse:
  content: string
  toolCalls: ToolCallRecord[]
  usage: { promptTokens: int, completionTokens: int, totalTokens: int }
ToolCallRecord:
  name: string
  args: object
  result: string
  durationMs: int
errors: tool_loop_limit, + all from chat.completions

### conversation.stream(message: string) → AsyncIterable<StreamEvent>
StreamEvent (discriminated union on `type`):
  { type: "text", content: string }
  { type: "tool_start", name: string, args: object }
  { type: "tool_end", name: string, result: string, durationMs: int }
  { type: "done", response: ConversationResponse }

### conversation.messages → readonly ChatMessage[] (read-only getter)

### conversation.clear() → void
Resets conversation history to empty (keeps system prompt and options).

### conversation.fork() → Conversation
Returns a new Conversation with a copy of the current history (same model/system/options).

## wallets

### generate(params) → WalletInfo
params:
  chain: string (required)
  token: string (required)
errors: invalid_token, auth_error, api_error
WalletInfo:
  chain: string
  token: string
  address: string
  createdAt: string (ISO 8601)
  requestId: string

### balance() → Balance
Balance:
  uuid: string
  availableUsdCents: int
  availableUsd: string
  totalDepositedUsd: string
  totalSpentUsd: string
  wallets: WalletBalance[]
  requestId: string
WalletBalance:
  chain: string
  token: string
  availableCents: int
  availableUsd: string
  depositedUsd: string
  spentUsd: string

### transactions(filter?) → TransactionList
filter:
  type: "deposit"|"usage"|"refund" (optional)
  limit: int (optional)
  offset: int (optional)
TransactionList:
  transactions: Transaction[]
  limit: int
  offset: int
  total: int
  requestId: string
Transaction:
  id: int
  type: string
  amountUsdCents: int
  model: string | null
  promptTokens: int | null
  completionTokens: int | null
  totalTokens: int | null
  chain: string | null
  txHash: string | null
  description: string
  createdAt: string (ISO 8601)

## models

### list() → ModelInfo[]
ModelInfo:
  slug: string
  displayName: string
  provider: string
  inputPricePer1m: float
  outputPricePer1m: float
  contextWindow: int
  lastSyncedAt: string (ISO 8601)

## transfer

### quote(params) → QuoteResult
params:
  chain: string (required)
  token: string (required)
  from: string (required, wallet address)
  to: string (required, wallet address)
  amount: string (required, decimal string e.g. "10.50")
QuoteResult:
  fee: string
  feeFormatted: string
  feeDecimal: string
  chain: string
  chainId: int
  token: string
  tokenAddress: string
  from: string
  to: string
  amount: string
  amountBaseUnits: string
  deadline: int (unix timestamp)
  nonces: { token: string, forwarder: string }
  typedData: { permit: EIP712TypedData, transferPermit: EIP712TypedData }
  requestId: string
EIP712TypedData:
  domain: object
  types: object
  primaryType: string
  message: object

### submit(quote: QuoteResult, privateKey: string) → TransferResult
Signs EIP-712 typedData.permit and typedData.transferPermit with privateKey,
then submits to the API. No on-chain gas required (gasless).
privateKey format: hex-encoded secp256k1 key (0x-prefixed). Algorithm: EIP-712 (eth_signTypedData_v4).
Python: use `eth_account.sign_typed_data()` from the `eth-account` library (pip install eth-account).
TransferResult:
  txHash: string
  explorerUrl: string
  from: string
  to: string
  chain: string
  token: string
  amount: string
  fee: string
  requestId: string
errors: gas_spike, signature_mismatch, invalid_token, operator_unavailable,
        deadline_expired, auth_error, network_error, timeout, api_error

### send(params) → TransferResult
params:
  chain: string (required)
  token: string (required)
  to: string (required)
  amount: string (required)
  privateKey: string (required)
Convenience: derives `from` address from privateKey, calls quote() then submit().
errors: same as submit()

## tools

### definitions → readonly ToolDefinition[] | undefined (read-only getter)
Returns cached tool definitions. undefined until getDefinitions() has been called.

### getDefinitions() → ToolDefinition[]
Fetches live MCP tool list. Result is cached after first call.
ToolDefinition:
  type: "function"
  function: { name: string, description: string, parameters: object }

### call(name: string, args: object) → string
Calls a named MCP tool with args. Returns raw string result.

### tools.scraper

#### scraper.fetchHtml(params) → string
params: url: string, proxy?: "none"|"datacenter"|"residential"

#### scraper.markdown(params) → string
params: url: string, proxy?: "none"|"datacenter"|"residential"

#### scraper.links(params) → string
params: url: string, proxy?: "none"|"datacenter"|"residential"

#### scraper.screenshot(params) → string
params: url: string, fullPage?: bool, proxy?: "none"|"datacenter"|"residential"
Returns: base64-encoded PNG string.

#### scraper.pdf(params) → string
params: url: string, proxy?: "none"|"datacenter"|"residential"
Returns: base64-encoded PDF string.

#### scraper.extract(params) → string
params: url: string, schema: object, proxy?: "none"|"datacenter"|"residential"

#### scraper.sessionCreate(params) → string
params: proxy?: "none"|"datacenter"|"residential", ttl?: int (seconds)

#### scraper.sessionExec(params) → string
params: sessionId: string, actions: object[]

#### scraper.sessionClose(params) → string
params: sessionId: string

#### scraper.sessionStatus(params) → string
params: sessionId: string

### tools.search

#### search.google(params) → string
params: q: string, gl?: string, hl?: string, tbs?: string, page?: int, location?: string

#### search.googleNews(params) → string
params: q: string, gl?: string, hl?: string, tbs?: string, page?: int, location?: string

#### search.googleMaps(params) → string
params: q: string, gl?: string, hl?: string, tbs?: string, page?: int, location?: string

#### search.batchSearch(params) → string
params: queries: string[], gl?: string, hl?: string

### tools.image

#### image.generate(params) → string
params: prompt: string, width?: int, height?: int

#### image.edit(params) → string
params: prompt: string, imageUrl?: string, imageBase64?: string

#### image.analyze(params) → string
params: prompt: string, imageUrl?: string, imageBase64?: string

## errors

### LLM4AgentsError
message: string
code: ErrorCode
statusCode: int | null
requestId: string | null

ErrorCode values:
  auth_error           — 401/403: invalid or missing API key
  rate_limited         — 429: too many requests
  network_error        — connection failed
  timeout              — request exceeded timeout
  api_error            — generic API error
  model_not_found      — 404: model slug does not exist
  model_disabled       — 422: model exists but is disabled
  context_overflow     — messages exceed model context window
  insufficient_balance — 402: agent balance too low for this request
  gas_spike            — 409: gas price spike, retry later
  signature_mismatch   — 422: EIP-712 signature verification failed
  invalid_token        — 422: unsupported token or chain
  operator_unavailable — 503: gasless relayer unavailable
  deadline_expired     — 400: EIP-712 permit deadline passed
  tool_not_found       — MCP tool name not in tool list
  tool_execution_error — MCP tool returned an error
  tool_loop_limit      — conversation exceeded maxToolRounds
