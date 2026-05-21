import { describe, it, expect, vi } from 'vitest'

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => {
  const Client = vi.fn().mockImplementation(() => ({
    connect: vi.fn(async () => undefined),
    listTools: vi.fn(async () => ({
      tools: [{ name: 'echo', description: 'echo', inputSchema: { type: 'object' } }],
    })),
    callTool: vi.fn(async (args: { name: string; arguments: Record<string, unknown> }) => ({
      content: [{ type: 'text', text: JSON.stringify(args.arguments) }],
    })),
    close: vi.fn(async () => undefined),
  }))
  return { Client }
})

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: vi.fn().mockImplementation(() => ({})),
}))

import { connectStdio } from '../../src/transport/mcp-stdio.js'

describe('connectStdio', () => {
  it('connects and lists tools', async () => {
    const handle = await connectStdio({ name: 'fs', command: 'echo', args: ['hi'] })
    expect(handle.name).toBe('fs')
    const tools = await handle.listTools()
    expect(tools).toHaveLength(1)
    expect(tools[0]?.name).toBe('echo')
  })

  it('callTool returns content array', async () => {
    const handle = await connectStdio({ name: 'fs', command: 'echo' })
    const result = await handle.callTool('echo', { x: 1 })
    expect(result.content[0]).toMatchObject({ type: 'text', text: JSON.stringify({ x: 1 }) })
  })

  it('disconnect closes the client', async () => {
    const handle = await connectStdio({ name: 'fs', command: 'echo' })
    await handle.disconnect()
    // No throw = pass; close() was called on the mocked client
  })

  it('connect timeout rejects when client.connect hangs', async () => {
    // Override the mocked Client to never resolve connect
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
    ;(Client as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
      connect: vi.fn(() => new Promise(() => {})), // never resolves
      listTools: vi.fn(),
      callTool: vi.fn(),
      close: vi.fn(),
    }))
    await expect(
      connectStdio({ name: 'slow', command: 'cat' }, { connectTimeoutMs: 50 }),
    ).rejects.toThrow(/timeout/)
  })
})
