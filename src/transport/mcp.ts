import { LLM4AgentsError, mapHttpError } from '../errors.js';

export interface McpTransportOptions {
  readonly mcpUrl: string;
  readonly apiKey: string;
  readonly timeout: number;
}

export interface McpToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

export class McpTransport {
  private readonly mcpUrl: string;
  private readonly apiKey: string;
  private readonly timeout: number;
  private cachedTools: readonly McpToolDefinition[] | undefined;
  private nextId = 1;

  constructor(opts: McpTransportOptions) {
    this.mcpUrl = opts.mcpUrl;
    this.apiKey = opts.apiKey;
    this.timeout = opts.timeout;
  }

  async listTools(): Promise<readonly McpToolDefinition[]> {
    if (this.cachedTools) {
      return this.cachedTools;
    }

    const response = await this.rpc<{ tools: McpToolDefinition[] }>('tools/list', {});
    this.cachedTools = response.tools;
    return this.cachedTools;
  }

  async callTool(name: string, args: object): Promise<string> {
    const response = await this.rpc<{
      isError?: boolean;
      content: readonly { type: string; text: string }[];
    }>('tools/call', { name, arguments: args });

    const text = response.content
      .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
      .map((c) => c.text)
      .join('\n');

    if (response.isError) {
      throw new LLM4AgentsError(
        text || `Tool ${name} failed`,
        'tool_execution_error',
        undefined,
        undefined,
      );
    }

    return text;
  }

  private async rpc<T>(method: string, params: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(this.mcpUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: this.nextId++, method, params }),
        signal: AbortSignal.timeout(this.timeout),
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new LLM4AgentsError('MCP request timed out', 'timeout', undefined, undefined);
      }
      const message = err instanceof Error ? err.message : 'MCP network request failed';
      throw new LLM4AgentsError(message, 'network_error', undefined, undefined);
    }

    const text = await res.text();

    if (!res.ok) {
      throw mapHttpError(res.status, text);
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new LLM4AgentsError('Invalid JSON from MCP', 'api_error', res.status, undefined);
    }

    if ('error' in parsed && parsed['error']) {
      const errObj = parsed['error'] as { message?: string; code?: number };
      throw new LLM4AgentsError(
        errObj.message ?? 'MCP error',
        'tool_execution_error',
        undefined,
        undefined,
      );
    }

    return parsed['result'] as T;
  }
}
