import { describe, it, expect } from 'vitest';
import { formatToolsForPrompt, parseToolCallsFromText } from '../../src/chat/prompt-fallback.js';
import type { ToolDefinition } from '../../src/tools/types.js';

const TOOLS: readonly ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'google_search',
      description: 'Search Google',
      parameters: { type: 'object', properties: { q: { type: 'string' } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'fetch_url',
      description: 'Fetch a URL',
      parameters: { type: 'object', properties: { url: { type: 'string' } } },
    },
  },
];

describe('formatToolsForPrompt', () => {
  it('includes the instructions header and every tool', () => {
    const out = formatToolsForPrompt(TOOLS);
    expect(out).toContain('<tool_call>');
    expect(out).toContain('google_search: Search Google');
    expect(out).toContain('fetch_url: Fetch a URL');
    expect(out).toContain('"properties"');
  });
});

describe('parseToolCallsFromText', () => {
  it('extracts a single tool call', () => {
    const text = 'Sure thing.\n<tool_call>\n{"name":"google_search","arguments":{"q":"bitcoin"}}\n</tool_call>';
    const { toolCalls, textWithoutBlocks } = parseToolCallsFromText(text);
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]?.function.name).toBe('google_search');
    expect(toolCalls[0]?.function.arguments).toBe('{"q":"bitcoin"}');
    expect(textWithoutBlocks).toBe('Sure thing.');
  });

  it('extracts multiple tool calls', () => {
    const text = '<tool_call>{"name":"a","arguments":{}}</tool_call>\n<tool_call>{"name":"b","arguments":{"x":1}}</tool_call>';
    const { toolCalls } = parseToolCallsFromText(text);
    expect(toolCalls).toHaveLength(2);
    expect(toolCalls[0]?.function.name).toBe('a');
    expect(toolCalls[1]?.function.name).toBe('b');
    expect(toolCalls[1]?.function.arguments).toBe('{"x":1}');
  });

  it('skips malformed JSON blocks but keeps valid ones', () => {
    const text = '<tool_call>not-json</tool_call>\n<tool_call>{"name":"good","arguments":{}}</tool_call>';
    const { toolCalls } = parseToolCallsFromText(text);
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]?.function.name).toBe('good');
  });

  it('returns empty when no blocks present', () => {
    const { toolCalls, textWithoutBlocks } = parseToolCallsFromText('Just a regular answer.');
    expect(toolCalls).toHaveLength(0);
    expect(textWithoutBlocks).toBe('Just a regular answer.');
  });

  it('stringifies object arguments via JSON.stringify', () => {
    const text = '<tool_call>{"name":"x","arguments":{"a":1,"b":[2,3]}}</tool_call>';
    const { toolCalls } = parseToolCallsFromText(text);
    expect(toolCalls[0]?.function.arguments).toBe('{"a":1,"b":[2,3]}');
  });
});
