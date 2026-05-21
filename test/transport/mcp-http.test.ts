import { describe, it, expect, vi } from 'vitest'

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => {
  const Client = vi.fn().mockImplementation(() => ({
    connect: vi.fn(async () => undefined),
    listTools: vi.fn(async () => ({
      tools: [{ name: 'remote_tool', description: 'r', inputSchema: { type: 'object' } }],
    })),
    callTool: vi.fn(async () => ({ content: [{ type: 'text', text: 'remote result' }] })),
    close: vi.fn(async () => undefined),
  }))
  return { Client }
})

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: vi.fn().mockImplementation(() => ({})),
}))

import { connectHttp } from '../../src/transport/mcp-http.js'

describe('connectHttp', () => {
  it('connects to a remote MCP and lists tools', async () => {
    const handle = await connectHttp({ name: 'remote', url: 'https://example.com/mcp' })
    expect(handle.name).toBe('remote')
    const tools = await handle.listTools()
    expect(tools).toHaveLength(1)
    expect(tools[0]?.name).toBe('remote_tool')
  })

  it('passes custom headers through to the transport', async () => {
    const { StreamableHTTPClientTransport } = await import(
      '@modelcontextprotocol/sdk/client/streamableHttp.js'
    )
    await connectHttp({
      name: 'r',
      url: 'https://x',
      headers: { authorization: 'Bearer x' },
    })
    expect(StreamableHTTPClientTransport).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        requestInit: expect.objectContaining({ headers: { authorization: 'Bearer x' } }),
      }),
    )
  })

  it('connect timeout rejects when client.connect hangs', async () => {
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
    ;(Client as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
      connect: vi.fn(() => new Promise(() => {})),
      listTools: vi.fn(),
      callTool: vi.fn(),
      close: vi.fn(),
    }))
    await expect(
      connectHttp({ name: 'slow', url: 'https://x' }, { connectTimeoutMs: 50 }),
    ).rejects.toThrow(/timeout/)
  })

  it('callTool returns the SDK content shape', async () => {
    const handle = await connectHttp({ name: 'r', url: 'https://x' })
    const result = await handle.callTool('any_tool', { foo: 1 })
    expect(result.content[0]).toMatchObject({ type: 'text', text: 'remote result' })
  })
})
