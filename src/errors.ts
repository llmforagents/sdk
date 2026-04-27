export type ErrorCode =
  // Auth & general
  | 'auth_error'
  | 'rate_limited'
  | 'network_error'
  | 'timeout'
  | 'api_error'
  // Chat
  | 'model_not_found'
  | 'model_disabled'
  | 'context_overflow'
  // Billing
  | 'insufficient_balance'
  // Transfer (gasless)
  | 'gas_spike'
  | 'signature_mismatch'
  | 'invalid_token'
  | 'operator_unavailable'
  | 'deadline_expired'
  // Tools (MCP)
  | 'tool_not_found'
  | 'tool_execution_error'
  // Conversation
  | 'tool_loop_limit';

export class LLM4AgentsError extends Error {
  override readonly name = 'LLM4AgentsError' as const;

  constructor(
    message: string,
    public readonly code: ErrorCode,
    public readonly statusCode: number | undefined,
    public readonly requestId: string | undefined,
  ) {
    super(message);
  }
}

export function mapHttpError(
  status: number,
  body: string,
  requestId?: string | undefined,
): LLM4AgentsError {
  const lc = body.toLowerCase();

  if (status === 401 || status === 403) {
    return new LLM4AgentsError(body, 'auth_error', status, requestId);
  }
  if (status === 402) {
    return new LLM4AgentsError(body, 'insufficient_balance', status, requestId);
  }
  if (status === 404 && lc.includes('model')) {
    return new LLM4AgentsError(body, 'model_not_found', status, requestId);
  }
  if (status === 409) {
    return new LLM4AgentsError(body, 'gas_spike', status, requestId);
  }
  if (status === 422) {
    if (lc.includes('signature')) {
      return new LLM4AgentsError(body, 'signature_mismatch', status, requestId);
    }
    if (lc.includes('token') || lc.includes('chain')) {
      return new LLM4AgentsError(body, 'invalid_token', status, requestId);
    }
    if (lc.includes('model')) {
      return new LLM4AgentsError(body, 'model_disabled', status, requestId);
    }
    return new LLM4AgentsError(body, 'api_error', status, requestId);
  }
  if (status === 429) {
    return new LLM4AgentsError(body, 'rate_limited', status, requestId);
  }
  if (status === 503) {
    return new LLM4AgentsError(body, 'operator_unavailable', status, requestId);
  }
  if (status === 400 && lc.includes('deadline')) {
    return new LLM4AgentsError(body, 'deadline_expired', status, requestId);
  }

  return new LLM4AgentsError(body, 'api_error', status, requestId);
}
