import type { AskRequest, ChatEvent, SourceRef } from '@twin/contracts';

import { FakeLlmProvider } from '../providers/fakes';
import { FakeRetrievalPort } from '../retrieval/retrieval.port';
import { ChatService, isDecline } from './chat.service';

const sources: SourceRef[] = [
  {
    chunkId: 'chunk-1',
    projectId: 'commerce-observability',
    title: 'Commerce API observability',
    section: 'What shipped',
    content: 'Structured logging with correlation ids across 6+ Commerce APIs.',
    score: 0.74,
  },
  {
    chunkId: 'chunk-2',
    projectId: 'pos-websocket',
    title: 'POS WebSocket bridge',
    section: 'Constraint',
    content: 'A bridge between the web storefront and the POS under PCI constraints.',
    score: 0.61,
  },
  {
    chunkId: 'chunk-3',
    projectId: 'quick-quote-vista',
    title: 'Quick Quote Vista',
    section: 'Outcome',
    content: 'Eight international variants serving 20,000+ daily users.',
    score: 0.44,
  },
];

const titles = ['Commerce API observability', 'POS WebSocket bridge', 'Quick Quote Vista'];

function request(overrides: Partial<AskRequest> = {}): AskRequest {
  return {
    question: 'How did he handle observability on the Commerce APIs?',
    history: [],
    ...overrides,
  };
}

async function collect(service: ChatService, ask: AskRequest = request()): Promise<ChatEvent[]> {
  const frames: ChatEvent[] = [];
  for await (const frame of service.ask(ask, 'trace-1')) frames.push(frame);
  return frames;
}

function serviceWith(
  llm: FakeLlmProvider,
  retrieval: FakeRetrievalPort = new FakeRetrievalPort(sources, titles),
): ChatService {
  return new ChatService(retrieval, llm);
}

function textOf(frames: readonly ChatEvent[]): string {
  return frames
    .filter((frame): frame is Extract<ChatEvent, { type: 'delta' }> => frame.type === 'delta')
    .map((frame) => frame.text)
    .join('');
}

describe('ChatService frame ordering', () => {
  it('emits trace, retrieved, delta, done, twenty times in a row', async () => {
    const llm = new FakeLlmProvider(['Adopted ', 'structured logging ', 'with correlation ids [1].']);
    const service = serviceWith(llm);

    for (let run = 0; run < 20; run += 1) {
      const frames = await collect(service);
      expect(frames[0]?.type).toBe('trace');
      expect(frames[1]?.type).toBe('retrieved');
      expect(frames[frames.length - 1]?.type).toBe('done');
      expect(frames.filter((frame) => frame.type === 'done')).toHaveLength(1);
      expect(frames.some((frame) => frame.type === 'abstain')).toBe(false);
    }

    expect(llm.streamCalls).toBe(20);
  });

  it('sends retrieved before the first delta so the citation list renders early', async () => {
    const frames = await collect(serviceWith(new FakeLlmProvider(['Adopted correlation ids [1].'])));

    const retrievedAt = frames.findIndex((frame) => frame.type === 'retrieved');
    const firstDeltaAt = frames.findIndex((frame) => frame.type === 'delta');
    expect(retrievedAt).toBeLessThan(firstDeltaAt);
    expect(frames[retrievedAt]).toMatchObject({ type: 'retrieved', sources });
  });

  it('reports grounded 1 and an estimated token count when every marker resolves', async () => {
    const frames = await collect(serviceWith(new FakeLlmProvider(['Shipped the payments bridge [1][2].'])));

    const done = frames.at(-1);
    expect(done).toMatchObject({ type: 'done', grounded: 1 });
    expect((done as { tokens_out: number }).tokens_out).toBeGreaterThan(0);
    expect((done as { elapsed_ms: number }).elapsed_ms).toBeGreaterThanOrEqual(0);
  });
});

describe('ChatService abstention', () => {
  it('abstains without calling the model when nothing clears the score floor', async () => {
    const llm = new FakeLlmProvider(['never used']);
    const frames = await collect(serviceWith(llm, new FakeRetrievalPort([], titles)));

    expect(frames.map((frame) => frame.type)).toEqual(['trace', 'retrieved', 'abstain']);
    expect(frames.at(-1)).toMatchObject({
      type: 'abstain',
      reason: 'no_retrieval_above_floor',
      suggestions: titles,
    });
    expect(llm.streamCalls).toBe(0);
  });

  it('never lets the decline token reach the client as answer text', async () => {
    const frames = await collect(serviceWith(new FakeLlmProvider(['ABSENT'])));

    expect(textOf(frames)).toBe('');
    expect(frames.at(-1)).toMatchObject({ type: 'abstain', reason: 'model_declined' });
    expect(JSON.stringify(frames)).not.toContain('ABSENT');
  });

  it('treats a decline split across deltas, with trailing punctuation, as a decline', async () => {
    const frames = await collect(serviceWith(new FakeLlmProvider(['ABS', 'ENT.'])));

    expect(textOf(frames)).toBe('');
    expect(frames.at(-1)).toMatchObject({ type: 'abstain', reason: 'model_declined' });
  });

  it('abstains after streaming when the answer cites a source that was never retrieved', async () => {
    const frames = await collect(serviceWith(new FakeLlmProvider(['Made this up [9].'])));

    expect(textOf(frames)).toBe('Made this up [9].');
    expect(frames.at(-1)).toMatchObject({ type: 'abstain', reason: 'unknown_citations' });
  });

  it('abstains when only some markers resolve', async () => {
    const frames = await collect(serviceWith(new FakeLlmProvider(['Real [1] and invented [7].'])));

    expect(frames.at(-1)).toMatchObject({ type: 'abstain', reason: 'unknown_citations' });
  });

  it('abstains when the model answers without citing anything', async () => {
    const frames = await collect(serviceWith(new FakeLlmProvider(['He did a lot of good work.'])));

    // Its own reason: citing nothing is a different defect from citing a ghost.
    expect(frames.at(-1)).toMatchObject({ type: 'abstain', reason: 'no_citations' });
  });

  it('abstains when the answer is markers with no sentence around them', async () => {
    const frames = await collect(serviceWith(new FakeLlmProvider(['[1][2]'])));

    expect(frames.at(-1)).toMatchObject({ type: 'abstain', reason: 'no_prose' });
  });

  it('offers three real topics with every abstention, so the visitor has somewhere to go', async () => {
    const frames = await collect(serviceWith(new FakeLlmProvider(['Made this up [9].'])));

    const terminal = frames.at(-1);
    if (terminal?.type !== 'abstain') throw new Error('expected a terminal abstain frame');
    expect(terminal.suggestions).toHaveLength(3);
    expect(terminal.suggestions.every((suggestion) => titles.includes(suggestion))).toBe(true);
  });
});

describe('ChatService model options', () => {
  it('clamps a caller asking for more tokens than the cap', async () => {
    const llm = new FakeLlmProvider(['Ok [1].']);
    await collect(serviceWith(llm), request({ max_tokens: 2000 }));

    expect(llm.lastOptions?.maxTokens).toBe(220);
  });

  it('defaults to the cap when the caller says nothing', async () => {
    const llm = new FakeLlmProvider(['Ok [1].']);
    await collect(serviceWith(llm));

    expect(llm.lastOptions?.maxTokens).toBe(220);
    expect(llm.lastOptions?.temperature).toBe(0.2);
  });

  it('forwards only the last six history turns plus the question', async () => {
    const llm = new FakeLlmProvider(['Ok [1].']);
    const history = Array.from({ length: 8 }, (_, index) => ({
      role: (index % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `turn ${index}`,
    }));

    await collect(serviceWith(llm), request({ history }));

    expect(llm.lastMessages).toHaveLength(7);
    expect(llm.lastMessages[0]).toMatchObject({ content: 'turn 2' });
    expect(llm.lastMessages.at(-1)).toMatchObject({
      role: 'user',
      content: 'How did he handle observability on the Commerce APIs?',
    });
  });

  it('puts the numbered sources and the refusal rule in the system prompt', async () => {
    const llm = new FakeLlmProvider(['Ok [1].']);
    await collect(serviceWith(llm));

    const system = llm.lastOptions?.system ?? '';
    expect(system).toContain('[1] Commerce API observability / What shipped');
    expect(system).toContain('[3] Quick Quote Vista / Outcome');
    expect(system).toContain('reply with exactly:\nABSENT');
  });
});

describe('decline detection', () => {
  it('accepts the token with surrounding whitespace and trailing punctuation', () => {
    expect(isDecline('ABSENT')).toBe(true);
    expect(isDecline('  absent.  ')).toBe(true);
    expect(isDecline('Absent')).toBe(true);
  });

  it('rejects an answer that merely starts with the token', () => {
    expect(isDecline('ABSENT from the sources, but he shipped logging [1].')).toBe(false);
    expect(isDecline('')).toBe(false);
  });
});
