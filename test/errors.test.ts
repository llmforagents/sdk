import { describe, it, expect } from 'vitest';
import { LLM4AgentsError, mapHttpError } from '../src/errors.js';
import type { ErrorCode } from '../src/errors.js';

describe('LLM4AgentsError', () => {
  it('extends Error with code, statusCode, and requestId', () => {
    const err = new LLM4AgentsError('something broke', 'api_error', 500, 'req_123');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(LLM4AgentsError);
    expect(err.message).toBe('something broke');
    expect(err.code).toBe('api_error');
    expect(err.statusCode).toBe(500);
    expect(err.requestId).toBe('req_123');
    expect(err.name).toBe('LLM4AgentsError');
  });

  it('statusCode and requestId are undefined for network errors', () => {
    const err = new LLM4AgentsError('fetch failed', 'network_error', undefined, undefined);
    expect(err.statusCode).toBeUndefined();
    expect(err.requestId).toBeUndefined();
  });
});

describe('mapHttpError', () => {
  it('maps 401 to auth_error', () => {
    const err = mapHttpError(401, 'Unauthorized');
    expect(err.code).toBe('auth_error');
    expect(err.statusCode).toBe(401);
  });

  it('maps 403 to auth_error', () => {
    const err = mapHttpError(403, 'Forbidden');
    expect(err.code).toBe('auth_error');
  });

  it('maps 402 to insufficient_balance', () => {
    const err = mapHttpError(402, 'Insufficient balance');
    expect(err.code).toBe('insufficient_balance');
  });

  it('maps 404 with "model" to model_not_found', () => {
    const err = mapHttpError(404, 'Model not found');
    expect(err.code).toBe('model_not_found');
  });

  it('maps 404 without model keyword to api_error', () => {
    const err = mapHttpError(404, 'Not found');
    expect(err.code).toBe('api_error');
  });

  it('maps 409 to gas_spike', () => {
    const err = mapHttpError(409, 'Gas price changed');
    expect(err.code).toBe('gas_spike');
  });

  it('maps 422 with "signature" to signature_mismatch', () => {
    const err = mapHttpError(422, 'permit signature recovery failed');
    expect(err.code).toBe('signature_mismatch');
  });

  it('maps 422 with "token" to invalid_token', () => {
    const err = mapHttpError(422, 'Token not in registry');
    expect(err.code).toBe('invalid_token');
  });

  it('maps 422 with "chain" to invalid_token', () => {
    const err = mapHttpError(422, 'Chain not supported');
    expect(err.code).toBe('invalid_token');
  });

  it('maps 422 with "model" to model_disabled', () => {
    const err = mapHttpError(422, 'Model is disabled');
    expect(err.code).toBe('model_disabled');
  });

  it('maps 429 to rate_limited', () => {
    const err = mapHttpError(429, 'Rate limit exceeded');
    expect(err.code).toBe('rate_limited');
  });

  it('maps 503 to operator_unavailable', () => {
    const err = mapHttpError(503, 'Operator paused');
    expect(err.code).toBe('operator_unavailable');
  });

  it('maps 400 with "deadline" to deadline_expired', () => {
    const err = mapHttpError(400, 'Signature deadline has already passed');
    expect(err.code).toBe('deadline_expired');
  });

  it('maps 400 without deadline keyword to api_error', () => {
    const err = mapHttpError(400, 'Invalid request body');
    expect(err.code).toBe('api_error');
  });

  it('maps unknown 5xx to api_error', () => {
    const err = mapHttpError(502, 'Bad Gateway');
    expect(err.code).toBe('api_error');
  });

  it('includes requestId when provided', () => {
    const err = mapHttpError(401, 'Unauthorized', 'req_abc');
    expect(err.requestId).toBe('req_abc');
  });
});
