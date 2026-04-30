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
  readonly headers: Headers;
}

export interface CompletionOptions {
  readonly signal?: AbortSignal | undefined;
  readonly onMeta?: ((meta: ResponseMeta) => void) | undefined;
}

export type StreamEvent =
  | { readonly type: 'text'; readonly content: string }
  | { readonly type: 'reasoning'; readonly content: string }
  | { readonly type: 'meta'; readonly meta: ResponseMeta }
  | { readonly type: 'tool_start'; readonly name: string; readonly args: Readonly<Record<string, unknown>> }
  | { readonly type: 'tool_end'; readonly name: string; readonly result: McpToolResult; readonly durationMs: number }
  | { readonly type: 'fallback'; readonly reason: 'tools_ignored'; readonly model: string }
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
  readonly usage: { readonly promptTokens: number; readonly completionTokens: number; readonly totalTokens: number };
}

export interface ConversationOptions {
  readonly model: string;
  readonly system?: string | undefined;
  readonly tools?: Tools | undefined;
  readonly history?: readonly ChatMessage[] | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly onToolCall?: ((name: string, args: Readonly<Record<string, unknown>>) => boolean | Promise<boolean>) | undefined;
  readonly onToolResult?: ((name: string, result: McpToolResult) => void | Promise<void>) | undefined;
  readonly maxToolRounds?: number | undefined;
  readonly onRoundMeta?: ((meta: ResponseMeta) => void) | undefined;
  readonly onToolsIgnored?: ((model: string) => void) | undefined;
  readonly enablePromptToolFallback?: boolean | undefined;
}
