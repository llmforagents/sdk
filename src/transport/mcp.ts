import { LLM4AgentsError, mapHttpError } from '../errors.js';
import type { McpContent, McpTextContent, McpToolResult } from '../tools/types.js';

function extractText(c: Readonly<Record<string, unknown>>): string {
  const raw = c['text'];
  if (typeof raw === 'string') return raw;
  if (raw !== null && typeof raw === 'object') {
    const wrapped = raw as Record<string, unknown>;
    if (typeof wrapped['text'] === 'string') return wrapped['text'];
  }
  return '';
}

function normalizeContent(c: Readonly<Record<string, unknown>>): McpContent {
  const type = c['type'];

  if (type === 'image') {
    const data =
      (typeof c['data'] === 'string' ? c['data'] : undefined) ??
      (typeof c['imageBase64'] === 'string' ? c['imageBase64'] : undefined) ??
      (typeof c['pngBase64'] === 'string' ? c['pngBase64'] : undefined) ??
      (typeof c['pdfBase64'] === 'string' ? c['pdfBase64'] : undefined) ??
      '';
    const mimeType =
      (typeof c['mimeType'] === 'string' ? c['mimeType'] : undefined) ??
      (typeof c['mime_type'] === 'string' ? c['mime_type'] : undefined) ??
      sniffMimeType(data);
    return { type: 'image', data, mimeType };
  }

  if (type === 'resource') {
    const mimeType =
      (typeof c['mimeType'] === 'string' ? c['mimeType'] : undefined) ??
      (typeof c['mime_type'] === 'string' ? c['mime_type'] : undefined);
    return {
      type: 'resource',
      uri: typeof c['uri'] === 'string' ? c['uri'] : '',
      text: typeof c['text'] === 'string' ? c['text'] : undefined,
      mimeType,
    };
  }

  // default: text
  return { type: 'text', text: extractText(c) };
}

function sniffMimeType(base64: string): string {
  const prefix = base64.slice(0, 4);
  if (prefix === 'iVBO') return 'image/png';
  if (prefix === '/9j/') return 'image/jpeg';
  if (prefix === 'JVBE') return 'application/pdf';
  if (prefix === 'R0lG') return 'image/gif';
  if (prefix === 'UklG') return 'image/webp';
  return 'application/octet-stream';
}

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

  async callTool(name: string, args: object, signal?: AbortSignal): Promise<McpToolResult> {
    const response = await this.rpc<{
      isError?: boolean;
      content: readonly Readonly<Record<string, unknown>>[];
    }>('tools/call', { name, arguments: args }, signal);

    if (response.isError) {
      const errText = (response.content as readonly Record<string, unknown>[])
        .filter((c) => c['type'] === 'text')
        .map((c) => extractText(c))
        .join('\n');
      throw new LLM4AgentsError(
        errText || `Tool ${name} failed`,
        'tool_execution_error',
        undefined,
        undefined,
      );
    }

    const raw = response.content;
    const content: McpContent[] = raw.map((c) => normalizeContent(c));
    const text = content
      .filter((c): c is McpTextContent => c.type === 'text')
      .map((c) => c.text)
      .join('\n');

    return { content, text, raw };
  }

  private async rpc<T>(method: string, params: unknown, signal?: AbortSignal): Promise<T> {
    const timeout = AbortSignal.timeout(this.timeout);
    const combinedSignal = signal
      ? (typeof (AbortSignal as unknown as Record<string, unknown>)['any'] === 'function'
          ? (AbortSignal as unknown as { any: (sigs: AbortSignal[]) => AbortSignal }).any([timeout, signal])
          : signal)
      : timeout;

    let res: Response;
    try {
      res = await fetch(this.mcpUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: this.nextId++, method, params }),
        signal: combinedSignal,
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
      const code = errObj.code === -32601 ? 'tool_not_found' : 'tool_execution_error';
      throw new LLM4AgentsError(
        errObj.message ?? 'MCP error',
        code,
        undefined,
        undefined,
      );
    }

    return parsed['result'] as T;
  }
}
