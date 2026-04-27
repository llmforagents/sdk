import type { ClientOptions } from './types.js';
import { HttpTransport } from './transport/http.js';
import { McpTransport } from './transport/mcp.js';
import { ChatCompletions } from './chat/completions.js';
import { Conversation } from './chat/conversation.js';
import { Wallets } from './wallets/wallets.js';
import { Transfer } from './transfer/transfer.js';
import { Tools } from './tools/tools.js';
import type { ModelInfo } from './types.js';
import type { ConversationOptions } from './chat/types.js';

const DEFAULT_BASE_URL = 'https://api.llm4agents.com';
const DEFAULT_MCP_URL = 'https://mcp.llm4agents.com/mcp';
const DEFAULT_TIMEOUT = 30_000;
const MCP_TIMEOUT = 60_000;

export class LLM4AgentsClient {
  readonly chat: {
    readonly completions: ChatCompletions;
    readonly conversation: (opts: ConversationOptions) => Conversation;
  };
  readonly wallets: Wallets;
  readonly transfer: Transfer;
  readonly tools: Tools;
  readonly models: { readonly list: () => Promise<readonly ModelInfo[]> };

  constructor(opts: ClientOptions) {
    const baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
    const mcpUrl = opts.mcpUrl ?? DEFAULT_MCP_URL;
    const timeout = opts.timeout ?? DEFAULT_TIMEOUT;

    const http = new HttpTransport({ baseUrl, apiKey: opts.apiKey, timeout });
    const mcp = new McpTransport({ mcpUrl, apiKey: opts.apiKey, timeout: MCP_TIMEOUT });

    const completions = new ChatCompletions(http);
    const tools = new Tools(mcp);

    this.chat = {
      completions,
      conversation: (convOpts: ConversationOptions) => new Conversation(http, convOpts),
    };
    this.wallets = new Wallets(http);
    this.transfer = new Transfer(http);
    this.tools = tools;
    this.models = {
      list: () => http.get<{ models: ModelInfo[]; requestId: string }>('/api/v1/models/')
        .then((res) => res.models),
    };
  }
}
