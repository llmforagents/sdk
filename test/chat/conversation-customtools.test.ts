import { describe, it, expect, vi } from 'vitest'
import { LLM4AgentsClient } from '../../src/index.js'

function sseStream(chunks: string[]): Response {
  const joined = chunks.join('')
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(joined))
      controller.close()
    },
  })
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream', 'x-request-id': 'req_ct' },
  })
}

describe('conversation customTools', () => {
  it('includes customTools definitions in tools array sent to proxy', async () => {
    let capturedBody: unknown = null
    global.fetch = vi.fn(async (_url: unknown, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string)
      return sseStream([
        'data: {"id":"c1","choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":null}]}\n\n',
        'data: {"id":"c1","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":2}}\n\n',
        'data: [DONE]\n\n',
      ])
    }) as never

    const customTools = {
      async getDefinitions() {
        return [{ type: 'function' as const, function: { name: 'slack.post', description: 'post to slack', parameters: { type: 'object' } } }]
      },
      async call(_name: string, _args: Record<string, unknown>) { return 'unused' },
    }

    const client = new LLM4AgentsClient({ apiKey: 'k' })
    const conv = client.chat.conversation({ model: 'glm-4.5', system: 's', customTools })
    const events: unknown[] = []
    for await (const e of conv.stream('hi')) events.push(e)

    const body = capturedBody as { tools?: { function: { name: string } }[] }
    const toolNames = (body.tools ?? []).map((t) => t.function.name)
    expect(toolNames).toContain('slack.post')
  })

  it('routes tool_call to customTools.call when name matches', async () => {
    let callCount = 0
    global.fetch = vi.fn(async () => {
      callCount++
      if (callCount === 1) {
        // First round: LLM returns a tool call
        return sseStream([
          'data: {"id":"c1","choices":[{"index":0,"delta":{"role":"assistant","tool_calls":[{"index":0,"id":"t1","type":"function","function":{"name":"slack.post","arguments":""}}]},"finish_reason":null}]}\n\n',
          'data: {"id":"c1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"text\\":\\"hi\\"}"}}]},"finish_reason":null}]}\n\n',
          'data: {"id":"c1","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":10,"completion_tokens":5}}\n\n',
          'data: [DONE]\n\n',
        ])
      }
      // Second round: LLM final response
      return sseStream([
        'data: {"id":"c2","choices":[{"index":0,"delta":{"content":"done"},"finish_reason":null}]}\n\n',
        'data: {"id":"c2","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":15,"completion_tokens":4}}\n\n',
        'data: [DONE]\n\n',
      ])
    }) as never

    const customToolsCall = vi.fn(async () => 'tool result')
    const customTools = {
      async getDefinitions() {
        return [{ type: 'function' as const, function: { name: 'slack.post', description: 'x', parameters: { type: 'object' } } }]
      },
      call: customToolsCall,
    }

    const client = new LLM4AgentsClient({ apiKey: 'k' })
    const conv = client.chat.conversation({ model: 'glm-4.5', system: 's', customTools })
    for await (const _ of conv.stream('hi')) { /* drain */ }
    expect(customToolsCall).toHaveBeenCalled()
    expect(customToolsCall.mock.calls[0]?.[0]).toBe('slack.post')
    expect(customToolsCall.mock.calls[0]?.[1]).toEqual({ text: 'hi' })
  })
})
