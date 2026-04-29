export interface ToolDefinition {
  readonly type: 'function';
  readonly function: {
    readonly name: string;
    readonly description: string;
    readonly parameters: Readonly<Record<string, unknown>>;
  };
}

export interface McpTextContent {
  readonly type: 'text';
  readonly text: string;
}

export interface McpImageContent {
  readonly type: 'image';
  readonly data: string;
  readonly mimeType: string;
}

export interface McpResourceContent {
  readonly type: 'resource';
  readonly uri: string;
  readonly text?: string | undefined;
  readonly mimeType?: string | undefined;
}

export type McpContent = McpTextContent | McpImageContent | McpResourceContent;

export interface McpToolResult {
  readonly content: readonly McpContent[];
  readonly text: string;
}

export interface FetchHtmlParams {
  readonly url: string;
  readonly proxy?: 'none' | 'datacenter' | 'residential' | undefined;
}

export interface MarkdownParams {
  readonly url: string;
  readonly proxy?: 'none' | 'datacenter' | 'residential' | undefined;
}

export interface LinksParams {
  readonly url: string;
  readonly proxy?: 'none' | 'datacenter' | 'residential' | undefined;
}

export interface ScreenshotParams {
  readonly url: string;
  readonly fullPage?: boolean | undefined;
  readonly proxy?: 'none' | 'datacenter' | 'residential' | undefined;
}

export interface PdfParams {
  readonly url: string;
  readonly proxy?: 'none' | 'datacenter' | 'residential' | undefined;
}

export interface ExtractParams {
  readonly url: string;
  readonly schema: Readonly<Record<string, unknown>>;
  readonly proxy?: 'none' | 'datacenter' | 'residential' | undefined;
}

export interface SessionCreateParams {
  readonly proxy?: 'none' | 'datacenter' | 'residential' | undefined;
  readonly ttl?: number | undefined;
}

export interface SessionExecParams {
  readonly sessionId: string;
  readonly actions: readonly Readonly<Record<string, unknown>>[];
}

export interface SessionParams {
  readonly sessionId: string;
}

export interface GoogleSearchParams {
  readonly q: string;
  readonly gl?: string | undefined;
  readonly hl?: string | undefined;
  readonly tbs?: string | undefined;
  readonly page?: number | undefined;
  readonly location?: string | undefined;
}

export interface GoogleBatchSearchParams {
  readonly queries: readonly string[];
  readonly gl?: string | undefined;
  readonly hl?: string | undefined;
}

export interface ImageGenerateParams {
  readonly prompt: string;
  readonly width?: number | undefined;
  readonly height?: number | undefined;
}

export interface ImageEditParams {
  readonly prompt: string;
  readonly imageUrl?: string | undefined;
  readonly imageBase64?: string | undefined;
}

export interface ImageAnalyzeParams {
  readonly prompt: string;
  readonly imageUrl?: string | undefined;
  readonly imageBase64?: string | undefined;
}
