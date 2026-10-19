import type { AskRequest, ChatEvent, SourceRef } from '@twin/contracts';

import { CannedGenerator } from './generation';
import { ask, hasProse, isDecline, messagesFor, type TwinEngineDeps } from './orchestrator';

const sources: SourceRef[] = [
  {
    chunkId: 'commerce-observability:1',
    projectId: 'commerce-observability',
    title: 'Structured logging across Commerce APIs',
    section: 'Outcome',
    content: 'The pattern and the dashboards were adopted across 6+ Commerce APIs.',
    score: 0.71,
  },
  {
    chunkId: 'commerce-observability:2',
    projectId: 'commerce-observability',
    title: 'Structured logging across Commerce APIs',
    section: 'Context',
    content: 'Commerce is a set of APIs maintained by several teams.',
    score: 0.55,
  },
  {
    chunkId: 'quick-quote-api:1',
    projectId: 'quick-quote-api',
    title: 'Quick Quote API and its observability',
    section: 'What I did',
    content: 'It validates incoming parameters and writes structured logs with diagLog.',
    score: 0.34,
  },
];

const titles = [
  'Structured logging across Commerce APIs',
  'Quick Quote API and its observability',
  'Quick Quote Vista web component',
];

function deps(generation: CannedGenerator, overrides: Partial<TwinEngineDeps> = {}): TwinEngineDeps {
  return {
    generation,
    search: () => sources,
    suggestions: () => titles,
    ...overrides,
  };
}

function request(overrides: Partial<AskRequest> = {}): AskRequest {
  return { question: 'How did he handle observability?', history: [], ...overrides };
}

async function collect(generator: CannedGenerator, overrides: Partial<TwinEngineDeps> = {}): Promise<ChatEvent[]> {
  const frames: ChatEvent[] = [];
  for await (const frame of ask(request(), 'trace-1', deps(generator, overrides))) frames.push(frame);
  return frames;
}

function textOf(frames: readonly ChatEvent[]): string {
  return frames
    .filter((frame): frame is Extract<ChatEvent, { type: 'delta' }> => frame.type === 'delta')
    .map((frame) => frame.text)
    .join('');
}

function answering(): CannedGenerator {
  return new CannedGenerator([], ['Adopted across ', '6+ Commerce APIs [1].']);
}

describe('ask frame ordering', () => {
  it('emits trace, retrieved, delta, done, twenty times in a row', async () => {
    const generator = answering();

    for (let run = 0; run < 20; run += 1) {
      const frames = await collect(generator);
      expect(frames[0]?.type).toBe('trace');
      expect(frames[1]?.type).toBe('retrieved');
      expect(frames.at(-1)?.type).toBe('done');
      expect(frames.filter((frame) => frame.type === 'done')).toHaveLength(1);
    }

    expect(generator.calls).toBe(20);
  });

  it('sends retrieved before the first delta', async () => {
    const frames = await collect(answering());

    expect(frames[1]).toMatchObject({ type: 'retrieved', sources });
    expect(frames[2]?.type).toBe('delta');
  });

  it('reports grounded 1 when every marker resolves', async () => {
    const frames = await collect(answering());

    expect(frames.at(-1)).toMatchObject({ type: 'done', grounded: 1 });
  });
});

describe('ask abstention', () => {
  it('abstains without generating when nothing clears the floor', async () => {
    const generator = answering();
    const frames = await collect(generator, { search: () => [] });

    expect(frames.map((frame) => frame.type)).toEqual(['trace', 'retrieved', 'abstain']);
    expect(frames.at(-1)).toMatchObject({
      type: 'abstain',
      reason: 'no_retrieval_above_floor',
      suggestions: titles,
    });
    expect(generator.calls).toBe(0);
  });

  it('never lets the refusal token reach the visitor as text', async () => {
    const frames = await collect(new CannedGenerator([], ['ABSENT']));

    expect(textOf(frames)).toBe('');
    expect(frames.at(-1)).toMatchObject({ type: 'abstain', reason: 'model_declined' });
    expect(JSON.stringify(frames)).not.toContain('ABSENT');
  });

  it('treats a split refusal with trailing punctuation as a decline', async () => {
    const frames = await collect(new CannedGenerator([], ['ABS', 'ENT.']));

    expect(textOf(frames)).toBe('');
    expect(frames.at(-1)).toMatchObject({ type: 'abstain', reason: 'model_declined' });
  });

  it('abstains after streaming when a citation does not resolve', async () => {
    const frames = await collect(new CannedGenerator([], ['Made this up [9].']));

    expect(textOf(frames)).toBe('Made this up [9].');
    expect(frames.at(-1)).toMatchObject({ type: 'abstain', reason: 'unknown_citations' });
  });

  it('abstains for a different reason when the answer cites nothing at all', async () => {
    const frames = await collect(new CannedGenerator([], ['He did a lot of good work.']));

    // Not the same failure as inventing a source: nothing was cited, so nothing
    // could be checked. The visitor-facing copy depends on that difference.
    expect(frames.at(-1)).toMatchObject({ type: 'abstain', reason: 'no_citations' });
  });
});

describe('markers without prose', () => {
  it('refuses an answer that is only citation markers', async () => {
    // Reproduced from a real answer to "What did he ship for autodesk?".
    const frames = await collect(new CannedGenerator([], ['[1][4]']));

    expect(frames.at(-1)).toMatchObject({ type: 'abstain', reason: 'no_prose' });
  });

  it('accepts a short but real sentence with a marker', async () => {
    const frames = await collect(new CannedGenerator([], ['It shipped in four months [1].']));

    expect(frames.at(-1)).toMatchObject({ type: 'done', grounded: 1 });
  });

  it('does not count markers as prose', () => {
    expect(hasProse('[1][4]')).toBe(false);
    expect(hasProse(' [2] [3] [4] ')).toBe(false);
    expect(hasProse('It shipped in four months [1].')).toBe(true);
  });
});

describe('ask options', () => {
  it('clamps a caller asking for more tokens than the cap, and caps by default', async () => {
    const generator = answering();
    for await (const _frame of ask(request({ max_tokens: 2000 }), 't', deps(generator))) {
      // consume
    }
    expect(generator.lastRequest?.maxTokens).toBe(220);
    expect(generator.lastRequest?.temperature).toBe(0.2);
  });

  it('puts the numbered sources and the refusal rule in the system prompt', async () => {
    const generator = answering();
    await collect(generator);

    const system = generator.lastRequest?.system ?? '';
    expect(system).toContain('[1] Structured logging across Commerce APIs / Outcome');
    expect(system).toContain('reply with exactly:\nABSENT');
  });
});

describe('messagesFor', () => {
  it('forwards the last six history turns plus the question', () => {
    const history = Array.from({ length: 8 }, (_, index) => ({
      role: (index % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `turn ${index}`,
    }));

    const messages = messagesFor(request({ history }), 6);

    expect(messages).toHaveLength(7);
    expect(messages[0]).toMatchObject({ content: 'turn 2' });
    expect(messages.at(-1)).toMatchObject({ role: 'user', content: 'How did he handle observability?' });
  });
});

describe('decline detection', () => {
  it('accepts the token with whitespace, case and trailing punctuation differences', () => {
    expect(isDecline('ABSENT')).toBe(true);
    expect(isDecline('  absent.  ')).toBe(true);
  });

  it('rejects an answer that merely starts with the token', () => {
    expect(isDecline('ABSENT from the sources, but he shipped logging [1].')).toBe(false);
    expect(isDecline('')).toBe(false);
  });
});
