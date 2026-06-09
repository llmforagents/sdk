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

`viem` is an optional peer dependency, required only for x402 walk-up payments
when using a `viem.Account`. The SDK also accepts any custom `Signer`
implementation (see [x402 Walk-up Payment](#x402-walk-up-payment) below):

```bash
npm install viem     # only needed for x402 with viem accounts
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
  tool_choice: 'required',          // 'auto' (default) | 'required' | 'none' | { type: 'function', function: { name } }
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

`tool_choice` controls tool selection on **round 1 only**, then reverts to `'auto'` for every subsequent round. This is the agent-routing pattern: force the model to use a tool on the first turn (so it can't quietly emit JSON-as-text instead), then let it summarize the tool result naturally on the wrap-up turn. Setting `'required'` on every round forces a tool call forever and the conversation hits `maxToolRounds`. Accepts `'auto'` (default), `'required'`, `'none'`, or `{ type: 'function', function: { name: '...' } }` to force a specific named tool.

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

## x402 Walk-up Payment

The proxy supports the [x402 protocol](https://x402.org) for per-request stablecoin
payments on `POST /v1/chat/completions`. Instead of pre-funding an agent account,
the client signs an EIP-3009 `TransferWithAuthorization` for USDC on Base /
Base-Sepolia, attaches it as an `X-PAYMENT` header, and the proxy settles
on-chain after the response is delivered.

> **Scope: this SDK signs x402 payments going OUT.** The SDK builds and signs
> `X-PAYMENT` headers so your code can pay any x402-compatible server (the
> llm4agents API, an x402engine endpoint, or any third party). It does **not**
> include server-side helpers: there is no `verifyPayment`, no `settlePayment`,
> no `requirePayment` middleware. If your agent needs to *receive* x402 payments
> (run its own paywall), use a server library directly — `@x402/hono` for Hono,
> `x402-express` for Express, `@coinbase/x402` for any framework, or the
> [reference servers](https://github.com/x402-foundation/x402#servers) for
> other stacks. See **Roadmap** below for the server-side direction.

Two modes are mutually exclusive — pick one at construction time:

| Mode | Set via | Required | Use when |
|---|---|---|---|
| **Bearer** (default) | omit `payment` or `payment: { mode: 'bearer' }` | `apiKey` | You have an agent and a pre-funded balance |
| **x402 walk-up** | `payment: { mode: 'x402', signer }` | `signer` (viem.Account or custom) | You want one-shot calls billed per-request from a wallet, no agent registration |

### Bearer vs x402 — at a glance

```typescript
// Bearer (existing) — pre-funded agent
const bearer = new LLM4AgentsClient({ apiKey: 'sk-proxy-...' })

// x402 walk-up — pay per call from a wallet
import { privateKeyToAccount } from 'viem/accounts'
import { viemAccountToSigner } from '@llmforagents/sdk'

const account = privateKeyToAccount('0xYOUR_PRIVATE_KEY')
const x402 = new LLM4AgentsClient({
  apiKey: '',                                    // not used in x402 mode
  payment: {
    mode: 'x402',
    signer: viemAccountToSigner(account),
    network: 'base-sepolia',                     // or 'base' for mainnet
  },
})

// Same API surface — the SDK probes the proxy for a 402, signs an
// EIP-3009 authorization, and retries with X-PAYMENT automatically.
const res = await x402.chat.completions.create({
  model: 'openai/gpt-4o-mini',
  messages: [{ role: 'user', content: 'Hello' }],
})
```

### Custom signers (no viem dependency)

If you don't want to add `viem`, implement the `Signer` interface yourself —
the SDK ships a `Signer` Port (Ports & Adapters) so any wallet stack works
(ethers, hardware wallets, MPC, AWS KMS, …):

```typescript
import type { Signer } from '@llmforagents/sdk'

const customSigner: Signer = {
  address: '0xYourAddress...',
  async signTypedData({ domain, types, primaryType, message }) {
    // Return a 0x-prefixed 65-byte signature.
    // Hardware wallet / KMS / ethers — your call.
    return '0x...'
  },
}

const client = new LLM4AgentsClient({
  apiKey: '',
  payment: { mode: 'x402', signer: customSigner, network: 'base' },
})
```

### Streaming receipts

x402-mode streaming responses end with a trailing SSE event after `[DONE]`
containing the on-chain settlement receipt. The `Conversation.stream()` helper
surfaces this as a typed event:

```typescript
const conv = x402.chat.conversation({ model: 'openai/gpt-4o-mini' })
for await (const ev of conv.stream('Tell me a joke')) {
  switch (ev.type) {
    case 'text':         process.stdout.write(ev.content); break
    case 'x402_receipt': console.log('\nsettled:', ev.transaction, ev.network); break
    case 'done':         console.log('\n', ev.response.usage); break
  }
}
```

For the lower-level `chat.completions.create()` API, pass `onX402Receipt`:

```typescript
const stream = await x402.chat.completions.create(
  { model: 'openai/gpt-4o-mini', messages: [...], stream: true },
  {
    onX402Receipt: (receipt) => {
      console.log(`settled ${receipt.amount} on ${receipt.network}: ${receipt.transaction}`)
    },
  },
)
```

### Lower-level helpers — `client.x402`

For advanced use cases (custom HTTP client, signing without sending, inspecting
the 402 response shape), the `client.x402` namespace exposes the building
blocks:

```typescript
// Probe the proxy and get the typed PaymentRequirements
const requirements = await x402.x402.probe()
console.log(requirements.maxAmountRequired, requirements.network)

// Probe + sign in one call — returns { paymentPayload, encodedHeader, requirements }
const signed = await x402.x402.sign()
// → signed.encodedHeader: base64-encoded X-PAYMENT value, ready to attach to a fetch()
// → signed.paymentPayload: the parsed PaymentPayload (typed, useful for logging/debugging)
// → signed.requirements: the proxy-advertised requirements the signature is bound to

// Sign against caller-supplied requirements (no HTTP) — useful for testing
// or batching signatures
const signed2 = await x402.x402.signFromRequirements(requirements)
```

### Error handling

When the proxy rejects payment (signature invalid, nonce reused, etc.) the SDK
throws `X402PaymentRequiredError` carrying the typed requirements so the caller
can re-sign with a different amount or network:

```typescript
import { X402PaymentRequiredError } from '@llmforagents/sdk'

try {
  await x402.chat.completions.create({ ... })
} catch (err) {
  if (err instanceof X402PaymentRequiredError) {
    console.error('Payment rejected. accepted offers:', err.paymentRequirements)
    console.error('x402 version:', err.x402Version)
  }
}
```

> **Networks:** `'base'` (mainnet, USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`)
> and `'base-sepolia'` (testnet, USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e`)
> are currently supported. The USDC EIP-712 domain name differs between them
> (`USD Coin` vs `USDC`); `viemAccountToSigner` handles this automatically.

> **Endpoints accepting x402** (signed per-call USDC):
> - `POST /v1/chat/completions` — chat with any model (per-token signed upper bound)
> - `POST /v1/scrape/{markdown,fetch_html,links,screenshot,pdf,extract}` — one-shot scraping
> - `POST /v1/search/{google,news,maps,batch}` — Google search (Serper)
> - `POST /v1/image/{generate,edit,analyze}` — image generation / edit / vision
>
> Per-call x402 prices are seeded ~10% below x402engine.app reference rates
> (e.g. scrape markdown ~$0.0045, screenshot ~$0.009, image gen ~$0.0135-$0.045).
> Prices are admin-editable from the operator panel without redeploy.
>
> Browser sessions (`session_*`) and other endpoints (`/v1/embeddings`,
> `/api/v1/wallets/*`, etc.) stay **Bearer-only** — sessions are
> pre-deposit by design.

### REST scrape / search / image with x402

The same `payment: { mode: 'x402', signer, network }` client config
that works for chat completions also works for the MCP REST surface.
Use the bundled MCP client methods if you prefer the JSON-RPC API; use
fetch / a direct HTTP client for the REST surface:

```typescript
import { LLM4AgentsClient } from '@llmforagents/sdk'
import { privateKeyToAccount } from 'viem/accounts'
import { viemAccountToSigner } from '@llmforagents/sdk'

const x402 = new LLM4AgentsClient({
  apiKey: '',
  payment: {
    mode: 'x402',
    signer: viemAccountToSigner(privateKeyToAccount('0xYOUR_KEY')),
    network: 'base-sepolia',
  },
})

// Probe + sign + retry handled automatically by the transport
const markdown = await x402.x402.sign().then((signed) =>
  fetch('https://api.llm4agents.com/v1/scrape/markdown', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-payment': signed.encodedHeader },
    body: JSON.stringify({ url: 'https://example.com' }),
  }).then((r) => r.json()),
)
```

The MCP tools accessor (`client.tools.scraper.markdown(...)` etc.)
currently uses Bearer auth via the MCP transport; the REST surface
above is the path for walk-up.

### Roadmap — server-side x402

Today the SDK is **client-only**: it signs `X-PAYMENT` headers so an agent
can pay for outbound services. The mirror direction (an agent serving its
own paywalled endpoint and receiving x402 payments from third parties) is
**not implemented** and not on the v2.x roadmap.

If you want to monetize your agent with x402, use a server library directly:

| Stack | Library |
|---|---|
| Hono (Cloudflare Workers, Bun, Deno, Node) | [`@x402/hono`](https://www.npmjs.com/package/@x402/hono) |
| Express | [`x402-express`](https://www.npmjs.com/package/x402-express) |
| Any framework (low-level, JWT-auth'd CDP facilitator) | [`@coinbase/x402`](https://www.npmjs.com/package/@coinbase/x402) |
| Other stacks | see the [x402 reference servers](https://github.com/x402-foundation/x402#servers) |

If a first-class `@llmforagents/sdk-server` (verify/settle/middleware
helpers around `@coinbase/x402` with llm4agents-flavoured defaults) would
help your use case, open an issue at
[`llmforagents/sdk`](https://github.com/llmforagents/sdk/issues).

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

## Workspace tools

Every authenticated agent gets a private workspace backed by Cloudflare R2.
Files are billed per-MB on upload (covering 1 day of storage) and per-day
afterwards; downloads are billed per-MB. The same tools work with Bearer
auth and with x402 walk-up.

### Tools

| Tool | Purpose |
|---|---|
| `workspace.create()` | Idempotent — confirm the workspace exists. |
| `workspace.list({ prefix?, limit? })` | List files. Free, rate-limited (60/min). |
| `workspace.stat({ filename })` | Get one file's metadata. Free, rate-limited. |
| `workspace.delete({ filename })` | Delete a file (no storage refund). Free, rate-limited. |
| `workspace.upload({ filename, content_base64, days_to_store, content_type? })` | Inline upload, ≤10 MB. Billed per-MB + storage days. |
| `workspace.uploadInit({ filename, size_bytes, days_to_store, content_type? })` | Start a large upload. Returns `{ upload_id, put_url, expires_at, max_bytes }`. Reserves cost. |
| `workspace.uploadFinalize({ upload_id })` | Confirm the PUT and settle billing. Must be called within 15 min of init. |
| `workspace.download({ filename, format?: 'inline'\|'url', url_ttl_minutes? })` | Inline returns base64 (≤10 MB). URL returns a **single-use** proxied download URL valid 1-15 min — billed at issuance, streams through our worker (we never expose direct R2 URLs to keep per-download billing accurate). |
| `workspace.extend({ filename, additional_days })` | Extend storage on an existing file. |
| `workspace.copy({ source_filename, dest_filename, days_to_store })` | Server-side copy. Billed for destination storage only. |

### Pricing

| Operation | Price | $/GB equivalent |
|---|---|---|
| Upload base | 0.01¢/MB (min 1¢) | $0.10/GB |
| Storage | 0.0001¢/MB/day | ~$0.03/GB-month |
| Download | 0.004¢/MB (min 1¢) | $0.04/GB |
| Storage extension | 0.0001¢/MB/day | ~$0.03/GB-month |
| List / stat / delete / create | Free, 60 req/min | — |

x402 walk-up rates are ~10% lower per-MB.

**Note:** Downloads never expose direct R2 URLs — both `inline` and `url` modes route bytes through our worker so per-download billing is enforced.

### Quick example (TypeScript SDK)

```ts
import { LLM4AgentsClient } from '@llmforagents/sdk';

const client = new LLM4AgentsClient({ apiKey: process.env.LLM4AGENTS_API_KEY! });

// Upload a small file
await client.tools.workspace.upload({
  filename: 'scrapes/page-1.md',
  content_base64: Buffer.from('# Hello\n').toString('base64'),
  days_to_store: 7,
  content_type: 'text/markdown',
});

// List files — result.text is the JSON-stringified response from the MCP tool
const listResult = await client.tools.workspace.list({ prefix: 'scrapes/' });
const { files } = JSON.parse(listResult.text);

// Get a one-time proxied URL — useful when forwarding bytes to a third party
// (email attachment, frontend hand-off, etc.). The URL is single-use: the
// second hit returns 410. The agent is billed at issuance.
const dlResult = await client.tools.workspace.download({
  filename: 'scrapes/page-1.md',
  format: 'url',
  url_ttl_minutes: 5,
});
const { download_url } = JSON.parse(dlResult.text);
// Hand `download_url` to whoever needs the bytes — they GET it once.
```

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
  apiKey:  'sk-proxy-...',                          // required for Bearer; empty in x402 mode
  baseUrl: 'https://api.llm4agents.com',            // optional
  mcpUrl:  'https://mcp.llm4agents.com/mcp',        // optional
  timeout: 30_000,                                  // optional, ms, default 30s
  payment: { mode: 'bearer' },                      // optional, default; or { mode: 'x402', signer, network? }
})
```

## What's New in v2.6

- **`Conversation` accepts `tool_choice`** — Force tool selection on round 1 only;
  reverts to `'auto'` for subsequent rounds so the model can summarize tool results
  naturally without looping. Critical for agent-routing patterns where the model
  would otherwise emit JSON-as-text instead of using the tool_calls API. See
  [Conversation with Tools](#conversation-with-tools).

## What's New in v2.5

- **Workspace tools (NEW)** — Private R2-backed file storage per agent. 10 new MCP tools for upload (inline
  and pre-signed), download (inline or signed URL), list, stat, extend, copy, and
  delete. Works with Bearer and x402. See [Workspace tools](#workspace-tools).
- **x402 walk-up payment mode** — pay per-request from a wallet on `/v1/chat/completions` without
  registering an agent. Pass `payment: { mode: 'x402', signer, network }` to the client constructor.
  Supports both `viem.Account` (via `viemAccountToSigner`) and any custom `Signer` implementation
  (ethers, KMS, hardware wallets) thanks to the Ports & Adapters design.
- Streaming responses emit a typed `x402_receipt` event after `[DONE]`, surfacing the on-chain
  settlement receipt (`transaction`, `network`, `amount`, `payer`) to `conv.stream()` consumers
  and the `onX402Receipt` callback on `chat.completions.create()`.
- New `client.x402` namespace — `probe(path, body)`, `sign(requirements)`, and
  `signFromRequirements(req)` helpers for low-level integrations.
- New exports: `X402PaymentRequiredError`, `viemAccountToSigner`,
  `buildTransferWithAuthorizationTypedData`, `generateNonce`, `signFromRequirements`,
  `encodePaymentHeader`, `decodePaymentRequiredHeader`, `pickSupportedRequirements`,
  `USDC_ADDRESS_BY_NETWORK`, `USDC_DOMAIN_NAME_BY_NETWORK`, `X402_CAIP2_BY_NETWORK`,
  `TRANSFER_WITH_AUTHORIZATION_TYPES`, and types `Signer`, `PaymentConfig`,
  `PaymentRequirements`, `PaymentPayload`, `X402Network`, `X402Receipt`.
- **x402 allowlist extended** to the MCP REST surface — clients in x402
  mode can now hit `/v1/scrape/*`, `/v1/search/*`, and `/v1/image/*` in
  addition to chat. Prices are admin-editable in cents from the
  operator panel (parallel `value` for balance / `x402_value` for
  walk-up per tool).

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
