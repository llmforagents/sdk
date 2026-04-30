import type { ToolDefinition } from '../tools/types.js';
import type { ToolCall } from './types.js';

const FALLBACK_INSTRUCTIONS = `You have access to the following tools. To call a tool, output a fenced block exactly like this:

<tool_call>
{"name": "tool_name", "arguments": {"key": "value"}}
</tool_call>

You may emit zero or more <tool_call> blocks. After all tool calls, the system will execute them and reply with the results so you can produce a final answer. If no tool is needed, answer the user directly without any <tool_call> block.

Available tools:`;

export function formatToolsForPrompt(tools: readonly ToolDefinition[]): string {
  const lines = [FALLBACK_INSTRUCTIONS];
  for (const t of tools) {
    const fn = t.function;
    lines.push(`\n- ${fn.name}: ${fn.description}`);
    lines.push(`  parameters: ${JSON.stringify(fn.parameters)}`);
  }
  return lines.join('\n');
}

const TOOL_CALL_BLOCK = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;

export interface PromptToolParse {
  readonly toolCalls: readonly ToolCall[];
  readonly textWithoutBlocks: string;
}

export function parseToolCallsFromText(text: string, idPrefix = 'pmpt'): PromptToolParse {
  const calls: ToolCall[] = [];
  let idx = 0;
  const matches = text.matchAll(TOOL_CALL_BLOCK);

  for (const match of matches) {
    const body = match[1] ?? '';
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(body) as Record<string, unknown>;
    } catch {
      parsed = null;
    }
    if (!parsed || typeof parsed['name'] !== 'string') continue;

    const name = parsed['name'];
    const rawArgs = parsed['arguments'];
    const argsString =
      typeof rawArgs === 'string' ? rawArgs : JSON.stringify(rawArgs ?? {});

    calls.push({
      id: `${idPrefix}_${idx}`,
      type: 'function',
      function: { name, arguments: argsString },
    });
    idx++;
  }

  const textWithoutBlocks = text.replace(TOOL_CALL_BLOCK, '').trim();
  return { toolCalls: calls, textWithoutBlocks };
}
