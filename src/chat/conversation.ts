import type { HttpTransport } from '../transport/http.js';
import type { Tools } from '../tools/tools.js';
import type { McpToolResult, McpTextContent } from '../tools/types.js';
import { LLM4AgentsError } from '../errors.js';
import { ChatCompletions } from './completions.js';
import { formatToolsForPrompt, parseToolCallsFromText } from './prompt-fallback.js';
import type {
  ChatMessage,
  ChatResponse,
  ConversationOptions,
  ConversationResponse,
  CustomTools,
  ResponseMeta,
  ToolCall,
  ToolCallRecord,
  ToolChoice,
  StreamEvent,
} from './types.js';

const DEFAULT_MAX_TOOL_ROUNDS = 10;

// Some providers (Google Gemini, certain Anthropic models via OpenRouter) return
// tool_calls without an `id`. Without one, the matching `role: 'tool'` reply
// has no `tool_call_id` and Google rejects the next round with HTTP 400 while
// Anthropic returns 500. Synthesize a stable id when missing.
function normalizeToolCalls(
  toolCalls: readonly ToolCall[],
  roundCount: number,
): ToolCall[] {
  return toolCalls.map((tc, i) => ({
    ...tc,
    id: tc.id && tc.id.length > 0 ? tc.id : `auto_${roundCount}_${i}_${Date.now()}`,
  }));
}

function mkTextResult(text: string): McpToolResult {
  const content: McpTextContent = { type: 'text', text };
  return { content: [content], text, raw: [] };
}

export class Conversation {
  private readonly model: string;
  private readonly system: string | undefined;
  private readonly tools: Tools | undefined;
  private readonly customTools: CustomTools | undefined;
  private readonly signal: AbortSignal | undefined;
  private readonly onToolCall: ConversationOptions['onToolCall'];
  private readonly onToolResult: ConversationOptions['onToolResult'];
  private readonly onRoundMeta: ConversationOptions['onRoundMeta'];
  private readonly onToolsIgnored: ConversationOptions['onToolsIgnored'];
  private readonly enablePromptToolFallback: boolean;
  private readonly maxToolRounds: number;
  // First-round-only tool selection. See `ConversationOptions.tool_choice`
  // for the rationale on why we don't propagate this to subsequent rounds.
  private readonly toolChoice: ToolChoice | undefined;
  private history: ChatMessage[];

  constructor(
    private readonly http: HttpTransport,
    opts: ConversationOptions,
  ) {
    this.model = opts.model;
    this.system = opts.system;
    this.tools = opts.tools;
    this.customTools = opts.customTools;
    this.signal = opts.signal;
    this.onToolCall = opts.onToolCall;
    this.onToolResult = opts.onToolResult;
    this.onRoundMeta = opts.onRoundMeta;
    this.onToolsIgnored = opts.onToolsIgnored;
    this.enablePromptToolFallback = opts.enablePromptToolFallback ?? false;
    this.maxToolRounds = opts.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS;
    this.toolChoice = opts.tool_choice;
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
    let totalReasoningTokens = 0;
    let roundCount = 0;

    while (true) {
      const mcpDefs = this.tools ? await this.tools.getDefinitions() : [];
      const customDefs = this.customTools ? await this.customTools.getDefinitions() : [];
      const allDefs = [...mcpDefs, ...customDefs];
      const toolDefs = allDefs.length > 0 ? allDefs : undefined;
      const messages = this.buildMessages();

      // First-round-only tool_choice — see ConversationOptions.tool_choice
      // for the auto-revert rationale.
      const effectiveToolChoice =
        roundCount === 0 ? this.toolChoice : undefined;
      const { data: response, headers } = await this.http.postWithMeta<ChatResponse>('/v1/chat/completions', {
        model: this.model,
        messages,
        ...(toolDefs && toolDefs.length > 0 ? { tools: toolDefs } : {}),
        ...(effectiveToolChoice !== undefined ? { tool_choice: effectiveToolChoice } : {}),
      }, this.signal);

      if (this.onRoundMeta) {
        this.onRoundMeta(buildRoundMeta(headers));
      }

      totalPromptTokens += response.usage.prompt_tokens;
      totalCompletionTokens += response.usage.completion_tokens;
      if (response.usage.reasoning_tokens !== undefined) {
        totalReasoningTokens += response.usage.reasoning_tokens;
      }

      const choice = response.choices[0];
      if (!choice) {
        throw new LLM4AgentsError('Empty response from LLM', 'api_error', undefined, undefined);
      }

      // Normalize content: some providers (OpenAI, Gemini) return content: null when
      // a message is purely tool_calls. Strict backend validators reject null on
      // subsequent rounds; coerce to '' so the next request stays valid.
      // Also normalize tool_calls.id: some providers omit it, which makes the
      // matching role: 'tool' reply lack tool_call_id and break the next round.
      const assistantMessage: ChatMessage = {
        ...choice.message,
        content: choice.message.content ?? '',
        ...(choice.message.tool_calls && choice.message.tool_calls.length > 0
          ? { tool_calls: normalizeToolCalls(choice.message.tool_calls, roundCount) }
          : {}),
      };
      this.history.push(assistantMessage);

      if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
        const ignoredTools = roundCount === 0 && toolDefs && toolDefs.length > 0;
        if (ignoredTools && this.onToolsIgnored) {
          this.onToolsIgnored(this.model);
        }

        // Prompt-mode fallback: retry round 0 with tools described in system prompt
        if (ignoredTools && this.enablePromptToolFallback) {
          const fallbackResult = await this.runPromptFallbackRound(toolDefs);
          totalPromptTokens += fallbackResult.usage.promptTokens;
          totalCompletionTokens += fallbackResult.usage.completionTokens;
          if (fallbackResult.usage.reasoningTokens !== undefined) {
            totalReasoningTokens += fallbackResult.usage.reasoningTokens;
          }

          if (fallbackResult.toolCalls.length > 0) {
            // Replace the ignored assistant message with the prompt-mode one
            this.history.pop(); // remove the failed first attempt
            this.history.push(fallbackResult.assistantMessage);

            for (const toolCall of fallbackResult.toolCalls) {
              const record = await this.executeToolCall(toolCall, customDefs);
              allToolCalls.push(record);
            }
            roundCount++;
            continue;
          }

          // Fallback also produced no tool calls — return prompt-mode text
          this.history.pop();
          this.history.push(fallbackResult.assistantMessage);
          return {
            content: fallbackResult.textWithoutBlocks,
            toolCalls: allToolCalls,
            usage: {
              promptTokens: totalPromptTokens,
              completionTokens: totalCompletionTokens,
              totalTokens: totalPromptTokens + totalCompletionTokens,
              ...(totalReasoningTokens > 0 ? { reasoningTokens: totalReasoningTokens } : {}),
            },
          };
        }

        const rawContent = assistantMessage.content;
        const contentStr = typeof rawContent === 'string' ? rawContent : '';
        return {
          content: contentStr,
          toolCalls: allToolCalls,
          usage: {
            promptTokens: totalPromptTokens,
            completionTokens: totalCompletionTokens,
            totalTokens: totalPromptTokens + totalCompletionTokens,
            ...(totalReasoningTokens > 0 ? { reasoningTokens: totalReasoningTokens } : {}),
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

      const seenThisRound = new Set<string>();
      for (const toolCall of assistantMessage.tool_calls) {
        const key = `${toolCall.function.name}:${toolCall.function.arguments}`;
        if (seenThisRound.has(key)) {
          // Skip execution but add a history entry so the LLM sees a tool result
          const firstRecord = [...allToolCalls].reverse().find((r) => r.name === toolCall.function.name);
          const text = firstRecord?.result.text ?? '';
          this.history.push({ role: 'tool', content: text, tool_call_id: toolCall.id, name: toolCall.function.name });
          continue;
        }
        seenThisRound.add(key);
        const record = await this.executeToolCall(toolCall, customDefs);
        allToolCalls.push(record);
      }

      // Image short-circuit: if any tool returned an image, stop looping
      const hasImage = allToolCalls.some((tc) =>
        tc.result.content.some((c) => c.type === 'image'),
      );
      if (hasImage) {
        return {
          content: '',
          toolCalls: allToolCalls,
          usage: {
            promptTokens: totalPromptTokens,
            completionTokens: totalCompletionTokens,
            totalTokens: totalPromptTokens + totalCompletionTokens,
            ...(totalReasoningTokens > 0 ? { reasoningTokens: totalReasoningTokens } : {}),
          },
        };
      }
    }
  }

  async *stream(content: string): AsyncIterable<StreamEvent> {
    this.history.push({ role: 'user', content });

    const allToolCalls: ToolCallRecord[] = [];
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let totalReasoningTokens = 0;
    let roundCount = 0;
    let fullContent = '';
    const completions = new ChatCompletions(this.http);

    while (true) {
      const mcpDefs = this.tools ? await this.tools.getDefinitions() : [];
      const customDefs = this.customTools ? await this.customTools.getDefinitions() : [];
      const allDefs = [...mcpDefs, ...customDefs];
      const toolDefs = allDefs.length > 0 ? allDefs : undefined;
      const messages = this.buildMessages();

      let roundMeta: ResponseMeta | undefined;
      // Captured by the parseSSE callback when the proxy emits a trailing
      // x402-receipt event (walk-up mode only). We yield it as a typed
      // event after the stream loop unwinds so consumers can correlate
      // the receipt with the chat content that was paid for.
      let receivedReceipt:
        | { transaction: string; network: string; amount: string; payer: string }
        | undefined;
      // First-round-only tool_choice — see ConversationOptions.tool_choice
      // for the auto-revert rationale.
      const effectiveToolChoice =
        roundCount === 0 ? this.toolChoice : undefined;
      const chunks = await completions.create({
        model: this.model,
        messages,
        stream: true,
        ...(toolDefs && toolDefs.length > 0 ? { tools: toolDefs } : {}),
        ...(effectiveToolChoice !== undefined ? { tool_choice: effectiveToolChoice } : {}),
      }, {
        signal: this.signal,
        onMeta: (meta) => { roundMeta = meta; },
        onX402Receipt: (receipt) => { receivedReceipt = receipt; },
      });

      let streamedContent = '';
      const pendingToolCalls: Map<number, { id: string; name: string; args: string }> = new Map();
      let chunkUsage: { prompt_tokens: number; completion_tokens: number; reasoning_tokens?: number | undefined } | undefined;

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
      if (chunkUsage?.reasoning_tokens !== undefined) {
        totalReasoningTokens += chunkUsage.reasoning_tokens;
      }

      if (roundMeta !== undefined) {
        yield { type: 'meta', meta: roundMeta };
        if (this.onRoundMeta) {
          this.onRoundMeta(roundMeta);
        }
      }

      const toolCallsArray: ToolCall[] = normalizeToolCalls(
        [...pendingToolCalls.values()].map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.name, arguments: tc.args },
        })),
        roundCount,
      );

      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content: streamedContent,
        ...(toolCallsArray.length > 0 ? { tool_calls: toolCallsArray } : {}),
      };
      this.history.push(assistantMessage);

      if (toolCallsArray.length === 0) {
        const ignoredTools = roundCount === 0 && toolDefs && toolDefs.length > 0;
        if (ignoredTools && this.onToolsIgnored) {
          this.onToolsIgnored(this.model);
        }

        // Prompt-mode fallback: retry round 0 with tools described in system prompt
        if (ignoredTools && this.enablePromptToolFallback) {
          yield { type: 'fallback', reason: 'tools_ignored', model: this.model };

          this.history.pop(); // remove the failed first attempt
          const fallbackResult = await this.runPromptFallbackRound(toolDefs);
          totalPromptTokens += fallbackResult.usage.promptTokens;
          totalCompletionTokens += fallbackResult.usage.completionTokens;
          if (fallbackResult.usage.reasoningTokens !== undefined) {
            totalReasoningTokens += fallbackResult.usage.reasoningTokens;
          }
          this.history.push(fallbackResult.assistantMessage);

          if (fallbackResult.toolCalls.length === 0) {
            yield { type: 'text', content: fallbackResult.textWithoutBlocks };
            if (receivedReceipt) yield { type: 'x402_receipt', ...receivedReceipt };
            yield {
              type: 'done',
              response: {
                content: fallbackResult.textWithoutBlocks,
                toolCalls: allToolCalls,
                usage: {
                  promptTokens: totalPromptTokens,
                  completionTokens: totalCompletionTokens,
                  totalTokens: totalPromptTokens + totalCompletionTokens,
                  ...(totalReasoningTokens > 0 ? { reasoningTokens: totalReasoningTokens } : {}),
                },
              },
            };
            return;
          }

          // Execute parsed tool calls and continue the loop
          for (const toolCall of fallbackResult.toolCalls) {
            const name = toolCall.function.name;
            let args: Readonly<Record<string, unknown>>;
            try {
              args = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
            } catch {
              args = {};
            }
            yield { type: 'tool_start', name, args };

            if (this.onToolCall) {
              const proceed = await this.onToolCall(name, args);
              if (!proceed) {
                const cancelled = mkTextResult('cancelled by hook');
                this.history.push({ role: 'tool', content: cancelled.text, tool_call_id: toolCall.id, name });
                allToolCalls.push({ name, args, result: cancelled, durationMs: 0 });
                yield { type: 'tool_end', name, result: cancelled, durationMs: 0 };
                continue;
              }
            }

            const start = Date.now();
            let result: McpToolResult;
            if (this.customTools !== undefined) {
              // customDefs already computed once per turn at the top of the loop
              if (customDefs.some((d) => d.function.name === name)) {
                const rawResult = await this.customTools.call(name, args, this.signal);
                const text = typeof rawResult === 'string'
                  ? rawResult
                  : rawResult === undefined || rawResult === null
                    ? ''
                    : JSON.stringify(rawResult);
                result = mkTextResult(text);
              } else if (this.tools !== undefined) {
                result = await this.tools.call(name, args, this.signal);
              } else {
                result = mkTextResult(`Tool ${name} not available`);
              }
            } else if (this.tools !== undefined) {
              result = await this.tools.call(name, args, this.signal);
            } else {
              result = mkTextResult(`Tool ${name} not available`);
            }
            const durationMs = Date.now() - start;

            if (this.onToolResult) {
              await this.onToolResult(name, result);
            }
            this.history.push({ role: 'tool', content: result.text, tool_call_id: toolCall.id, name });
            allToolCalls.push({ name, args, result, durationMs });
            yield { type: 'tool_end', name, result, durationMs };
          }

          roundCount++;
          fullContent = '';
          continue;
        }

        if (receivedReceipt) yield { type: 'x402_receipt', ...receivedReceipt };
        yield {
          type: 'done',
          response: {
            content: fullContent,
            toolCalls: allToolCalls,
            usage: {
              promptTokens: totalPromptTokens,
              completionTokens: totalCompletionTokens,
              totalTokens: totalPromptTokens + totalCompletionTokens,
              ...(totalReasoningTokens > 0 ? { reasoningTokens: totalReasoningTokens } : {}),
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

      const seenThisRound = new Set<string>();
      for (const toolCall of toolCallsArray) {
        const name = toolCall.function.name;
        let args: Readonly<Record<string, unknown>>;
        try {
          args = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
        } catch {
          args = {};
        }

        const key = `${name}:${toolCall.function.arguments}`;
        if (seenThisRound.has(key)) {
          // Skip execution but add a history entry so the LLM sees a tool result
          const firstRecord = [...allToolCalls].reverse().find((r) => r.name === name);
          const text = firstRecord?.result.text ?? '';
          this.history.push({ role: 'tool', content: text, tool_call_id: toolCall.id, name });
          continue;
        }
        seenThisRound.add(key);

        yield { type: 'tool_start', name, args };

        if (this.onToolCall) {
          const shouldProceed = await this.onToolCall(name, args);
          if (!shouldProceed) {
            const cancelledResult = mkTextResult('cancelled by hook');
            this.history.push({ role: 'tool', content: cancelledResult.text, tool_call_id: toolCall.id, name });
            allToolCalls.push({ name, args, result: cancelledResult, durationMs: 0 });
            yield { type: 'tool_end', name, result: cancelledResult, durationMs: 0 };
            continue;
          }
        }

        const start = Date.now();
        // Dispatch: custom tools first (by name match), then MCP tools, then not-available
        // Let errors from tools.call() / customTools.call() propagate — no try/catch
        // customDefs already computed once per turn at the top of the loop
        let result: McpToolResult;
        if (this.customTools !== undefined) {
          if (customDefs.some((d) => d.function.name === name)) {
            const rawResult = await this.customTools.call(name, args, this.signal);
            const text = typeof rawResult === 'string'
              ? rawResult
              : rawResult === undefined || rawResult === null
                ? ''
                : JSON.stringify(rawResult);
            result = mkTextResult(text);
          } else if (this.tools !== undefined) {
            result = await this.tools.call(name, args, this.signal);
          } else {
            result = mkTextResult(`Tool ${name} not available`);
          }
        } else if (this.tools !== undefined) {
          result = await this.tools.call(name, args, this.signal);
        } else {
          result = mkTextResult(`Tool ${name} not available`);
        }
        const durationMs = Date.now() - start;

        if (this.onToolResult) {
          await this.onToolResult(name, result);
        }

        this.history.push({ role: 'tool', content: result.text, tool_call_id: toolCall.id, name });
        allToolCalls.push({ name, args, result, durationMs });
        yield { type: 'tool_end', name, result, durationMs };
      }

      // Image short-circuit: if any tool returned an image, stop looping
      const hasImage = allToolCalls.some((tc) =>
        tc.result.content.some((c) => c.type === 'image'),
      );
      if (hasImage) {
        if (receivedReceipt) yield { type: 'x402_receipt', ...receivedReceipt };
        yield {
          type: 'done',
          response: {
            content: fullContent,
            toolCalls: allToolCalls,
            usage: {
              promptTokens: totalPromptTokens,
              completionTokens: totalCompletionTokens,
              totalTokens: totalPromptTokens + totalCompletionTokens,
              ...(totalReasoningTokens > 0 ? { reasoningTokens: totalReasoningTokens } : {}),
            },
          },
        };
        return;
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
      customTools: this.customTools,
      signal: this.signal,
      onToolCall: this.onToolCall,
      onToolResult: this.onToolResult,
      maxToolRounds: this.maxToolRounds,
      onRoundMeta: this.onRoundMeta,
      onToolsIgnored: this.onToolsIgnored,
      enablePromptToolFallback: this.enablePromptToolFallback,
      ...(this.toolChoice !== undefined ? { tool_choice: this.toolChoice } : {}),
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

  private async executeToolCall(
    toolCall: ToolCall,
    precomputedCustomDefs: readonly import('../tools/types.js').ToolDefinition[] = [],
  ): Promise<ToolCallRecord> {
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
          name,
        });
        return { name, args, result: cancelledResult, durationMs: 0 };
      }
    }

    const start = Date.now();
    // Dispatch: custom tools first (by name match), then MCP tools, then not-available
    // precomputedCustomDefs is hoisted from the per-turn getDefinitions() call to avoid
    // calling it once per tool-call dispatch (O(1+N) → O(1) per turn).
    let result: McpToolResult;
    if (this.customTools !== undefined) {
      if (precomputedCustomDefs.some((d) => d.function.name === name)) {
        const rawResult = await this.customTools.call(name, args, this.signal);
        const text = typeof rawResult === 'string'
          ? rawResult
          : rawResult === undefined || rawResult === null
            ? ''
            : JSON.stringify(rawResult);
        result = mkTextResult(text);
      } else if (this.tools !== undefined) {
        result = await this.tools.call(name, args, this.signal);
      } else {
        result = mkTextResult(`Tool ${name} not available`);
      }
    } else if (this.tools !== undefined) {
      result = await this.tools.call(name, args, this.signal);
    } else {
      result = mkTextResult(`Tool ${name} not available`);
    }
    const durationMs = Date.now() - start;

    if (this.onToolResult) {
      await this.onToolResult(name, result);
    }

    this.history.push({
      role: 'tool',
      content: result.text,
      tool_call_id: toolCall.id,
      name,
    });

    return { name, args, result, durationMs };
  }

  private async runPromptFallbackRound(toolDefs: readonly import('../tools/types.js').ToolDefinition[]): Promise<{
    readonly assistantMessage: ChatMessage;
    readonly toolCalls: readonly ToolCall[];
    readonly textWithoutBlocks: string;
    readonly usage: { readonly promptTokens: number; readonly completionTokens: number; readonly reasoningTokens?: number | undefined };
  }> {
    const promptToolsBlock = formatToolsForPrompt(toolDefs);
    const augmentedSystem = this.system
      ? `${this.system}\n\n${promptToolsBlock}`
      : promptToolsBlock;

    const messages: ChatMessage[] = [
      { role: 'system', content: augmentedSystem },
      ...this.history,
    ];

    const { data: response, headers } = await this.http.postWithMeta<ChatResponse>(
      '/v1/chat/completions',
      { model: this.model, messages },
      this.signal,
    );

    if (this.onRoundMeta) {
      this.onRoundMeta(buildRoundMeta(headers));
    }

    const choice = response.choices[0];
    if (!choice) {
      throw new LLM4AgentsError('Empty fallback response from LLM', 'api_error', undefined, undefined);
    }

    const rawContent = choice.message.content;
    const text = typeof rawContent === 'string' ? rawContent : '';
    const { toolCalls, textWithoutBlocks } = parseToolCallsFromText(text);

    const assistantMessage: ChatMessage = {
      role: 'assistant',
      content: textWithoutBlocks,
      ...(toolCalls.length > 0 ? { tool_calls: [...toolCalls] } : {}),
    };

    return {
      assistantMessage,
      toolCalls,
      textWithoutBlocks,
      usage: {
        promptTokens: response.usage.prompt_tokens,
        completionTokens: response.usage.completion_tokens,
        ...(response.usage.reasoning_tokens !== undefined ? { reasoningTokens: response.usage.reasoning_tokens } : {}),
      },
    };
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
    tokensReasoning: parseIntHeader('x-tokens-reasoning'),
    headers,
  };
}
