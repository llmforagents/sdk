# @llmforagents/sdk

[![npm version](https://img.shields.io/npm/v/@llmforagents/sdk)](https://www.npmjs.com/package/@llmforagents/sdk)
[![npm downloads](https://img.shields.io/npm/dm/@llmforagents/sdk)](https://www.npmjs.com/package/@llmforagents/sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![GitHub](https://img.shields.io/badge/GitHub-llmforagents%2Fsdk-blue)](https://github.com/llmforagents/sdk)

Unified TypeScript SDK for the LLM4Agents platform — chat completions, wallet management, gasless stablecoin transfers, and MCP-powered tools through a single client.

## Install

```bash
npm install @llmforagents/sdk
```

`ethers` is an optional peer dependency, required only for gasless transfers:

```bash
npm install ethers   # only needed for client.transfer
```

## Get an API Key

1. Go to **[api.llm4agents.com/docs](https://api.llm4agents.com/docs)**
2. Register your agent to receive a key in the format `sk-proxy-...`
3. Pass it to the client constructor:

```typescript
const client = new LLM4AgentsClient({ apiKey: 'sk-proxy-...' })
```

## Quick Start

```typescript
import { LLM4AgentsClient } from '@llmforagents/sdk'

const client = new LLM4AgentsClient({ apiKey: 'sk-proxy-...' })

// Chat completion
const response = await client.chat.completions.create({
  model: 'anthropic/claude-sonnet-4',
  messages: [{ role: 'user', content: 'Hello' }],
})
console.log(response.choices[0]?.message.content)

// Conversation with MCP tools
const conv = client.chat.conversation({
  model: 'anthropic/claude-sonnet-4',
  system: 'You are a research assistant',
  tools: client.tools,
})
const answer = await conv.say('Search for Bitcoin news and summarize the top 3')
console.log(answer.content)

// Gasless stablecoin transfer (optional — requires ethers)
const result = await client.transfer.send({
  chain: 'polygon', token: 'USDC',
  to: '0xRecipient...', amount: '10.50',
  privateKey: '0x...',
})
console.log(result.txHash, result.explorerUrl)
```

## Chat

### Completions

```typescript
// Non-streaming
const response = await client.chat.completions.create({
  model: 'anthropic/claude-sonnet-4',
  messages: [{ role: 'user', content: 'Hello' }],
})
console.log(response.choices[0]?.message.content)

// Streaming
const stream = await client.chat.completions.create({
  model: 'anthropic/claude-sonnet-4',
  messages: [{ role: 'user', content: 'Count to 10' }],
  stream: true,
})
for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content ?? '')
}

// With extended thinking
const response = await client.chat.completions.create({
  model: 'anthropic/claude-sonnet-4',
  messages: [{ role: 'user', content: 'Solve step by step: 47 * 83' }],
  reasoning: true,
  include_reasoning: true,
})

// Model fallback routing — tries primary first, falls back on error
const response = await client.chat.completions.create({
  models: ['anthropic/claude-sonnet-4', 'openai/gpt-4o'],
  messages: [{ role: 'user', content: 'Hello' }],
})

// Vision (multimodal) input
const analysis = await client.chat.completions.create({
  model: 'openai/gpt-4o',
  messages: [{
    role: 'user',
    content: [
      { type: 'text', text: 'What is in this image?' },
      { type: 'image_url', image_url: { url: 'https://example.com/image.png' } },
    ],
  }],
})

// Force/restrict tool use
const response = await client.chat.completions.create({
  model: 'openai/gpt-4o',
  messages: [...],
  tools: await client.tools.getDefinitions(),
  tool_choice: 'required',  // 'none' | 'auto' | 'required' | { type: 'function', function: { name: '...' } }
})

// With cancellation, header metadata, and final usage from streaming
const controller = new AbortController()
const stream = await client.chat.completions.create(
  { model: 'anthropic/claude-sonnet-4', messages: [...], stream: true },
  {
    signal: controller.signal,
    onMeta: (meta) => console.log('Request ID:', meta.requestId),
    // Fires when the SSE stream emits its final usage chunk (some providers send
    // include_usage=true). Use this for accurate token counts in streaming mode,
    // since cost-related response headers are sent before the body and don't
    // reflect the final token totals.
    onFinalUsage: (u) => console.log(`tokens: ${u.totalTokens} (reasoning: ${u.reasoningTokens ?? 0})`),
  },
)
```

### Conversation with Tools

```typescript
const conv = client.chat.conversation({
  model: 'anthropic/claude-sonnet-4',
  system: 'You are a research assistant',
  tools: client.tools,
  history: [],        // optional: rehydrate from persisted messages
  onToolCall: (name, args) => {
    console.log(`Calling ${name}...`)
    return true       // return false to cancel the tool call
  },
  onToolResult: (name, result) => {
    console.log(`${name} done (${result.text.length} chars)`)
  },
  onRoundMeta: (meta) => {
    console.log(`Round cost: $${(meta.costUsdCents ?? 0) / 100}, balance: $${(meta.balanceRemainingCents ?? 0) / 100}`)
  },
  onToolsIgnored: (model) => {
    console.warn(`${model} ignored the tools — model may not support function calling`)
  },
  enablePromptToolFallback: true,   // automatically retry in prompt mode when the model ignores tools
  maxToolRounds: 5,                 // default 10
})

// Single turn
const answer = await conv.say('Search for Bitcoin news and summarize the top 3')
console.log(answer.content)
console.log(answer.toolCalls)   // ToolCallRecord[] of executed tools
console.log(answer.usage)       // { promptTokens, completionTokens, totalTokens, reasoningTokens? }

// Streaming conversation
for await (const event of conv.stream('Now find the current price')) {
  switch (event.type) {
    case 'text':       process.stdout.write(event.content); break
    case 'reasoning':  process.stdout.write(`<think>${event.content}</think>`); break
    case 'meta':       console.log('Request ID:', event.meta.requestId); break
    case 'tool_start': console.log(`\n[tool] ${event.name}`); break
    case 'tool_end':   console.log(`[done] ${event.result.text.slice(0, 60)} (${event.durationMs}ms)`); break
    case 'fallback':   console.log(`\n[fallback] ${event.model} ignored tools — retrying in prompt mode`); break
    case 'done':       console.log('\n', event.response.usage); break
  }
}

// History management
const history = conv.messages   // readonly ChatMessage[] — JSON-serializable
conv.clear()                    // reset to empty, keeps system prompt
const branch = conv.fork()      // copy history into a new Conversation
```

`onToolsIgnored(model)` fires once when a model returns no tool calls on the first round despite being given tools — useful for detecting models without native function calling.

`enablePromptToolFallback: true` (default `false`) goes one step further: when the model ignores tools, the SDK automatically retries that round with the tool definitions injected into the system prompt and parses `<tool_call>{"name":"...","arguments":{...}}</tool_call>` blocks from the response text, then continues the loop as if the model had emitted native tool_calls. The `stream()` consumer additionally receives a `{ type: 'fallback' }` event right before the prompt-mode tool execution begins. Costs one extra LLM round when fallback fires.

To restore a conversation from a previous session:

```typescript
const conv = client.chat.conversation({
  model: 'anthropic/claude-sonnet-4',
  history: savedMessages,       // rehydrate from your store
})
```

### McpToolResult

All tool calls return an `McpToolResult` instead of a plain string:

```typescript
const result = await client.tools.scraper.fetchHtml({ url: 'https://example.com' })

result.text          // string — joined text from all text parts (convenience)
result.content       // readonly McpContent[] — typed content parts

for (const part of result.content) {
  if (part.type === 'text')     console.log(part.text)
  if (part.type === 'image')    console.log(part.mimeType, part.data.length)  // base64
  if (part.type === 'resource') console.log(part.uri, part.text)
}
```

The MCP transport auto-normalizes raw responses: snake_case `mime_type` is aliased to `mimeType`, `imageBase64` / `pngBase64` keys are mapped to `data`, MIME types are sniffed from base64 magic bytes when missing, and JSON-wrapped image/PDF payloads embedded inside text blocks (e.g. `{"imageBase64": "...", "mimeType": "image/png"}`) are auto-promoted to typed `McpImageContent` / `McpResourceContent`.

## Agents

```typescript
// Register a new agent — unauthenticated, call before you have an API key
const client = new LLM4AgentsClient({ apiKey: '' }) // empty key is fine for registration
const reg = await client.agents.register({ name: 'My Agent' })
// The returned apiKey is shown only once — save it immediately
console.log(reg.apiKey)           // sk-proxy-...
console.log(reg.depositDeadline)  // fund before this or the agent is deleted (15 min)
console.log(reg.notice)           // human-readable reminder
```

## Wallets

```typescript
// Generate a deposit wallet
const wallet = await client.wallets.generate({ chain: 'polygon', token: 'USDC' })
console.log(wallet.address)

// Check balance
const balance = await client.wallets.balance()
console.log(balance.availableUsd)
console.log(balance.wallets)    // WalletBalance[] — per-chain/token breakdown

// Transaction history
const txs = await client.wallets.transactions({ limit: 20, type: 'deposit' })
for (const tx of txs.transactions) {
  console.log(`${tx.type}: $${tx.amountUsdCents / 100} — ${tx.description}`)
}
```

`TransactionFilter.type` accepts `'deposit'`, `'usage'`, `'refund'`, or `'gas_sponsored'`.

## Gasless Transfers

Requires `ethers ^6.0.0` installed as a peer dependency.

```typescript
// One-call — resolves after the transaction is confirmed
const result = await client.transfer.send({
  chain: 'polygon', token: 'USDC',
  to: '0xRecipient...', amount: '10.50',
  privateKey: '0x...',
})
console.log(result.txHash, result.explorerUrl)

// Two-step — inspect the fee before committing
const quote = await client.transfer.quote({
  chain: 'polygon', token: 'USDC',
  from: '0xSender...', to: '0xRecipient...', amount: '10.50',
})
console.log(`Fee: ${quote.feeFormatted}`)
console.log(`Forwarder: ${quote.forwarderAddress}`)  // EIP-2771 forwarder used for the transfer

const result = await client.transfer.submit(quote, '0xPrivateKey...')
console.log(result.txHash)
```

## MCP Tools

### Scraper

```typescript
const html  = await client.tools.scraper.fetchHtml({ url: 'https://example.com' })
const md    = await client.tools.scraper.markdown({ url: 'https://example.com' })
const links = await client.tools.scraper.links({ url: 'https://example.com' })
const shot  = await client.tools.scraper.screenshot({ url: 'https://example.com', fullPage: true })
const pdf   = await client.tools.scraper.pdf({ url: 'https://example.com' })
const data  = await client.tools.scraper.extract({
  url: 'https://example.com',
  schema: { type: 'object', properties: { title: { type: 'string' } } },
})
```

All scraper methods accept an optional `proxy` field: `'none'`, `'datacenter'`, or `'residential'`.

#### Browser sessions

```typescript
const session = await client.tools.scraper.sessionCreate({})
const result  = await client.tools.scraper.sessionExec({
  sessionId: session.text,
  actions: [{ type: 'navigate', url: 'https://example.com' }],
})
const status  = await client.tools.scraper.sessionStatus({ sessionId: session.text })
await client.tools.scraper.sessionClose({ sessionId: session.text })
```

### Search

```typescript
const results = await client.tools.search.google({ q: 'TypeScript SDK design' })
const news    = await client.tools.search.googleNews({ q: 'Bitcoin', tbs: 'qdr:d' })
const places  = await client.tools.search.googleMaps({ q: 'coffee near me' })
const batch   = await client.tools.search.batchSearch({ queries: ['python', 'golang'] })
```

### Image

```typescript
const img      = await client.tools.image.generate({ prompt: 'A robot writing code' })
const edited   = await client.tools.image.edit({ prompt: 'Make it blue', imageUrl: '...' })
const analysis = await client.tools.image.analyze({ prompt: 'What is this?', imageUrl: '...' })
```

### Tool Definitions

`client.tools.definitions` returns `ToolDefinition[] | undefined` (populated after the first tool call).
Use `client.tools.getDefinitions()` to eagerly fetch and cache the list:

```typescript
const defs = await client.tools.getDefinitions()   // ToolDefinition[] in OpenAI function format
```

Pass these definitions to any LLM that supports function calling, or let the `conversation()` helper manage them automatically when `tools: client.tools` is set.

## Models

```typescript
const result = await client.models.list()
for (const m of result.models) {
  console.log(`${m.slug} — $${m.inputPricePer1M}/1M in, $${m.outputPricePer1M}/1M out`)
  if (m.feePct !== undefined) console.log(`  platform fee: ${m.feePct}%`)
}

// Filter by name
const filtered = await client.models.list({ search: 'claude' })
```

`models.list()` returns a `ModelListResult` with `.models` (array), `.requestId` (string | undefined), and `.feePct` (number | undefined — the platform fee percentage applied as a default for models that don't override it).

## Embeddings

```typescript
const res = await client.embeddings.create({
  model: 'openai/text-embedding-3-large',
  input: 'How many vectors fit in a haystack?',
})
console.log(res.data[0].embedding.length)  // → e.g. 3072
console.log(res.usage.prompt_tokens, res.model)

// Batch input
const batch = await client.embeddings.create({
  model: 'openai/text-embedding-3-small',
  input: ['first', 'second', 'third'],
})
batch.data.forEach((item) => console.log(item.index, item.embedding))
```

`embeddings.create()` accepts an OpenAI-compatible request — `model` (slug), `input` (string or string array, max 2048 entries), and the optional `encoding_format`, `dimensions`, and `user` fields. The response shape mirrors OpenAI's: `{ object, data: [{ embedding, index, object }], model, usage: { prompt_tokens, total_tokens } }`. Embeddings have no completion tokens, so billing is input-only — the actual model that responded is reported in the `X-Model-Used` response header (also surfaced via the `onMeta` callback).

> **Catalog:** Embedding models do not appear in OpenRouter's public catalog endpoint, so the proxy maintains them by hand. New embedding models can be added through the admin panel — see `model_type='embedding'` rows.

## Error Handling

All errors are instances of `LLM4AgentsError`:

```typescript
import { LLM4AgentsClient, LLM4AgentsError } from '@llmforagents/sdk'

try {
  await client.chat.completions.create({ ... })
} catch (err) {
  if (err instanceof LLM4AgentsError) {
    console.error(err.code, err.statusCode, err.requestId, err.message)
  }
}
```

| `code` | HTTP status | Description |
|---|---|---|
| `auth_error` | 401, 403 | Invalid or missing API key |
| `insufficient_balance` | 402 | Not enough balance to cover the request |
| `rate_limited` | 429 | Too many requests |
| `model_not_found` | 404 | Requested model does not exist in the catalog |
| `model_disabled` | 422 | Model exists but is currently disabled |
| `context_overflow` | — | Prompt + max_tokens exceeds the model's context window |
| `gas_spike` | 409 | Network gas price spiked above safe threshold during transfer |
| `signature_mismatch` | 422 | EIP-712 permit signature could not be verified |
| `invalid_token` | 422 | Unsupported token or chain for gasless transfer |
| `operator_unavailable` | 503 | Gasless relayer is temporarily unavailable |
| `deadline_expired` | 400 | EIP-712 permit deadline passed before submission |
| `tool_not_found` | — | MCP tool name not found in the server's tool list |
| `tool_execution_error` | — | MCP tool returned an error result |
| `tool_loop_limit` | — | Conversation exceeded `maxToolRounds` without a final answer |
| `network_error` | — | `fetch` threw (DNS failure, TCP reset, etc.) |
| `timeout` | — | Request exceeded the configured timeout |
| `api_error` | 4xx, 5xx | Any other non-success response |

## Constructor Options

```typescript
const client = new LLM4AgentsClient({
  apiKey:  'sk-proxy-...',                          // required
  baseUrl: 'https://api.llm4agents.com',            // optional
  mcpUrl:  'https://mcp.llm4agents.com/mcp',        // optional
  timeout: 30_000,                                  // optional, ms, default 30s
})
```

## What's New in v2.4

- **`client.embeddings.create()`** — OpenAI-compatible embeddings against `POST /v1/embeddings`. Pass a string or array of up to 2048 strings; receive `{ data: EmbeddingItem[], model, usage }` with input-only billing. Embedding-model catalog is curated by hand on the server because OpenRouter omits embedding models from its public catalog endpoint.
- New types exported: `EmbeddingsCreateParams`, `EmbeddingsResponse`, `EmbeddingItem`, `EmbeddingsUsage`, `EmbeddingsOptions`.

## Migration from v1.x

| Before (v1) | After (v2) |
|---|---|
| `await tools.call(name, args)` → `string` | `result.text` (or full `McpToolResult`) |
| `onToolResult: (name, result: string)` | `result` is now `McpToolResult` — use `result.text` |
| `await client.models.list()` → `ModelInfo[]` | `result.models` (access via `.models`) |
| `conv.stream()` `tool_end` event `.result: string` | `.result` is now `McpToolResult` |

**v2.0.1 → v2.1.0**

| Before (v2.0.1) | After (v2.1.0) |
|---|---|
| `model.inputPricePer1m` | `model.inputPricePer1M` (capital M) |
| `model.outputPricePer1m` | `model.outputPricePer1M` (capital M) |
| Tool errors silenced as text | Tool errors throw `LLM4AgentsError` |
| `gas_sponsored` missing from transaction filter | `type: 'gas_sponsored'` now valid |

## Migration from @llm4agents/gasless

`@llm4agents/gasless` is deprecated. Replace it with `@llmforagents/sdk`:

| Before (`@llm4agents/gasless`) | After (`@llmforagents/sdk`) |
|---|---|
| `new GaslessClient({ apiKey })` | `new LLM4AgentsClient({ apiKey })` |
| `gc.transfer(params)` | `client.transfer.send(params)` |
| `gc.quote(params)` | `client.transfer.quote(params)` |
| `gc.send(quote, key)` | `client.transfer.submit(quote, key)` |
| `GaslessError` | `LLM4AgentsError` |
| `err.code` values | Identical — same string literal codes |
| `QuoteResult`, `TransferResult` shapes | Identical |

## License

MIT
