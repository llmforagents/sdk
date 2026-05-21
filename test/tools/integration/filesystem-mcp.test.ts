import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LLM4AgentsClient } from '../../../src/index.js'

const live = process.env['MCP_LIVE'] === '1'

describe.skipIf(!live)('filesystem MCP server (opt-in MCP_LIVE=1)', () => {
  let dir: string
  let client: LLM4AgentsClient

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mcp-live-'))
    await writeFile(join(dir, 'hello.txt'), 'hello from MCP live')
    client = new LLM4AgentsClient({ apiKey: process.env['LLM4AGENTS_API_KEY'] ?? 'sk-proxy-dummy' })
  }, 30_000)

  afterAll(async () => {
    if (client !== undefined) await client.close()
    if (dir !== undefined) await rm(dir, { recursive: true, force: true })
  })

  it('spawns server-filesystem, lists tools, reads a file', async () => {
    const handle = await client.tools.connect({
      name: 'fs',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', dir],
    })
    const tools = await handle.listTools()
    expect(tools.some((t) => t.name === 'read_file' || t.name === 'read_text_file')).toBe(true)

    // The exact tool name varies by version of server-filesystem.
    const readToolName = tools.some((t) => t.name === 'read_text_file') ? 'read_text_file' : 'read_file'
    const result = await client.tools.callTool(readToolName, { path: 'hello.txt' }, { server: 'fs' })
    expect(JSON.stringify(result)).toContain('hello from MCP live')
  }, 60_000)
})
