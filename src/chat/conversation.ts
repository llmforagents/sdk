import type { HttpTransport } from '../transport/http.js';
import type { Tools } from '../tools/tools.js';
import { LLM4AgentsError } from '../errors.js';
import { ChatCompletions } from './completions.js';
import type {
  ChatMessage,
  ChatResponse,
  ConversationOptions,
  ConversationResponse,
  ToolCallRecord,
  ToolCall,
  StreamEvent,
} from './types.js';

const DEFAULT_MAX_TOOL_ROUNDS = 10;

export class Conversation {
  private readonly model: string;
  private readonly system: string | undefined;
  private readonly tools: Tools | undefined;
  private readonly onToolCall: ConversationOptions['onToolCall'];
  private readonly onToolResult: ConversationOptions['onToolResult'];
  private readonly maxToolRounds: number;
  private history: ChatMessage[];

  constructor(
    private readonly http: HttpTransport,
    opts: ConversationOptions,
  ) {
    this.model = opts.model;
    this.system = opts.system;
    this.tools = opts.tools;
    this.onToolCall = opts.onToolCall;
    this.onToolResult = opts.onToolResult;
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

      const response = await this.http.post<ChatResponse>('/v1/chat/completions', {
        model: this.model,
        messages,
        ...(toolDefs && toolDefs.length > 0 ? { tools: toolDefs } : {}),
      });

      totalPromptTokens += response.usage.prompt_tokens;
      totalCompletionTokens += response.usage.completion_tokens;

      const choice = response.choices[0];
      if (!choice) {
        throw new LLM4AgentsError('Empty response from LLM', 'api_error', undefined, undefined);
      }

      const assistantMessage = choice.message;
      this.history.push(assistantMessage);

      if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
        return {
          content: assistantMessage.content ?? '',
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
      });

      // Accumulate the streamed response
      let streamedContent = '';
      const pendingToolCalls: Map<number, { id: string; name: string; args: string }> = new Map();
      let chunkUsage: { prompt_tokens: number; completion_tokens: number } | undefined;

      for await (const chunk of chunks) {
        const firstChoice = chunk.choices[0];
        const delta = firstChoice?.delta;
        if (!delta) continue;

        // Text content
        if (delta.content) {
          streamedContent += delta.content;
          fullContent += delta.content;
          yield { type: 'text', content: delta.content };
        }

        // Tool calls (streamed incrementally)
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

      // Build assistant message for history
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

      // No tool calls — done
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

      // Tool loop
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
            this.history.push({ role: 'tool', content: 'cancelled by hook', tool_call_id: toolCall.id });
            allToolCalls.push({ name, args, result: 'cancelled by hook', durationMs: 0 });
            yield { type: 'tool_end', name, result: 'cancelled by hook', durationMs: 0 };
            continue;
          }
        }

        const start = Date.now();
        let result: string;
        try {
          result = this.tools ? await this.tools.call(name, args) : `Tool ${name} not available`;
        } catch (err) {
          result = err instanceof Error ? err.message : `Tool ${name} failed`;
        }
        const durationMs = Date.now() - start;

        if (this.onToolResult) {
          await this.onToolResult(name, result);
        }

        this.history.push({ role: 'tool', content: result, tool_call_id: toolCall.id });
        allToolCalls.push({ name, args, result, durationMs });
        yield { type: 'tool_end', name, result, durationMs };
      }

      // Reset fullContent for the next LLM round (tool results -> new text)
      fullContent = '';
    }
  }

  clear(): void {
    this.history = [];
  }

  fork(): Conversation {
    const forked = new Conversation(this.http, {
      model: this.model,
      system: this.system,
      tools: this.tools,
      onToolCall: this.onToolCall,
      onToolResult: this.onToolResult,
      maxToolRounds: this.maxToolRounds,
      history: [...this.history],
    });
    return forked;
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
        this.history.push({
          role: 'tool',
          content: 'cancelled by hook',
          tool_call_id: toolCall.id,
        });
        return { name, args, result: 'cancelled by hook', durationMs: 0 };
      }
    }

    const start = Date.now();
    let result: string;
    try {
      result = this.tools ? await this.tools.call(name, args) : `Tool ${name} not available`;
    } catch (err) {
      result = err instanceof Error ? err.message : `Tool ${name} failed`;
    }
    const durationMs = Date.now() - start;

    if (this.onToolResult) {
      await this.onToolResult(name, result);
    }

    this.history.push({
      role: 'tool',
      content: result,
      tool_call_id: toolCall.id,
    });

    return { name, args, result, durationMs };
  }
}
