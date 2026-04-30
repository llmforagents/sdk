import type { HttpTransport } from '../transport/http.js';
import type { Tools } from '../tools/tools.js';
import type { McpToolResult, McpTextContent } from '../tools/types.js';
import { LLM4AgentsError } from '../errors.js';
import { ChatCompletions } from './completions.js';
import type {
  ChatMessage,
  ChatResponse,
  ConversationOptions,
  ConversationResponse,
  ResponseMeta,
  ToolCallRecord,
  ToolCall,
  StreamEvent,
} from './types.js';

const DEFAULT_MAX_TOOL_ROUNDS = 10;

function mkTextResult(text: string): McpToolResult {
  const content: McpTextContent = { type: 'text', text };
  return { content: [content], text, raw: [] };
}

export class Conversation {
  private readonly model: string;
  private readonly system: string | undefined;
  private readonly tools: Tools | undefined;
  private readonly signal: AbortSignal | undefined;
  private readonly onToolCall: ConversationOptions['onToolCall'];
  private readonly onToolResult: ConversationOptions['onToolResult'];
  private readonly onRoundMeta: ConversationOptions['onRoundMeta'];
  private readonly maxToolRounds: number;
  private history: ChatMessage[];

  constructor(
    private readonly http: HttpTransport,
    opts: ConversationOptions,
  ) {
    this.model = opts.model;
    this.system = opts.system;
    this.tools = opts.tools;
    this.signal = opts.signal;
    this.onToolCall = opts.onToolCall;
    this.onToolResult = opts.onToolResult;
    this.onRoundMeta = opts.onRoundMeta;
    this.maxToolRounds = opts.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS;
    this.history = opts.history ? [...opts.history] : [];
  }

  get messages(): readonly ChatMessage[] {
    return this.history;
  }

  async say(content: string): Promise<ConversationResponse> {
    this.history.push({ role: 'user', content });

    const allToolCalls: ToolCallRecord[] = [];
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let roundCount = 0;

    while (true) {
      const toolDefs = this.tools ? await this.tools.getDefinitions() : undefined;
      const messages = this.buildMessages();

      const { data: response, headers } = await this.http.postWithMeta<ChatResponse>('/v1/chat/completions', {
        model: this.model,
        messages,
        ...(toolDefs && toolDefs.length > 0 ? { tools: toolDefs } : {}),
      }, this.signal);

      if (this.onRoundMeta) {
        this.onRoundMeta(buildRoundMeta(headers));
      }

      totalPromptTokens += response.usage.prompt_tokens;
      totalCompletionTokens += response.usage.completion_tokens;

      const choice = response.choices[0];
      if (!choice) {
        throw new LLM4AgentsError('Empty response from LLM', 'api_error', undefined, undefined);
      }

      const assistantMessage = choice.message;
      this.history.push(assistantMessage);

      if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
        const rawContent = assistantMessage.content;
        const contentStr = typeof rawContent === 'string' ? rawContent : '';
        return {
          content: contentStr,
          toolCalls: allToolCalls,
          usage: {
            promptTokens: totalPromptTokens,
            completionTokens: totalCompletionTokens,
            totalTokens: totalPromptTokens + totalCompletionTokens,
          },
        };
      }

      roundCount++;
      if (roundCount > this.maxToolRounds) {
        throw new LLM4AgentsError(
          `Tool loop exceeded ${this.maxToolRounds} rounds`,
          'tool_loop_limit',
          undefined,
          undefined,
        );
      }

      for (const toolCall of assistantMessage.tool_calls) {
        const record = await this.executeToolCall(toolCall);
        allToolCalls.push(record);
      }
    }
  }

  async *stream(content: string): AsyncIterable<StreamEvent> {
    this.history.push({ role: 'user', content });

    const allToolCalls: ToolCallRecord[] = [];
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let roundCount = 0;
    let fullContent = '';
    const completions = new ChatCompletions(this.http);

    while (true) {
      const toolDefs = this.tools ? await this.tools.getDefinitions() : undefined;
      const messages = this.buildMessages();

      const chunks = await completions.create({
        model: this.model,
        messages,
        stream: true,
        ...(toolDefs && toolDefs.length > 0 ? { tools: toolDefs } : {}),
      }, this.signal ? { signal: this.signal } : undefined);

      let streamedContent = '';
      const pendingToolCalls: Map<number, { id: string; name: string; args: string }> = new Map();
      let chunkUsage: { prompt_tokens: number; completion_tokens: number } | undefined;

      for await (const chunk of chunks) {
        const firstChoice = chunk.choices[0];
        const delta = firstChoice?.delta;
        if (!delta) continue;

        if (delta.reasoning) {
          yield { type: 'reasoning', content: delta.reasoning };
        }

        if (delta.content) {
          streamedContent += delta.content;
          fullContent += delta.content;
          yield { type: 'text', content: delta.content };
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const existing = pendingToolCalls.get(tc.index);
            if (!existing) {
              pendingToolCalls.set(tc.index, {
                id: tc.id ?? '',
                name: tc.function?.name ?? '',
                args: tc.function?.arguments ?? '',
              });
            } else {
              if (tc.id) existing.id = tc.id;
              if (tc.function?.name) existing.name = tc.function.name;
              if (tc.function?.arguments !== undefined) existing.args += tc.function.arguments;
            }
          }
        }

        if (chunk.usage) {
          chunkUsage = chunk.usage;
        }
      }

      totalPromptTokens += chunkUsage?.prompt_tokens ?? 0;
      totalCompletionTokens += chunkUsage?.completion_tokens ?? 0;

      const toolCallsArray: ToolCall[] = [...pendingToolCalls.values()].map((tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: { name: tc.name, arguments: tc.args },
      }));

      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content: streamedContent || null,
        ...(toolCallsArray.length > 0 ? { tool_calls: toolCallsArray } : {}),
      };
      this.history.push(assistantMessage);

      if (toolCallsArray.length === 0) {
        yield {
          type: 'done',
          response: {
            content: fullContent,
            toolCalls: allToolCalls,
            usage: {
              promptTokens: totalPromptTokens,
              completionTokens: totalCompletionTokens,
              totalTokens: totalPromptTokens + totalCompletionTokens,
            },
          },
        };
        return;
      }

      roundCount++;
      if (roundCount > this.maxToolRounds) {
        throw new LLM4AgentsError(
          `Tool loop exceeded ${this.maxToolRounds} rounds`,
          'tool_loop_limit',
          undefined,
          undefined,
        );
      }

      for (const toolCall of toolCallsArray) {
        const name = toolCall.function.name;
        let args: Readonly<Record<string, unknown>>;
        try {
          args = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
        } catch {
          args = {};
        }

        yield { type: 'tool_start', name, args };

        if (this.onToolCall) {
          const shouldProceed = await this.onToolCall(name, args);
          if (!shouldProceed) {
            const cancelledResult = mkTextResult('cancelled by hook');
            this.history.push({ role: 'tool', content: cancelledResult.text, tool_call_id: toolCall.id });
            allToolCalls.push({ name, args, result: cancelledResult, durationMs: 0 });
            yield { type: 'tool_end', name, result: cancelledResult, durationMs: 0 };
            continue;
          }
        }

        const start = Date.now();
        let result: McpToolResult;
        try {
          result = this.tools
            ? await this.tools.call(name, args, this.signal)
            : mkTextResult(`Tool ${name} not available`);
        } catch (err) {
          result = mkTextResult(err instanceof Error ? err.message : `Tool ${name} failed`);
        }
        const durationMs = Date.now() - start;

        if (this.onToolResult) {
          await this.onToolResult(name, result);
        }

        this.history.push({ role: 'tool', content: result.text, tool_call_id: toolCall.id });
        allToolCalls.push({ name, args, result, durationMs });
        yield { type: 'tool_end', name, result, durationMs };
      }

      fullContent = '';
    }
  }

  clear(): void {
    this.history = [];
  }

  fork(): Conversation {
    return new Conversation(this.http, {
      model: this.model,
      system: this.system,
      tools: this.tools,
      signal: this.signal,
      onToolCall: this.onToolCall,
      onToolResult: this.onToolResult,
      maxToolRounds: this.maxToolRounds,
      onRoundMeta: this.onRoundMeta,
      history: [...this.history],
    });
  }

  private buildMessages(): ChatMessage[] {
    const messages: ChatMessage[] = [];
    if (this.system) {
      messages.push({ role: 'system', content: this.system });
    }
    messages.push(...this.history);
    return messages;
  }

  private async executeToolCall(toolCall: ToolCall): Promise<ToolCallRecord> {
    const name = toolCall.function.name;
    let args: Readonly<Record<string, unknown>>;
    try {
      args = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
    } catch {
      args = {};
    }

    if (this.onToolCall) {
      const shouldProceed = await this.onToolCall(name, args);
      if (!shouldProceed) {
        const cancelledResult = mkTextResult('cancelled by hook');
        this.history.push({
          role: 'tool',
          content: cancelledResult.text,
          tool_call_id: toolCall.id,
        });
        return { name, args, result: cancelledResult, durationMs: 0 };
      }
    }

    const start = Date.now();
    let result: McpToolResult;
    try {
      result = this.tools
        ? await this.tools.call(name, args, this.signal)
        : mkTextResult(`Tool ${name} not available`);
    } catch (err) {
      result = mkTextResult(err instanceof Error ? err.message : `Tool ${name} failed`);
    }
    const durationMs = Date.now() - start;

    if (this.onToolResult) {
      await this.onToolResult(name, result);
    }

    this.history.push({
      role: 'tool',
      content: result.text,
      tool_call_id: toolCall.id,
    });

    return { name, args, result, durationMs };
  }
}

function buildRoundMeta(headers: Headers): ResponseMeta {
  const parseIntHeader = (name: string): number | undefined => {
    const val = headers.get(name);
    if (val === null) return undefined;
    const n = parseInt(val, 10);
    return isNaN(n) ? undefined : n;
  };
  return {
    requestId: headers.get('x-request-id') ?? undefined,
    modelUsed: headers.get('x-model-used') ?? undefined,
    costUsdCents: parseIntHeader('x-cost-usd-cents'),
    balanceRemainingCents: parseIntHeader('x-balance-remaining-cents'),
    tokensInput: parseIntHeader('x-tokens-input'),
    tokensOutput: parseIntHeader('x-tokens-output'),
    headers,
  };
}
