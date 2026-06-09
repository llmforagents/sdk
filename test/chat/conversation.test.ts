import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Conversation } from '../../src/chat/conversation.js';
import { HttpTransport } from '../../src/transport/http.js';
import { McpTransport } from '../../src/transport/mcp.js';
import { Tools } from '../../src/tools/tools.js';
import { LLM4AgentsError } from '../../src/errors.js';
import type { ResponseMeta, StreamEvent } from '../../src/chat/types.js';

const API_KEY = 'sk-proxy-test-key';
const BASE_URL = 'https://api.test.com';
const MCP_URL = 'https://mcp.test.com/mcp';

let fetchSpy: ReturnType<typeof vi.fn>;
let http: HttpTransport;
let tools: Tools;

function chatResponse(content: string, toolCalls?: unknown[]) {
  return new Response(JSON.stringify({
    id: 'c1',
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content: toolCalls ? null : content,
        ...(toolCalls ? { tool_calls: toolCalls } : {}),
      },
      finish_reason: toolCalls ? 'tool_calls' : 'stop',
    }],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
    model: 'test-model',
  }), { status: 200, headers: { 'content-type': 'application/json', 'x-request-id': 'req_cv' } });
}

function mcpResponse(text: string) {
  return new Response(JSON.stringify({
    result: { content: [{ type: 'text', text }] },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

function mcpToolsList() {
  return new Response(JSON.stringify({
    result: { tools: [{ name: 'google_search', description: 'Search', inputSchema: { type: 'object', properties: { q: { type: 'string' } } } }] },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  fetchSpy = vi.fn();
  globalThis.fetch = fetchSpy;
  http = new HttpTransport({ baseUrl: BASE_URL, apiKey: API_KEY, timeout: 5000 });
  const mcp = new McpTransport({ mcpUrl: MCP_URL, apiKey: API_KEY, timeout: 60000 });
  tools = new Tools(mcp);
});

afterEach(() => { vi.restoreAllMocks(); });

describe('Conversation.say()', () => {
  it('sends user message and returns assistant response', async () => {
    fetchSpy.mockResolvedValueOnce(chatResponse('Hello!'));

    const conv = new Conversation(http, { model: 'test-model' });
    const result = await conv.say('Hi');

    expect(result.content).toBe('Hello!');
    expect(result.toolCalls).toHaveLength(0);
    expect(conv.messages).toHaveLength(2); // user + assistant
  });

  it('accumulates history across multiple say() calls', async () => {
    fetchSpy
      .mockResolvedValueOnce(chatResponse('First'))
      .mockResolvedValueOnce(chatResponse('Second'));

    const conv = new Conversation(http, { model: 'test-model' });
    await conv.say('One');
    await conv.say('Two');

    expect(conv.messages).toHaveLength(4); // user, assistant, user, assistant
  });

  it('includes system message when provided', async () => {
    fetchSpy.mockResolvedValueOnce(chatResponse('OK'));

    const conv = new Conversation(http, { model: 'test-model', system: 'You are helpful' });
    await conv.say('Hi');

    const [, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(opts.body as string) as { messages: { role: string; content: string }[] };
    expect(body.messages[0]?.role).toBe('system');
    expect(body.messages[0]?.content).toBe('You are helpful');
  });

  it('calls onRoundMeta with cost headers on each LLM round', async () => {
    function chatRespWithHeaders(content: string): Response {
      return new Response(JSON.stringify({
        id: 'c1',
        choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
        model: 'test-model',
      }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'req_1',
          'x-cost-usd-cents': '7',
          'x-balance-remaining-cents': '5000',
          'x-model-used': 'test-model',
        },
      });
    }

    fetchSpy.mockResolvedValueOnce(chatRespWithHeaders('Done'));

    const roundMetas: ResponseMeta[] = [];
    const conv = new Conversation(http, {
      model: 'test-model',
      onRoundMeta: (meta) => { roundMetas.push(meta); },
    });
    await conv.say('Hi');

    expect(roundMetas).toHaveLength(1);
    expect(roundMetas[0]?.costUsdCents).toBe(7);
    expect(roundMetas[0]?.balanceRemainingCents).toBe(5000);
  });
});

describe('Conversation tool loop', () => {
  it('executes tool calls and feeds results back to LLM', async () => {
    // 1. MCP tools/list (for definitions — called before LLM)
    fetchSpy.mockResolvedValueOnce(mcpToolsList());
    // 2. LLM returns tool_call
    fetchSpy.mockResolvedValueOnce(chatResponse('', [
      { id: 'tc_1', type: 'function', function: { name: 'google_search', arguments: '{"q":"Bitcoin"}' } },
    ]));
    // 3. MCP callTool
    fetchSpy.mockResolvedValueOnce(mcpResponse('Bitcoin is at $100k'));
    // 4. LLM final response with tool result (definitions cached, no MCP call)
    fetchSpy.mockResolvedValueOnce(chatResponse('Bitcoin is currently at $100k'));

    const conv = new Conversation(http, { model: 'test-model', tools });
    const result = await conv.say('What is Bitcoin price?');

    expect(result.content).toBe('Bitcoin is currently at $100k');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]?.name).toBe('google_search');
    expect(result.toolCalls[0]?.result.text).toBe('Bitcoin is at $100k');
  });

  it('calls onToolCall hook and skips when it returns false', async () => {
    // 1. MCP tools/list (for definitions — called before LLM)
    fetchSpy.mockResolvedValueOnce(mcpToolsList());
    // 2. LLM returns tool_call
    fetchSpy.mockResolvedValueOnce(chatResponse('', [
      { id: 'tc_1', type: 'function', function: { name: 'google_search', arguments: '{"q":"test"}' } },
    ]));
    // No MCP callTool — hook cancels it
    // 3. LLM final response (definitions cached)
    fetchSpy.mockResolvedValueOnce(chatResponse('I could not search'));

    const onToolCall = vi.fn().mockReturnValue(false);

    const conv = new Conversation(http, { model: 'test-model', tools, onToolCall });
    const result = await conv.say('Search something');

    expect(onToolCall).toHaveBeenCalledWith('google_search', { q: 'test' });
    expect(result.content).toBe('I could not search');
  });

  it('throws tool_loop_limit when maxToolRounds exceeded', async () => {
    // MCP tools/list first (called before first LLM call)
    fetchSpy.mockResolvedValueOnce(mcpToolsList());
    // LLM keeps returning tool calls for 3 rounds, but limit is 2
    for (let i = 0; i < 3; i++) {
      fetchSpy.mockResolvedValueOnce(chatResponse('', [
        { id: `tc_${i}`, type: 'function', function: { name: 'google_search', arguments: '{"q":"loop"}' } },
      ]));
      fetchSpy.mockResolvedValueOnce(mcpResponse('result'));
    }

    const conv = new Conversation(http, { model: 'test-model', tools, maxToolRounds: 2 });

    try {
      await conv.say('Loop forever');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(LLM4AgentsError);
      expect((err as LLM4AgentsError).code).toBe('tool_loop_limit');
    }
  });
});

describe('Conversation.clear()', () => {
  it('resets history but keeps system prompt', async () => {
    fetchSpy.mockResolvedValueOnce(chatResponse('OK'));

    const conv = new Conversation(http, { model: 'test-model', system: 'Be helpful' });
    await conv.say('Hi');
    expect(conv.messages.length).toBeGreaterThan(0);

    conv.clear();
    expect(conv.messages).toHaveLength(0);

    // Next say() should still include system prompt
    fetchSpy.mockResolvedValueOnce(chatResponse('OK again'));
    await conv.say('Hello again');

    const [, opts] = fetchSpy.mock.calls[1] as [string, RequestInit];
    const body = JSON.parse(opts.body as string) as { messages: { role: string }[] };
    expect(body.messages[0]?.role).toBe('system');
  });
});

describe('Conversation.fork()', () => {
  it('creates independent copy of history', async () => {
    fetchSpy.mockResolvedValueOnce(chatResponse('Base'));

    const conv = new Conversation(http, { model: 'test-model' });
    await conv.say('Setup');

    const forked = conv.fork();
    expect(forked.messages).toEqual(conv.messages);

    fetchSpy.mockResolvedValueOnce(chatResponse('Forked response'));
    await forked.say('Only in fork');

    expect(forked.messages.length).toBe(conv.messages.length + 2);
    expect(conv.messages).toHaveLength(2); // unchanged
  });
});

describe('Conversation with history rehydration', () => {
  it('restores messages from provided history', async () => {
    const savedHistory = [
      { role: 'user' as const, content: 'Previous question' },
      { role: 'assistant' as const, content: 'Previous answer' },
    ];

    fetchSpy.mockResolvedValueOnce(chatResponse('Continued'));

    const conv = new Conversation(http, { model: 'test-model', history: savedHistory });
    expect(conv.messages).toHaveLength(2);

    await conv.say('Continue');
    expect(conv.messages).toHaveLength(4);
  });
});

describe('Conversation.stream()', () => {
  function sseStream(chunks: string[]): Response {
    const joined = chunks.join('');
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(joined));
        controller.close();
      },
    });
    return new Response(stream, {
      status: 200,
      headers: { 'content-type': 'text/event-stream', 'x-request-id': 'req_s' },
    });
  }

  it('yields text events from streaming LLM response', async () => {
    fetchSpy.mockResolvedValueOnce(sseStream([
      'data: {"id":"c1","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}\n\n',
      'data: {"id":"c1","choices":[{"index":0,"delta":{"content":"Hello "},"finish_reason":null}]}\n\n',
      'data: {"id":"c1","choices":[{"index":0,"delta":{"content":"world"},"finish_reason":null}]}\n\n',
      'data: {"id":"c1","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":2}}\n\n',
      'data: [DONE]\n\n',
    ]));

    const conv = new Conversation(http, { model: 'test-model' });
    const events: unknown[] = [];
    for await (const event of await conv.stream('Hi')) {
      events.push(event);
    }

    const textEvents = events.filter((e: any) => e.type === 'text');
    expect(textEvents).toHaveLength(2);
    expect((textEvents[0] as any).content).toBe('Hello ');
    expect((textEvents[1] as any).content).toBe('world');

    const doneEvent = events.find((e: any) => e.type === 'done') as any;
    expect(doneEvent).toBeDefined();
    expect(doneEvent.response.content).toBe('Hello world');
  });

  it('handles tool calls in streaming mode', async () => {
    // 1. MCP tools/list (for definitions — called before LLM)
    fetchSpy.mockResolvedValueOnce(mcpToolsList());
    // 2. LLM streams a tool call
    fetchSpy.mockResolvedValueOnce(sseStream([
      'data: {"id":"c1","choices":[{"index":0,"delta":{"role":"assistant","tool_calls":[{"index":0,"id":"tc_1","type":"function","function":{"name":"google_search","arguments":""}}]},"finish_reason":null}]}\n\n',
      'data: {"id":"c1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"q\\":\\"BTC\\"}"}}]},"finish_reason":null}]}\n\n',
      'data: {"id":"c1","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":10,"completion_tokens":5}}\n\n',
      'data: [DONE]\n\n',
    ]));
    // 3. MCP callTool
    fetchSpy.mockResolvedValueOnce(mcpResponse('BTC at $100k'));
    // 4. LLM final response (streaming, definitions cached)
    fetchSpy.mockResolvedValueOnce(sseStream([
      'data: {"id":"c2","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}\n\n',
      'data: {"id":"c2","choices":[{"index":0,"delta":{"content":"Bitcoin is $100k"},"finish_reason":null}]}\n\n',
      'data: {"id":"c2","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":15,"completion_tokens":4}}\n\n',
      'data: [DONE]\n\n',
    ]));

    const conv = new Conversation(http, { model: 'test-model', tools });
    const events: unknown[] = [];
    for await (const event of await conv.stream('BTC price?')) {
      events.push(event);
    }

    const toolStart = events.find((e: any) => e.type === 'tool_start') as any;
    expect(toolStart).toBeDefined();
    expect(toolStart.name).toBe('google_search');

    const toolEnd = events.find((e: any) => e.type === 'tool_end') as any;
    expect(toolEnd).toBeDefined();
    expect(toolEnd.result.text).toBe('BTC at $100k');

    const textEvents = events.filter((e: any) => e.type === 'text');
    expect(textEvents.some((e: any) => e.content.includes('Bitcoin'))).toBe(true);

    const doneEvent = events.find((e: any) => e.type === 'done') as any;
    expect(doneEvent.response.content).toBe('Bitcoin is $100k');
  });

  it('emits tool_end with cancelled when onToolCall returns false', async () => {
    // 1. MCP tools/list (for definitions — called before LLM)
    fetchSpy.mockResolvedValueOnce(mcpToolsList());
    // 2. LLM streams a tool call
    fetchSpy.mockResolvedValueOnce(sseStream([
      'data: {"id":"c1","choices":[{"index":0,"delta":{"role":"assistant","tool_calls":[{"index":0,"id":"tc_1","type":"function","function":{"name":"google_search","arguments":"{\\"q\\":\\"test\\"}"}}]},"finish_reason":null}]}\n\n',
      'data: {"id":"c1","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":5,"completion_tokens":2}}\n\n',
      'data: [DONE]\n\n',
    ]));
    // No MCP callTool — hook cancels it
    // 3. LLM response after cancelled tool (definitions cached)
    fetchSpy.mockResolvedValueOnce(sseStream([
      'data: {"id":"c2","choices":[{"index":0,"delta":{"content":"Cannot search"},"finish_reason":null}]}\n\n',
      'data: {"id":"c2","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":2}}\n\n',
      'data: [DONE]\n\n',
    ]));

    const onToolCall = vi.fn().mockReturnValue(false);
    const conv = new Conversation(http, { model: 'test-model', tools, onToolCall });
    const events: unknown[] = [];
    for await (const event of await conv.stream('Search')) {
      events.push(event);
    }

    expect(onToolCall).toHaveBeenCalledWith('google_search', { q: 'test' });
    const toolEnd = events.find((e: any) => e.type === 'tool_end') as any;
    expect(toolEnd.result.text).toBe('cancelled by hook');
  });
});

describe('Conversation — fail-fast on tool error', () => {
  it('throws LLM4AgentsError when a tool call fails', async () => {
    fetchSpy
      .mockResolvedValueOnce(mcpToolsList())
      .mockResolvedValueOnce(chatResponse('', [{
        id: 'tc-1', type: 'function',
        function: { name: 'google_search', arguments: '{"q":"test"}' },
      }]))
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ error: { code: -32601, message: 'Method not found' } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ));

    const conv = new Conversation(http, { model: 'test-model', tools });
    await expect(conv.say('Search something')).rejects.toThrow(LLM4AgentsError);
  });
});

describe('Conversation — dedup tool calls', () => {
  it('executes duplicate (name, args) only once per round', async () => {
    fetchSpy
      .mockResolvedValueOnce(mcpToolsList())
      .mockResolvedValueOnce(chatResponse('', [
        { id: 'tc-1', type: 'function', function: { name: 'google_search', arguments: '{"q":"test"}' } },
        { id: 'tc-2', type: 'function', function: { name: 'google_search', arguments: '{"q":"test"}' } },
      ]))
      .mockResolvedValueOnce(mcpResponse('results'))  // only ONE mcp tools/call
      .mockResolvedValueOnce(chatResponse('Done'));

    const conv = new Conversation(http, { model: 'test-model', tools });
    const result = await conv.say('Search');
    expect(result.content).toBe('Done');
    // tools/list (1) + tools/call (1) = 2 MCP calls, NOT 3
    const mcpCalls = fetchSpy.mock.calls.filter(([url]) =>
      (url as string).includes('mcp')
    );
    expect(mcpCalls).toHaveLength(2);
  });
});

describe('Conversation — image short-circuit', () => {
  it('stops tool loop when result contains image content', async () => {
    fetchSpy
      .mockResolvedValueOnce(mcpToolsList())
      .mockResolvedValueOnce(chatResponse('', [{
        id: 'tc-1', type: 'function',
        function: { name: 'google_search', arguments: '{"q":"cat"}' },
      }]))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        result: {
          content: [
            { type: 'text', text: 'Caption: a cat' },
            { type: 'image', data: 'base64abc', mimeType: 'image/png' },
          ],
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } }));

    const conv = new Conversation(http, { model: 'test-model', tools });
    const result = await conv.say('Show me a cat');

    // Should NOT have made another LLM call after the image result
    const chatCalls = fetchSpy.mock.calls.filter(([url]) =>
      !(url as string).includes('mcp')
    );
    expect(chatCalls).toHaveLength(1); // only initial LLM call, no follow-up

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]?.result.content.some(c => c.type === 'image')).toBe(true);
  });
});

describe('Conversation.stream() — meta events', () => {
  function chatStreamRespWithHeaders(content: string): Response {
    const lines = [
      `data: ${JSON.stringify({ id: 'c1', choices: [{ delta: { role: 'assistant', content }, index: 0, finish_reason: null }], model: 'test-model' })}`,
      `data: ${JSON.stringify({ id: 'c1', choices: [{ delta: {}, index: 0, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 }, model: 'test-model' })}`,
      'data: [DONE]',
    ].join('\n');
    return new Response(lines, {
      status: 200,
      headers: {
        'content-type': 'text/event-stream',
        'x-request-id': 'req_stream_1',
        'x-cost-usd-cents': '9',
        'x-balance-remaining-cents': '4991',
        'x-model-used': 'test-model',
      },
    });
  }

  it('stream() emits meta event per LLM round with cost headers', async () => {
    fetchSpy.mockResolvedValueOnce(mcpToolsList());
    fetchSpy.mockResolvedValueOnce(chatStreamRespWithHeaders('Done'));

    const metaEvents: ResponseMeta[] = [];
    const conv = new Conversation(http, {
      model: 'test-model',
      tools,
      onRoundMeta: (meta) => { metaEvents.push(meta); },
    });

    const events: StreamEvent[] = [];
    for await (const event of conv.stream('Hi')) {
      events.push(event);
    }

    // There should be at least one meta event
    const metaFromStream = events.filter(e => e.type === 'meta');
    expect(metaFromStream.length).toBeGreaterThanOrEqual(1);
    const firstMeta = metaFromStream[0];
    if (firstMeta?.type === 'meta') {
      expect(firstMeta.meta.costUsdCents).toBe(9);
      expect(firstMeta.meta.balanceRemainingCents).toBe(4991);
    }

    // onRoundMeta callback should also have been called
    expect(metaEvents.length).toBeGreaterThanOrEqual(1);
    expect(metaEvents[0]?.costUsdCents).toBe(9);
  });
});

describe('Conversation — onToolsIgnored callback', () => {
  it('calls onToolsIgnored when model responds without tool_calls despite tools being provided', async () => {
    fetchSpy
      .mockResolvedValueOnce(mcpToolsList())
      .mockResolvedValueOnce(chatResponse('Direct answer without using tools'));

    let ignoredModel: string | undefined;
    const conv = new Conversation(http, {
      model: 'some-model-without-function-calling',
      tools,
      onToolsIgnored: (model) => { ignoredModel = model; },
    });

    const result = await conv.say('What is the weather?');
    expect(result.content).toBe('Direct answer without using tools');
    expect(ignoredModel).toBe('some-model-without-function-calling');
  });

  it('does NOT call onToolsIgnored when tools are used', async () => {
    fetchSpy
      .mockResolvedValueOnce(mcpToolsList())
      .mockResolvedValueOnce(chatResponse('', [{
        id: 'tc-1', type: 'function',
        function: { name: 'google_search', arguments: '{"q":"test"}' },
      }]))
      .mockResolvedValueOnce(mcpResponse('results'))
      .mockResolvedValueOnce(chatResponse('Done'));

    let wasCalled = false;
    const conv = new Conversation(http, {
      model: 'test-model',
      tools,
      onToolsIgnored: () => { wasCalled = true; },
    });

    await conv.say('Search something');
    expect(wasCalled).toBe(false);
  });
});

describe('Conversation — assistant.content normalization (BUG-08)', () => {
  it('coerces null content from tool-call-only response to empty string in history', async () => {
    const toolCallResponse = new Response(JSON.stringify({
      id: 'c1',
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: 'tc-1', type: 'function', function: { name: 'google_search', arguments: '{"q":"x"}' } }],
        },
        finish_reason: 'tool_calls',
      }],
      usage: { prompt_tokens: 5, completion_tokens: 2 },
      model: 'gemini-flash',
    }), { status: 200, headers: { 'content-type': 'application/json' } });

    fetchSpy
      .mockResolvedValueOnce(mcpToolsList())
      .mockResolvedValueOnce(toolCallResponse)
      .mockResolvedValueOnce(mcpResponse('result text'))
      .mockResolvedValueOnce(chatResponse('Done.'));

    const conv = new Conversation(http, { model: 'gemini-flash', tools });
    await conv.say('search please');

    const assistantMsg = conv.messages.find(
      (m) => m.role === 'assistant' && (m as { tool_calls?: unknown[] }).tool_calls,
    );
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg?.content).not.toBeNull();
    expect(assistantMsg?.content).toBe('');
  });

  it('stream(): assistant message in history has content: "" not null when only tool_calls emitted', async () => {
    function streamToolCall(): Response {
      const sse = [
        `data: ${JSON.stringify({ id: 'c1', model: 'm', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'tc-1', type: 'function', function: { name: 'google_search', arguments: '{"q":"x"}' } }] }, finish_reason: null }] })}\n\n`,
        `data: ${JSON.stringify({ id: 'c1', model: 'm', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 5, completion_tokens: 2 } })}\n\n`,
        'data: [DONE]\n\n',
      ].join('');
      return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }

    fetchSpy
      .mockResolvedValueOnce(mcpToolsList())
      .mockResolvedValueOnce(streamToolCall())
      .mockResolvedValueOnce(mcpResponse('result'))
      .mockResolvedValueOnce(new Response(
        [
          `data: ${JSON.stringify({ id: 'c2', model: 'm', choices: [{ index: 0, delta: { content: 'Done.' }, finish_reason: null }] })}\n\n`,
          `data: ${JSON.stringify({ id: 'c2', model: 'm', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 2 } })}\n\n`,
          'data: [DONE]\n\n',
        ].join(''),
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      ));

    const conv = new Conversation(http, { model: 'gemini-flash', tools });
    for await (const _ev of conv.stream('search')) { /* drain */ }

    const assistantMsg = conv.messages.find(
      (m) => m.role === 'assistant' && (m as { tool_calls?: unknown[] }).tool_calls,
    );
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg?.content).not.toBeNull();
    expect(assistantMsg?.content).toBe('');
  });
});

describe('Conversation — synthesize tool_call.id when provider omits it (BUG-09)', () => {
  it('say(): generates synthetic id when assistant.tool_calls[i].id is missing', async () => {
    const toolCallNoId = new Response(JSON.stringify({
      id: 'c1',
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [{
            type: 'function',
            function: { name: 'google_search', arguments: '{"q":"x"}' },
          }],
        },
        finish_reason: 'tool_calls',
      }],
      usage: { prompt_tokens: 5, completion_tokens: 2 },
      model: 'gemini-flash',
    }), { status: 200, headers: { 'content-type': 'application/json' } });

    fetchSpy
      .mockResolvedValueOnce(mcpToolsList())
      .mockResolvedValueOnce(toolCallNoId)
      .mockResolvedValueOnce(mcpResponse('result'))
      .mockResolvedValueOnce(chatResponse('Done.'));

    const conv = new Conversation(http, { model: 'gemini-flash', tools });
    await conv.say('search');

    const assistantMsg = conv.messages.find(
      (m) => m.role === 'assistant' && (m as { tool_calls?: { id: string }[] }).tool_calls,
    );
    const toolCalls = (assistantMsg as { tool_calls: { id: string }[] }).tool_calls;
    expect(toolCalls[0]?.id).toBeDefined();
    expect(toolCalls[0]?.id).toMatch(/^auto_/);

    const toolMsg = conv.messages.find((m) => m.role === 'tool');
    expect(toolMsg?.tool_call_id).toBe(toolCalls[0]?.id);
    expect(toolMsg?.tool_call_id).toMatch(/^auto_/);
  });

  it('say(): preserves provider-supplied id when present (no synthesis)', async () => {
    fetchSpy
      .mockResolvedValueOnce(mcpToolsList())
      .mockResolvedValueOnce(chatResponse('', [{
        id: 'tc-real-id',
        type: 'function',
        function: { name: 'google_search', arguments: '{"q":"x"}' },
      }]))
      .mockResolvedValueOnce(mcpResponse('result'))
      .mockResolvedValueOnce(chatResponse('Done.'));

    const conv = new Conversation(http, { model: 'm', tools });
    await conv.say('search');

    const toolMsg = conv.messages.find((m) => m.role === 'tool');
    expect(toolMsg?.tool_call_id).toBe('tc-real-id');
  });

  it('role: "tool" history entries include name field (defense-in-depth for legacy providers)', async () => {
    fetchSpy
      .mockResolvedValueOnce(mcpToolsList())
      .mockResolvedValueOnce(chatResponse('', [{
        id: 'tc-1',
        type: 'function',
        function: { name: 'google_search', arguments: '{"q":"x"}' },
      }]))
      .mockResolvedValueOnce(mcpResponse('result'))
      .mockResolvedValueOnce(chatResponse('Done.'));

    const conv = new Conversation(http, { model: 'm', tools });
    await conv.say('search');

    const toolMsg = conv.messages.find((m) => m.role === 'tool');
    expect((toolMsg as { name?: string }).name).toBe('google_search');
  });

  it('stream(): generates synthetic id when streaming chunks omit tool_call.id', async () => {
    function streamToolCallNoId(): Response {
      const sse = [
        `data: ${JSON.stringify({ id: 'c1', model: 'm', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, type: 'function', function: { name: 'google_search', arguments: '{"q":"x"}' } }] }, finish_reason: null }] })}\n\n`,
        `data: ${JSON.stringify({ id: 'c1', model: 'm', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 5, completion_tokens: 2 } })}\n\n`,
        'data: [DONE]\n\n',
      ].join('');
      return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }

    fetchSpy
      .mockResolvedValueOnce(mcpToolsList())
      .mockResolvedValueOnce(streamToolCallNoId())
      .mockResolvedValueOnce(mcpResponse('result'))
      .mockResolvedValueOnce(new Response(
        [
          `data: ${JSON.stringify({ id: 'c2', model: 'm', choices: [{ index: 0, delta: { content: 'Done.' }, finish_reason: null }] })}\n\n`,
          `data: ${JSON.stringify({ id: 'c2', model: 'm', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } })}\n\n`,
          'data: [DONE]\n\n',
        ].join(''),
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      ));

    const conv = new Conversation(http, { model: 'm', tools });
    for await (const _ev of conv.stream('search')) { /* drain */ }

    const assistantMsg = conv.messages.find(
      (m) => m.role === 'assistant' && (m as { tool_calls?: { id: string }[] }).tool_calls,
    );
    const toolCalls = (assistantMsg as { tool_calls: { id: string }[] }).tool_calls;
    expect(toolCalls[0]?.id).toMatch(/^auto_/);

    const toolMsg = conv.messages.find((m) => m.role === 'tool');
    expect(toolMsg?.tool_call_id).toBe(toolCalls[0]?.id);
  });
});

describe('Conversation — reasoning tokens propagation (BUG-03)', () => {
  it('say() propagates reasoning_tokens into ConversationResponse.usage.reasoningTokens', async () => {
    const sayResponse = new Response(JSON.stringify({
      id: 'c1',
      choices: [{ index: 0, message: { role: 'assistant', content: 'thoughtful answer' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 12, completion_tokens: 4, reasoning_tokens: 90 },
      model: 'reasoning-model',
    }), { status: 200, headers: { 'content-type': 'application/json' } });
    fetchSpy.mockResolvedValueOnce(sayResponse);

    const conv = new Conversation(http, { model: 'reasoning-model' });
    const result = await conv.say('think hard');

    expect(result.usage.promptTokens).toBe(12);
    expect(result.usage.completionTokens).toBe(4);
    expect(result.usage.reasoningTokens).toBe(90);
  });

  it('say() omits reasoningTokens when not present', async () => {
    fetchSpy.mockResolvedValueOnce(chatResponse('plain'));

    const conv = new Conversation(http, { model: 'plain-model' });
    const result = await conv.say('hi');

    expect(result.usage.reasoningTokens).toBeUndefined();
  });
});

describe('Conversation — enablePromptToolFallback', () => {
  it('say(): retries in prompt mode and executes tool calls parsed from text', async () => {
    fetchSpy
      .mockResolvedValueOnce(mcpToolsList())
      // Round 0: model ignores tools entirely
      .mockResolvedValueOnce(chatResponse('I cannot do that without searching.'))
      // Fallback round: model emits tool_call block in text
      .mockResolvedValueOnce(chatResponse('Let me search.\n<tool_call>{"name":"google_search","arguments":{"q":"bitcoin"}}</tool_call>'))
      // After tool execution, final answer
      .mockResolvedValueOnce(mcpResponse('Bitcoin is up 5%'))
      .mockResolvedValueOnce(chatResponse('Bitcoin is up 5% today.'));

    const conv = new Conversation(http, {
      model: 'no-fc-model',
      tools,
      enablePromptToolFallback: true,
    });

    const result = await conv.say('Price of bitcoin?');
    expect(result.content).toBe('Bitcoin is up 5% today.');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]?.name).toBe('google_search');
  });

  it('say(): when fallback also returns no tool calls, returns the prompt-mode text', async () => {
    fetchSpy
      .mockResolvedValueOnce(mcpToolsList())
      .mockResolvedValueOnce(chatResponse('Plain answer.'))
      .mockResolvedValueOnce(chatResponse('Still a plain answer with no tools.'));

    const conv = new Conversation(http, {
      model: 'no-fc-model',
      tools,
      enablePromptToolFallback: true,
    });

    const result = await conv.say('hi');
    expect(result.content).toBe('Still a plain answer with no tools.');
    expect(result.toolCalls).toHaveLength(0);
  });

  it('say(): does NOT trigger fallback when flag is false', async () => {
    fetchSpy
      .mockResolvedValueOnce(mcpToolsList())
      .mockResolvedValueOnce(chatResponse('Direct answer'));

    const conv = new Conversation(http, {
      model: 'no-fc-model',
      tools,
      enablePromptToolFallback: false,
    });

    const result = await conv.say('hi');
    expect(result.content).toBe('Direct answer');
    // Only 2 fetches total (mcp list + chat); no fallback round
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('stream(): emits a fallback event then runs prompt-mode tool calls', async () => {
    function streamResponse(textChunks: string[], finishReason = 'stop'): Response {
      const sse = textChunks
        .map((c) =>
          `data: ${JSON.stringify({
            id: 'c1', model: 'm', choices: [{ index: 0, delta: { content: c }, finish_reason: null }],
          })}\n\n`,
        )
        .concat([
          `data: ${JSON.stringify({
            id: 'c1', model: 'm',
            choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
            usage: { prompt_tokens: 5, completion_tokens: 3 },
          })}\n\n`,
          'data: [DONE]\n\n',
        ])
        .join('');
      return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }

    fetchSpy
      .mockResolvedValueOnce(mcpToolsList())
      // Round 0 (streamed): model ignores tools
      .mockResolvedValueOnce(streamResponse(['I cannot help.']))
      // Fallback round (non-streamed POST): tool_call in text
      .mockResolvedValueOnce(chatResponse('<tool_call>{"name":"google_search","arguments":{"q":"x"}}</tool_call>'))
      .mockResolvedValueOnce(mcpResponse('result'))
      // Final round (streamed)
      .mockResolvedValueOnce(streamResponse(['Final answer.']));

    const conv = new Conversation(http, {
      model: 'no-fc-model',
      tools,
      enablePromptToolFallback: true,
    });

    const events: StreamEvent[] = [];
    for await (const ev of conv.stream('q?')) events.push(ev);

    const fallbackEvent = events.find((e) => e.type === 'fallback');
    expect(fallbackEvent).toBeDefined();
    if (fallbackEvent && fallbackEvent.type === 'fallback') {
      expect(fallbackEvent.reason).toBe('tools_ignored');
      expect(fallbackEvent.model).toBe('no-fc-model');
    }

    const toolEnd = events.find((e) => e.type === 'tool_end');
    expect(toolEnd).toBeDefined();

    const done = events.find((e) => e.type === 'done');
    expect(done).toBeDefined();
    if (done && done.type === 'done') {
      expect(done.response.toolCalls).toHaveLength(1);
      expect(done.response.toolCalls[0]?.name).toBe('google_search');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// tool_choice: passes through on round 1, auto-reverts after.
//
// Background — yesterday's live test of the supervisor.delegate runtime:
// with Anthropic's default `auto`, Sonnet 4.5 *described* the tool call as
// JSON-in-text instead of using the tool_calls API. Forcing `required` via
// curl made it call the tool natively on the first turn — but Anthropic's
// API rejects a request when `tool_choice='required'` is set AND the prior
// turn was a tool result with no remaining tool to call. The SDK must
// therefore only apply the user's tool_choice on round 1 and revert to
// `auto` afterwards, so the model can summarize the tool result naturally.
describe('Conversation — tool_choice (first-round-only semantics)', () => {
  it('forwards `tool_choice` verbatim on round 1 of .say()', async () => {
    fetchSpy.mockResolvedValueOnce(chatResponse('ok'));
    const conv = new Conversation(http, { model: 'test-model', tool_choice: 'required' });
    await conv.say('hi');
    const [, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(opts.body as string) as { tool_choice?: unknown };
    expect(body.tool_choice).toBe('required');
  });

  it('drops `tool_choice` on round 2 even if the caller set it', async () => {
    // Round 1: LLM tool_call → execute tool. Round 2: LLM summarizes.
    fetchSpy.mockResolvedValueOnce(mcpToolsList());
    fetchSpy.mockResolvedValueOnce(chatResponse('', [
      { id: 'tc_1', type: 'function', function: { name: 'google_search', arguments: '{"q":"x"}' } },
    ]));
    fetchSpy.mockResolvedValueOnce(mcpResponse('search result'));
    fetchSpy.mockResolvedValueOnce(chatResponse('final answer'));

    const conv = new Conversation(http, { model: 'test-model', tools, tool_choice: 'required' });
    await conv.say('do it');

    // The first LLM call is fetchSpy.mock.calls[1] (mcpToolsList is [0]).
    const llmCalls = fetchSpy.mock.calls.filter(([url]) =>
      typeof url === 'string' && !url.includes('mcp'),
    );
    expect(llmCalls.length).toBe(2);
    const round1Body = JSON.parse((llmCalls[0]?.[1] as RequestInit).body as string) as { tool_choice?: unknown };
    const round2Body = JSON.parse((llmCalls[1]?.[1] as RequestInit).body as string) as { tool_choice?: unknown };
    expect(round1Body.tool_choice).toBe('required');
    // Without the auto-revert, Anthropic 400s here ("required" with no remaining tool work).
    expect(round2Body.tool_choice).toBeUndefined();
  });

  it('omits `tool_choice` entirely from the request when the caller did NOT set it', async () => {
    fetchSpy.mockResolvedValueOnce(chatResponse('ok'));
    const conv = new Conversation(http, { model: 'test-model' });
    await conv.say('hi');
    const [, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(opts.body as string) as { tool_choice?: unknown };
    expect(body.tool_choice).toBeUndefined();
  });

  it('accepts the specific-function shape {type:"function", function:{name}}', async () => {
    fetchSpy.mockResolvedValueOnce(chatResponse('ok'));
    const conv = new Conversation(http, {
      model: 'test-model',
      tool_choice: { type: 'function', function: { name: 'supervisor__delegate' } },
    });
    await conv.say('hi');
    const [, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(opts.body as string) as { tool_choice?: { type: string; function: { name: string } } };
    expect(body.tool_choice).toEqual({ type: 'function', function: { name: 'supervisor__delegate' } });
  });

  it('fork() propagates tool_choice to the new conversation', async () => {
    fetchSpy.mockResolvedValueOnce(chatResponse('a'));
    fetchSpy.mockResolvedValueOnce(chatResponse('b'));
    const parent = new Conversation(http, { model: 'test-model', tool_choice: 'required' });
    await parent.say('first');                              // round 1 of parent
    const child = parent.fork();
    await child.say('second');                              // round 1 of child — required still applies
    const childBody = JSON.parse((fetchSpy.mock.calls[1]?.[1] as RequestInit).body as string) as { tool_choice?: unknown };
    expect(childBody.tool_choice).toBe('required');
  });
});

describe('Conversation.stream() — tool_choice (first-round-only)', () => {
  function sseStream(chunks: string[]): Response {
    const joined = chunks.join('');
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(joined));
        controller.close();
      },
    });
    return new Response(stream, {
      status: 200,
      headers: { 'content-type': 'text/event-stream', 'x-request-id': 'req_sstc' },
    });
  }

  it('forwards `tool_choice` verbatim on round 1 of .stream()', async () => {
    fetchSpy.mockResolvedValueOnce(sseStream([
      'data: {"id":"c1","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}\n\n',
      'data: {"id":"c1","choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":null}]}\n\n',
      'data: {"id":"c1","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":1}}\n\n',
      'data: [DONE]\n\n',
    ]));
    const conv = new Conversation(http, { model: 'test-model', tool_choice: 'required' });
    for await (const _ of await conv.stream('hi')) { /* drain */ }
    const [, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(opts.body as string) as { tool_choice?: unknown };
    expect(body.tool_choice).toBe('required');
  });

  it('drops `tool_choice` on round 2 when round 1 fired a tool', async () => {
    // tools/list for definitions
    fetchSpy.mockResolvedValueOnce(mcpToolsList());
    // round 1: stream emits a tool_call + finish
    fetchSpy.mockResolvedValueOnce(sseStream([
      'data: {"id":"c1","choices":[{"index":0,"delta":{"role":"assistant","tool_calls":[{"index":0,"id":"tc_1","type":"function","function":{"name":"google_search","arguments":"{\\"q\\":\\"x\\"}"}}]},"finish_reason":null}]}\n\n',
      'data: {"id":"c1","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":5,"completion_tokens":3}}\n\n',
      'data: [DONE]\n\n',
    ]));
    // MCP tool execution
    fetchSpy.mockResolvedValueOnce(mcpResponse('search result'));
    // round 2: plain text wrap-up
    fetchSpy.mockResolvedValueOnce(sseStream([
      'data: {"id":"c2","choices":[{"index":0,"delta":{"content":"done"},"finish_reason":null}]}\n\n',
      'data: {"id":"c2","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":1}}\n\n',
      'data: [DONE]\n\n',
    ]));

    const conv = new Conversation(http, { model: 'test-model', tools, tool_choice: 'required' });
    for await (const _ of await conv.stream('go')) { /* drain */ }

    const llmCalls = fetchSpy.mock.calls.filter(([url]) =>
      typeof url === 'string' && !url.includes('mcp'),
    );
    expect(llmCalls.length).toBe(2);
    const round1 = JSON.parse((llmCalls[0]?.[1] as RequestInit).body as string) as { tool_choice?: unknown };
    const round2 = JSON.parse((llmCalls[1]?.[1] as RequestInit).body as string) as { tool_choice?: unknown };
    expect(round1.tool_choice).toBe('required');
    expect(round2.tool_choice).toBeUndefined();
  });
});
