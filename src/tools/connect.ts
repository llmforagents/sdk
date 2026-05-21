import { connectStdio, type StdioServerConfig, type McpServerHandle } from '../transport/mcp-stdio.js'
import { connectHttp, type HttpServerConfig } from '../transport/mcp-http.js'

export type McpServerConfig =
  | (StdioServerConfig & { transport?: 'stdio' })
  | (HttpServerConfig & { transport: 'http' })

export function isHttpConfig(cfg: McpServerConfig): cfg is HttpServerConfig & { transport: 'http' } {
  // Distinguish HTTP from stdio: HTTP has `url`, stdio has `command`. The explicit
  // `transport: 'http'` discriminator is the canonical form; we also accept just
  // `url` for ergonomics (no explicit discriminator needed if `url` is present
  // and `command` is absent).
  if ((cfg as { transport?: string }).transport === 'http') return true
  if ('url' in cfg && !('command' in cfg)) return true
  return false
}

export async function connect(
  cfg: McpServerConfig,
  options?: { connectTimeoutMs?: number },
): Promise<McpServerHandle> {
  if (isHttpConfig(cfg)) return connectHttp(cfg, options)
  return connectStdio(cfg as StdioServerConfig, options)
}
