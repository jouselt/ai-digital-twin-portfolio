import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  EMBEDDING_DIMENSIONS,
  MAX_TOKENS_CAP,
  RETRIEVAL_MIN_SCORE,
} from './index';
import { encodeSseEvent, parseSseFrame, splitSseBuffer } from './sse';
import type { ChatEvent, SourceRef } from './index';

const source: SourceRef = {
  chunkId: 'f1f1',
  projectId: 'splunk-commerce-observability',
  title: 'Commerce API observability',
  section: 'What shipped',
  content: 'Structured logging with correlation ids across 6+ Commerce APIs.',
  score: 0.72,
};

test('constants match the constraint the database enforces', () => {
  assert.equal(EMBEDDING_DIMENSIONS, 768);
  assert.equal(RETRIEVAL_MIN_SCORE, 0.3);
  assert.equal(MAX_TOKENS_CAP, 220);
});

test('every frame type survives an encode and decode round trip', () => {
  const events: ChatEvent[] = [
    { type: 'trace', trace_id: '01HQ-trace' },
    { type: 'retrieved', sources: [source] },
    { type: 'delta', text: 'Shipped structured logging [1].' },
    {
      type: 'abstain',
      reason: 'no_retrieval_above_floor',
      suggestions: ['the POS WebSocket integration', 'the Quick Quote Vista build'],
    },
    { type: 'done', grounded: 1, tokens_out: 42, elapsed_ms: 10600 },
    { type: 'error', message: 'ollama unreachable' },
  ];

  for (const event of events) {
    assert.deepEqual(parseSseFrame(encodeSseEvent(event)), event, event.type);
  }
});

test('frames are emitted in the order the client expects', () => {
  const wire =
    encodeSseEvent({ type: 'trace', trace_id: 't1' }) +
    encodeSseEvent({ type: 'retrieved', sources: [source] }) +
    encodeSseEvent({ type: 'delta', text: 'a' }) +
    encodeSseEvent({ type: 'done', grounded: 1, tokens_out: 1, elapsed_ms: 5 });

  const parsed = splitSseBuffer(wire).frames.map(parseSseFrame);
  assert.deepEqual(
    parsed.map((frame) => frame?.type),
    ['trace', 'retrieved', 'delta', 'done'],
  );
  assert.equal(splitSseBuffer(wire).rest, '');
});

test('an incomplete buffer keeps its tail for the next chunk', () => {
  const first = encodeSseEvent({ type: 'trace', trace_id: 't1' });
  const second = encodeSseEvent({ type: 'delta', text: 'partial' });
  const { frames, rest } = splitSseBuffer(first + second.slice(0, 10));

  assert.equal(frames.length, 1);
  assert.equal(parseSseFrame(frames[0]!)?.type, 'trace');
  assert.equal(splitSseBuffer(rest + second.slice(10)).frames.length, 1);
});

test('malformed and unknown frames decode to null instead of throwing', () => {
  const rejected = [
    '',
    ': keep-alive',
    'event: message',
    'data:',
    'data: {not json}',
    'data: {"type":"telepathy"}',
    'data: {"type":"delta"}',
    'data: {"type":"trace","trace_id":42}',
    'data: {"type":"retrieved","sources":[{"chunkId":"x"}]}',
    'data: {"type":"done","grounded":"1","tokens_out":1,"elapsed_ms":1}',
  ];

  for (const line of rejected) {
    assert.equal(parseSseFrame(line), null, line);
  }
});
