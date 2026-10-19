import { scoreCase, summarize } from './eval-runner';
import type { EvalCase } from './golden-set';
import type { TwinMessage } from '../twin/twin.service';

function message(overrides: Partial<TwinMessage> = {}): TwinMessage {
  return { role: 'assistant', text: '', sources: [], terminal: null, traceId: 'trace', ...overrides };
}

const cited: EvalCase = { id: 'c', question: 'q', expect: 'cited', why: 'w' };
const uncovered: EvalCase = { id: 'u', question: 'q', expect: 'uncovered', why: 'w' };
const canned: EvalCase = { id: 'k', question: 'q', expect: 'canned', why: 'w' };
const abstain: EvalCase = { id: 'a', question: 'q', expect: 'abstain', why: 'w' };

describe('scoreCase', () => {
  it('passes a generated answer that carries a resolved marker', () => {
    const result = scoreCase(cited, message({ text: 'It shipped in four months [1].', terminal: { kind: 'done', grounded: 1 } }));

    expect(result.passed).toBe(true);
  });

  it('passes a quoted answer, because a quote is evidence with a marker', () => {
    const result = scoreCase(cited, message({ text: 'From the record: "Adopted across 6+ APIs" [1]', terminal: { kind: 'quote', grounded: 1 } }));

    expect(result.passed).toBe(true);
  });

  it('fails an answer made only of markers, the bug a browser found', () => {
    const result = scoreCase(cited, message({ text: '[1][4]', terminal: { kind: 'done', grounded: 1 } }));

    expect(result.passed).toBe(false);
  });

  it('fails a citation-free answer even when no guard fired', () => {
    const result = scoreCase(cited, message({ text: 'Yes, I have 10 years of experience.', terminal: { kind: 'done', grounded: 1 } }));

    expect(result.passed).toBe(false);
  });

  it('accepts uncovered_entity only for the uncovered case', () => {
    const refused = message({ terminal: { kind: 'abstain', reason: 'uncovered_entity' } });

    expect(scoreCase(uncovered, refused).passed).toBe(true);
    // A refusal for the wrong reason is not the promised behaviour.
    expect(scoreCase(abstain, refused).passed).toBe(true);
    expect(scoreCase(cited, refused).passed).toBe(false);
  });

  it('does not count a broken request as a refusal', () => {
    const brokenRequest = message({
      terminal: { kind: 'abstain', reason: 'request_failed', detail: 'Cache.add() network error' },
    });

    // The first real run scored 3/14 and called these passes.
    expect(scoreCase(abstain, brokenRequest).passed).toBe(false);
    expect(scoreCase(abstain, brokenRequest).error).toContain('Cache.add');
  });

  it('distinguishes a canned intro from a refusal', () => {
    const intro = message({ text: 'I answer from written project records, and every answer cites the passage.' });

    expect(scoreCase(canned, intro).passed).toBe(true);
    expect(scoreCase(abstain, intro).passed).toBe(false);
  });

  it('fails a case with no answer at all instead of passing it by default', () => {
    expect(scoreCase(cited, undefined).passed).toBe(false);
    expect(scoreCase(abstain, undefined).passed).toBe(false);
    expect(scoreCase(canned, undefined).passed).toBe(false);
  });
});

describe('summarize', () => {
  it('counts a rate per expectation, so a regression is localised', () => {
    const results = [
      scoreCase(cited, message({ text: 'It shipped in four months [1].', terminal: { kind: 'done', grounded: 1 } })),
      scoreCase(cited, message({ text: '[1]', terminal: { kind: 'done', grounded: 1 } })),
      scoreCase(uncovered, message({ terminal: { kind: 'abstain', reason: 'uncovered_entity' } })),
    ];

    const summary = summarize(results);

    expect(summary.total).toBe(3);
    expect(summary.passed).toBe(2);
    expect(summary.rate).toBeCloseTo(2 / 3, 5);
    expect(summary.byExpectation).toEqual([
      { expect: 'cited', passed: 1, total: 2 },
      { expect: 'uncovered', passed: 1, total: 1 },
      { expect: 'canned', passed: 0, total: 0 },
      { expect: 'abstain', passed: 0, total: 0 },
    ]);
    expect(summary.failures.length).toBe(1);
  });

  it('reports zero rather than dividing by zero on an empty run', () => {
    expect(summarize([]).rate).toBe(0);
  });
});
