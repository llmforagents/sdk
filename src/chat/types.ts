import type { ToolDefinition, McpToolResult } from '../tools/types.js';
import type { Tools } from '../tools/tools.js';

export interface TextContentPart {
  readonly type: 'text';
  readonly text: string;
}

export interface ImageUrlContentPart {
  readonly type: 'image_url';
  readonly image_url: { readonly url: string };
}

export type ContentPart = TextContentPart | ImageUrlContentPart;

export interface ChatMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  readonly content: string | readonly ContentPart[] | null;
  readonly tool_calls?: readonly ToolCall[] | undefined;
  readonly tool_call_id?: string | undefined;
  // Defense in depth: deprecated in OpenAI v2 spec but accepted by Google/legacy
  // OpenAI when tool_call_id is missing or rejected by the provider.
  readonly name?: string | undefined;
}

export interface ToolCall {
  readonly id: string;
  readonly type: 'function';
  readonly function: {
    readonly name: string;
    readonly arguments: string;
  };
}

export type ToolChoice =
  | 'none'
  | 'auto'
  | 'required'
  | { readonly type: 'function'; readonly function: { readonly name: string } };

// Model selection — mutually exclusive, enforced at compile time
type ModelSpec =
  | { readonly model: string; readonly models?: undefined }
  | { readonly models: readonly string[]; readonly model?: undefined };

export type ChatCompletionParams = ModelSpec & {
  readonly messages: readonly ChatMessage[];
  readonly temperature?: number | undefined;
  readonly max_tokens?: number | undefined;
  readonly tools?: readonly ToolDefinition[] | undefined;
  readonly stream?: boolean | undefined;
  readonly tool_choice?: ToolChoice | undefined;
  readonly reasoning?: boolean | undefined;
  readonly include_reasoning?: boolean | undefined;
};

export interface ChatChoice {
  readonly index: number;
  readonly message: ChatMessage;
  readonly finish_reason: string;
}

export interface ChatUsage {
  readonly prompt_tokens: number;
  readonly completion_tokens: number;
  readonly total_tokens?: number | undefined;
  readonly reasoning_tokens?: number | undefined;
  /**
   * Cost of the round in USD, as a float. Present on the terminating SSE
   * chunk of streaming responses (the proxy embeds it in `usage.cost`); the
   * non-streaming path receives the same value via the `x-cost-usd-cents`
   * response header instead. Streaming consumers should rely on
   * `ResponseMeta.costUsdCents` (which the SDK populates from this field
   * for streaming responses) rather than reading this directly.
   */
  readonly cost?: number | undefined;
}

export interface ChatResponse {
  readonly id: string;
  readonly choices: readonly ChatChoice[];
  readonly usage: ChatUsage;
  readonly model: string;
}

export interface StreamDelta {
  readonly role?: string | undefined;
  readonly content?: string | undefined;
  readonly reasoning?: string | undefined;
  readonly tool_calls?: readonly {
    readonly index: number;
    readonly id?: string | undefined;
    readonly type?: string | undefined;
    readonly function?: {
      readonly name?: string | undefined;
      readonly arguments?: string | undefined;
    } | undefined;
  }[] | undefined;
}

export interface StreamChunk {
  readonly id: string;
  readonly choices: readonly {
    readonly index: number;
    readonly delta: StreamDelta;
    readonly finish_reason: string | null;
  }[];
  readonly usage?: ChatUsage | undefined;
  readonly model?: string | undefined;
}

export interface ResponseMeta {
  readonly requestId: string | undefined;
  readonly modelUsed: string | undefined;
  readonly costUsdCents: number | undefined;
  readonly balanceRemainingCents: number | undefined;
  readonly tokensInput: number | undefined;
  readonly tokensOutput: number | undefined;
  readonly tokensReasoning: number | undefined;
  readonly headers: Headers;
}

export interface FinalUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
  readonly reasoningTokens?: number | undefined;
}

export interface CompletionOptions {
  readonly signal?: AbortSignal | undefined;
  readonly onMeta?: ((meta: ResponseMeta) => void) | undefined;
  readonly onFinalUsage?: ((usage: FinalUsage) => void) | undefined;
  /**
   * Fires when the proxy emits a trailing `event: x402-receipt` chunk in
   * the SSE stream (only present in x402 walk-up mode). Carries the
   * on-chain settlement transaction hash, network, amount, and payer.
   */
  readonly onX402Receipt?: ((receipt: import('../x402/types.js').X402Receipt) => void) | undefined;
}

export type StreamEvent =
  | { readonly type: 'text'; readonly content: string }
  | { readonly type: 'reasoning'; readonly content: string }
  | { readonly type: 'meta'; readonly meta: ResponseMeta }
  | { readonly type: 'tool_start'; readonly name: string; readonly args: Readonly<Record<string, unknown>> }
  | { readonly type: 'tool_end'; readonly name: string; readonly result: McpToolResult; readonly durationMs: number }
  | { readonly type: 'fallback'; readonly reason: 'tools_ignored'; readonly model: string }
  | {
      readonly type: 'x402_receipt';
      readonly transaction: string;
      readonly network: string;
      readonly amount: string;
      readonly payer: string;
    }
  | { readonly type: 'done'; readonly response: ConversationResponse };

export interface ToolCallRecord {
  readonly name: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly result: McpToolResult;
  readonly durationMs: number;
}

export interface ConversationResponse {
  readonly content: string;
  readonly toolCalls: readonly ToolCallRecord[];
  readonly usage: {
    readonly promptTokens: number;
    readonly completionTokens: number;
    readonly totalTokens: number;
    readonly reasoningTokens?: number | undefined;
  };
}

export interface CustomTools {
  getDefinitions(): Promise<readonly ToolDefinition[]>;
  call(name: string, args: Readonly<Record<string, unknown>>, signal?: AbortSignal): Promise<unknown>;
}

export interface ConversationOptions {
  readonly model: string;
  readonly system?: string | undefined;
  readonly tools?: Tools | undefined;
  readonly customTools?: CustomTools | undefined;
  readonly history?: readonly ChatMessage[] | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly onToolCall?: ((name: string, args: Readonly<Record<string, unknown>>) => boolean | Promise<boolean>) | undefined;
  readonly onToolResult?: ((name: string, result: McpToolResult) => void | Promise<void>) | undefined;
  readonly maxToolRounds?: number | undefined;
  readonly onRoundMeta?: ((meta: ResponseMeta) => void) | undefined;
  readonly onToolsIgnored?: ((model: string) => void) | undefined;
  readonly enablePromptToolFallback?: boolean | undefined;
  /**
   * Controls tool selection on the FIRST round of the conversation. After the
   * first round the SDK reverts to `'auto'` regardless of this value, so the
   * model can still wrap up with plain text once its forced tool has returned.
   * Without this auto-revert, `'required'` on every round forces the model to
   * keep tool-calling forever and the conversation hits `maxToolRounds`.
   *
   * Typical agent-routing pattern: pass `'required'` so the model can't sneak
   * a JSON-as-text fallback past you on round 1, then let it summarize the
   * tool result naturally on round 2. Anthropic and OpenAI both accept the
   * same `'auto' | 'required' | 'none'` enum here; passing `{type: 'function',
   * function: {name: 'foo'}}` forces a specific named tool on round 1.
   */
  readonly tool_choice?: ToolChoice | undefined;
}
