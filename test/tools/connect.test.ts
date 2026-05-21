import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock both transport wrappers so we don't spawn real processes / hit HTTP
vi.mock('../../src/transport/mcp-stdio.js', () => ({
  connectStdio: vi.fn(async (cfg: { name: string }) => ({
    name: cfg.name,
    listTools: vi.fn(async () => []),
    callTool: vi.fn(async () => ({ content: [{ type: 'text', text: 'stdio-result' }] })),
    disconnect: vi.fn(async () => undefined),
  })),
}))
vi.mock('../../src/transport/mcp-http.js', () => ({
  connectHttp: vi.fn(async (cfg: { name: string }) => ({
    name: cfg.name,
    listTools: vi.fn(async () => []),
    callTool: vi.fn(async () => ({ content: [{ type: 'text', text: 'http-result' }] })),
    disconnect: vi.fn(async () => undefined),
  })),
}))

import { connect, isHttpConfig } from '../../src/tools/connect.js'
import { Tools } from '../../src/tools/tools.js'
import { McpTransport } from '../../src/transport/mcp.js'

// ─── isHttpConfig ────────────────────────────────────────────────────────────

describe('isHttpConfig', () => {
  it('detects HTTP via explicit transport tag', () => {
    expect(isHttpConfig({ name: 'r', url: 'https://x', transport: 'http' as const })).toBe(true)
  })
  it('detects HTTP by url-only shape (no command)', () => {
    expect(isHttpConfig({ name: 'r', url: 'https://x' } as never)).toBe(true)
  })
  it('detects stdio by command shape', () => {
    expect(isHttpConfig({ name: 'fs', command: 'npx' } as never)).toBe(false)
  })
  it('treats transport:stdio explicitly as stdio', () => {
    expect(isHttpConfig({ name: 'fs', command: 'npx', transport: 'stdio' as const })).toBe(false)
  })
})

// ─── connect dispatcher ───────────────────────────────────────────────────────

describe('connect dispatcher', () => {
  it('routes stdio configs to connectStdio', async () => {
    const handle = await connect({ name: 'fs', command: 'npx', args: ['-y', 'srv'] })
    const result = await handle.callTool('any', {})
    expect((result as { content: Array<{ text: string }> }).content[0]?.text).toBe('stdio-result')
  })

  it('routes http configs to connectHttp', async () => {
    const handle = await connect({ name: 'r', url: 'https://x', transport: 'http' as const })
    const result = await handle.callTool('any', {})
    expect((result as { content: Array<{ text: string }> }).content[0]?.text).toBe('http-result')
  })

  it('routes http configs by url-only shape to connectHttp', async () => {
    const handle = await connect({ name: 'r2', url: 'https://y' } as never)
    const result = await handle.callTool('any', {})
    expect((result as { content: Array<{ text: string }> }).content[0]?.text).toBe('http-result')
  })
})

// ─── Tools class registry ────────────────────────────────────────────────────

let tools: Tools
let fetchSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchSpy = vi.fn()
  globalThis.fetch = fetchSpy
  const mcp = new McpTransport({ mcpUrl: 'https://mcp.test.com/mcp', apiKey: 'key', timeout: 60000 })
  tools = new Tools(mcp)
})

afterEach(() => { vi.restoreAllMocks() })

describe('Tools.connect()', () => {
  it('returns the handle and stores it in the registry', async () => {
    const handle = await tools.connect({ name: 'my-server', command: 'npx', args: ['-y', 'srv'] })
    expect(handle).toBeDefined()
    expect(handle.name).toBe('my-server')
    expect(tools.connectedServers()).toContain('my-server')
  })

  it('throws when connecting the same name twice', async () => {
    await tools.connect({ name: 'dup', command: 'npx' })
    await expect(tools.connect({ name: 'dup', command: 'npx' })).rejects.toThrow(
      'MCP server "dup" is already connected',
    )
  })
})

describe('Tools.connectedServers()', () => {
  it('lists names of all registered servers', async () => {
    await tools.connect({ name: 'a', command: 'npx' })
    await tools.connect({ name: 'b', url: 'https://x', transport: 'http' as const })
    const names = tools.connectedServers()
    expect(names).toContain('a')
    expect(names).toContain('b')
    expect(names).toHaveLength(2)
  })

  it('returns an empty list when no servers are connected', () => {
    expect(tools.connectedServers()).toHaveLength(0)
  })
})

describe('Tools.disconnect()', () => {
  it('removes the server from the registry and calls handle.disconnect()', async () => {
    const handle = await tools.connect({ name: 'to-disconnect', command: 'npx' })
    await tools.disconnect('to-disconnect')
    expect(tools.connectedServers()).not.toContain('to-disconnect')
    expect(handle.disconnect).toHaveBeenCalledOnce()
  })

  it('throws when the server is not registered', async () => {
    await expect(tools.disconnect('nonexistent')).rejects.toThrow(
      'No connected MCP server named "nonexistent"',
    )
  })
})

describe('Tools.disconnectAll()', () => {
  it('clears the registry and calls disconnect on each handle', async () => {
    const h1 = await tools.connect({ name: 'x', command: 'npx' })
    const h2 = await tools.connect({ name: 'y', url: 'https://z', transport: 'http' as const })
    await tools.disconnectAll()
    expect(tools.connectedServers()).toHaveLength(0)
    expect(h1.disconnect).toHaveBeenCalledOnce()
    expect(h2.disconnect).toHaveBeenCalledOnce()
  })

  it('is a no-op when no servers are connected', async () => {
    await expect(tools.disconnectAll()).resolves.toBeUndefined()
  })
})

describe('Tools.callTool()', () => {
  it('dispatches to the registered handle when options.server is set', async () => {
    await tools.connect({ name: 'srv', command: 'npx' })
    const result = await tools.callTool('my-tool', { foo: 'bar' }, { server: 'srv' })
    // The mock handle returns { content: [{ type: 'text', text: 'stdio-result' }] }
    expect((result as unknown as { content: Array<{ text: string }> }).content[0]?.text).toBe('stdio-result')
  })

  it('throws when options.server names a server that is not registered', async () => {
    await expect(
      tools.callTool('my-tool', {}, { server: 'missing' }),
    ).rejects.toThrow('No connected MCP server named "missing"')
  })

  it('falls back to the proxy gateway when options.server is not set', async () => {
    const mockResult = { result: { content: [{ type: 'text', text: 'proxy-result' }] } }
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(mockResult), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const result = await tools.callTool('google_search', { q: 'test' })
    expect(result.text).toBe('proxy-result')
  })

  it('falls back to the proxy gateway when options is undefined', async () => {
    const mockResult = { result: { content: [{ type: 'text', text: 'proxy-fallback' }] } }
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(mockResult), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const result = await tools.callTool('fetch_html', { url: 'https://example.com' })
    expect(result.text).toBe('proxy-fallback')
  })
})
