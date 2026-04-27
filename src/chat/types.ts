import type { ToolDefinition } from '../tools/types.js';
import type { Tools } from '../tools/tools.js';

export interface ChatMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  readonly content: string | null;
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

export interface ChatCompletionParams {
  readonly model: string;
  readonly messages: readonly ChatMessage[];
  readonly temperature?: number | undefined;
  readonly max_tokens?: number | undefined;
  readonly tools?: readonly ToolDefinition[] | undefined;
  readonly stream?: boolean | undefined;
}

export interface ChatChoice {
  readonly index: number;
  readonly message: ChatMessage;
  readonly finish_reason: string;
}

export interface ChatUsage {
  readonly prompt_tokens: number;
  readonly completion_tokens: number;
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

export type StreamEvent =
  | { readonly type: 'text'; readonly content: string }
  | { readonly type: 'tool_start'; readonly name: string; readonly args: Readonly<Record<string, unknown>> }
  | { readonly type: 'tool_end'; readonly name: string; readonly result: string; readonly durationMs: number }
  | { readonly type: 'done'; readonly response: ConversationResponse };

export interface ToolCallRecord {
  readonly name: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly result: string;
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
  readonly onToolCall?: ((name: string, args: Readonly<Record<string, unknown>>) => boolean | Promise<boolean>) | undefined;
  readonly onToolResult?: ((name: string, result: string) => void | Promise<void>) | undefined;
  readonly maxToolRounds?: number | undefined;
}
