import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { McpServerHandle } from './mcp-stdio.js'

export type HttpServerConfig = Readonly<{
  name: string
  url: string
  headers?: Readonly<Record<string, string>>
}>

export async function connectHttp(
  cfg: HttpServerConfig,
  options?: { connectTimeoutMs?: number },
): Promise<McpServerHandle> {
  const timeoutMs = options?.connectTimeoutMs ?? 5_000
  // Cast needed: StreamableHTTPClientTransport exposes `sessionId` as a getter
  // returning `string | undefined`, while the Transport interface declares it as
  // `sessionId?: string`. With exactOptionalPropertyTypes these differ — this is
  // an upstream SDK type incompatibility, not a runtime issue.
  const transport = new StreamableHTTPClientTransport(new URL(cfg.url), {
    ...(cfg.headers !== undefined ? { requestInit: { headers: { ...cfg.headers } } } : {}),
  }) as unknown as Transport
  const client = new Client({ name: 'llmforagents-sdk', version: '0.0.1' }, { capabilities: {} })
  await Promise.race([
    client.connect(transport),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`http connect timeout (${timeoutMs}ms)`)),
        timeoutMs,
      ),
    ),
  ])
  return {
    name: cfg.name,
    async listTools() {
      const res = await client.listTools()
      return res.tools
    },
    async callTool(toolName, args) {
      return client.callTool({ name: toolName, arguments: args })
    },
    async disconnect() {
      await client.close()
    },
  }
}
