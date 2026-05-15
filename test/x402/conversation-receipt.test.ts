/**
 * Verify that the conversation.stream() generator emits an
 * `x402_receipt` StreamEvent when the proxy sends the trailing
 * `event: x402-receipt` SSE chunk in walk-up streaming mode.
 *
 * We don't exercise the full x402 probe-and-sign here (covered by
 * test/x402/transport.test.ts) — this test just confirms the receipt
 * surfaces through the conversation event union.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Conversation } from '../../src/chat/conversation.js';
import { HttpTransport } from '../../src/transport/http.js';
import type { StreamEvent } from '../../src/chat/types.js';

function sseResponseWithReceipt(): Response {
  // Chat chunks + [DONE] + trailing x402-receipt event
  const body = [
    'data: {"id":"c1","choices":[{"index":0,"delta":{"content":"hi"}}]}',
    '',
    'data: {"id":"c1","choices":[{"index":0,"delta":{}, "finish_reason":"stop"}]}',
    '',
    'data: [DONE]',
    '',
    'event: x402-receipt',
    'data: {"transaction":"0xdeadbeef","network":"eip155:84532","amount":"10000","payer":"0xpayer000000000000000000000000000000000001"}',
    '',
  ].join('\n');
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

let fetchSpy: ReturnType<typeof vi.fn>;
let http: HttpTransport;

beforeEach(() => {
  fetchSpy = vi.fn();
  globalThis.fetch = fetchSpy;
  http = new HttpTransport({ baseUrl: 'https://api.test.com', apiKey: 'sk-test', timeout: 5000 });
});

afterEach(() => { vi.restoreAllMocks(); });

describe('Conversation.stream() — x402 receipt event', () => {
  it('yields { type: "x402_receipt", ... } before the done event when the proxy emits a trailing receipt', async () => {
    fetchSpy.mockResolvedValueOnce(sseResponseWithReceipt());

    const conv = new Conversation(http, {
      model: 'openai/gpt-4o-mini',
    });

    const events: StreamEvent[] = [];
    for await (const ev of conv.stream('hello')) {
      events.push(ev);
    }

    const typeOrder = events.map((e) => e.type);
    expect(typeOrder).toContain('text');
    expect(typeOrder).toContain('x402_receipt');
    expect(typeOrder).toContain('done');

    const receipt = events.find((e) => e.type === 'x402_receipt');
    expect(receipt).toBeDefined();
    if (receipt?.type === 'x402_receipt') {
      expect(receipt.transaction).toBe('0xdeadbeef');
      expect(receipt.network).toBe('eip155:84532');
      expect(receipt.amount).toBe('10000');
      expect(receipt.payer).toBe('0xpayer000000000000000000000000000000000001');
    }

    // x402_receipt must come BEFORE done (per the event-ordering contract).
    const receiptIdx = typeOrder.indexOf('x402_receipt');
    const doneIdx = typeOrder.indexOf('done');
    expect(receiptIdx).toBeLessThan(doneIdx);
  });

  it('does not emit x402_receipt on Bearer-mode streams (no trailing event)', async () => {
    const bearerStream = new Response([
      'data: {"id":"c1","choices":[{"index":0,"delta":{"content":"hi"}}]}',
      '',
      'data: {"id":"c1","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
      '',
      'data: [DONE]',
      '',
    ].join('\n'), { status: 200, headers: { 'content-type': 'text/event-stream' } });
    fetchSpy.mockResolvedValueOnce(bearerStream);

    const conv = new Conversation(http, {
      model: 'openai/gpt-4o-mini',
    });

    const events: StreamEvent[] = [];
    for await (const ev of conv.stream('hello')) {
      events.push(ev);
    }

    expect(events.map((e) => e.type)).not.toContain('x402_receipt');
  });
});
