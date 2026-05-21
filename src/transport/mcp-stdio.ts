import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { Tool, CompatibilityCallToolResult } from '@modelcontextprotocol/sdk/types.js'

export type StdioServerConfig = Readonly<{
  name: string
  command: string
  args?: readonly string[]
  env?: Readonly<Record<string, string>>
  cwd?: string
}>

export type McpServerHandle = Readonly<{
  name: string
  listTools(): Promise<readonly Tool[]>
  callTool(toolName: string, args: Readonly<Record<string, unknown>>): Promise<CompatibilityCallToolResult>
  disconnect(): Promise<void>
}>

export async function connectStdio(
  cfg: StdioServerConfig,
  options?: { connectTimeoutMs?: number },
): Promise<McpServerHandle> {
  const timeoutMs = options?.connectTimeoutMs ?? 5_000
  const transport = new StdioClientTransport({
    command: cfg.command,
    args: cfg.args !== undefined ? [...cfg.args] : [],
    ...(cfg.env !== undefined ? { env: { ...cfg.env } } : {}),
    ...(cfg.cwd !== undefined ? { cwd: cfg.cwd } : {}),
  })
  const client = new Client({ name: 'llmforagents-sdk', version: '0.0.1' }, { capabilities: {} })
  await Promise.race([
    client.connect(transport),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`stdio connect timeout (${timeoutMs}ms)`)),
        timeoutMs,
      ),
    ),
  ])
  return {
    name: cfg.name,
    async listTools(): Promise<readonly Tool[]> {
      const res = await client.listTools()
      return res.tools
    },
    async callTool(toolName, args): Promise<CompatibilityCallToolResult> {
      return client.callTool({ name: toolName, arguments: args })
    },
    async disconnect(): Promise<void> {
      await client.close()
    },
  }
}
