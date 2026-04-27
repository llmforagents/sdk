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

## Quick Start

```typescript
import { LLM4AgentsClient } from '@llmforagents/sdk'

const client = new LLM4AgentsClient({ apiKey: 'sk-proxy-...' })

// One-call gasless transfer
const result = await client.transfer.send({
  chain: 'polygon', token: 'USDC',
  to: '0xRecipient...', amount: '10.50',
  privateKey: '0x...',
})
console.log(result.txHash, result.explorerUrl)

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
    console.log(`${name} done (${result.length} chars)`)
  },
  maxToolRounds: 5,   // default 10
})

// Single turn
const answer = await conv.say('Search for Bitcoin news and summarize the top 3')
console.log(answer.content)
console.log(answer.toolCalls)   // ToolCallRecord[] of executed tools

// Streaming conversation
for await (const event of conv.stream('Now find the current price')) {
  switch (event.type) {
    case 'text':       process.stdout.write(event.content); break
    case 'tool_start': console.log(`\n[tool] ${event.name}`); break
    case 'tool_end':   console.log(`[done] ${event.durationMs}ms`); break
    case 'done':       console.log('\n', event.response.usage); break
  }
}

// History management
const history = conv.messages   // readonly ChatMessage[] — JSON-serializable
conv.clear()                    // reset to empty, keeps system prompt
const branch = conv.fork()      // copy history into a new Conversation
```

To restore a conversation from a previous session:

```typescript
const conv = client.chat.conversation({
  model: 'anthropic/claude-sonnet-4',
  history: savedMessages,       // rehydrate from your store
})
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

`TransactionFilter.type` accepts `'deposit'`, `'usage'`, or `'refund'`.

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

const result = await client.transfer.submit(quote, '0xPrivateKey...')
console.log(result.txHash)
```

## MCP Tools

### Scraper

```typescript
const html = await client.tools.scraper.fetchHtml({ url: 'https://example.com' })
const md   = await client.tools.scraper.markdown({ url: 'https://example.com' })
const shot = await client.tools.scraper.screenshot({ url: 'https://example.com', fullPage: true })
```

All scraper methods accept an optional `proxy` field: `'none'`, `'datacenter'`, or `'residential'`.

### Search

```typescript
const results = await client.tools.search.google({ q: 'TypeScript SDK design' })
const news    = await client.tools.search.googleNews({ q: 'Bitcoin', tbs: 'qdr:d' })
const places  = await client.tools.search.googleMaps({ q: 'coffee near me' })
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
const models = await client.models.list()
for (const m of models) {
  console.log(`${m.slug} — $${m.inputPricePer1m}/1M in, $${m.outputPricePer1m}/1M out`)
}
```

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
