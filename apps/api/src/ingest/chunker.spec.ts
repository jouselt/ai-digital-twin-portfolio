import { estimateTokens } from '@twin/core';
import { CHUNK_TARGET_TOKENS, chunkDocument, splitSentences } from './chunker';
import { normalizeDocument } from './normalize';

const sentence = (n: number): string =>
  `Sentence number ${n} describes what shipped and why it mattered to the team.`;

const document = normalizeDocument(
  [
    '# Commerce API observability',
    '',
    '## What shipped',
    '',
    'Adopted structured logging with correlation ids across 6+ Commerce APIs. ' +
      'The Splunk dashboards read the same ids, so a support ticket maps to one trace.',
    '',
    'Reduced mean time to diagnosis because every hop carries the id.',
    '',
    '## Constraint',
    '',
    'PCI scope limited what could be logged. Tokens were never written to disk.',
    '',
    '## Detail',
    '',
    Array.from({ length: 60 }, (_, index) => sentence(index)).join(' '),
  ].join('\n'),
);

function squash(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

describe('chunkDocument', () => {
  it('is deterministic across three runs', () => {
    const runs = Array.from({ length: 3 }, () => JSON.stringify(chunkDocument(document)));

    expect(runs[1]).toBe(runs[0]);
    expect(runs[2]).toBe(runs[0]);
  });

  it('numbers chunks from zero without gaps', () => {
    const chunks = chunkDocument(document);

    expect(chunks.map((chunk) => chunk.ord)).toEqual(chunks.map((_, index) => index));
  });

  it('never exceeds the target by more than a hard cut can overshoot', () => {
    const chunks = chunkDocument(document);

    for (const chunk of chunks) {
      expect(estimateTokens(chunk.embedText)).toBeLessThanOrEqual(CHUNK_TARGET_TOKENS + 50);
    }
  });

  it('starts a new chunk at every heading and records the section', () => {
    const chunks = chunkDocument(document);

    expect(chunks.map((chunk) => chunk.section)).toContain('What shipped');
    expect(chunks.map((chunk) => chunk.section)).toContain('Constraint');
    const shipped = chunks.find((chunk) => chunk.section === 'What shipped');
    expect(shipped?.embedText.startsWith('## What shipped')).toBe(true);
  });

  it('loses no text and cuts on word boundaries', () => {
    const chunks = chunkDocument(document);
    const rebuilt = chunks.map((chunk) => chunk.embedText).join(' ');

    expect(squash(rebuilt)).toBe(squash(document));
  });

  it('carries the previous chunk as a context prefix that is absent from the embed text', () => {
    const chunks = chunkDocument(document);

    expect(chunks[0]?.contextPrefix).toBeNull();
    expect(chunks[0]?.content).toBe(chunks[0]?.embedText);

    const second = chunks[1];
    expect(second?.contextPrefix).toMatch(/^\[context \.\.\.\] /);
    expect(second?.content.startsWith('[context ...] ')).toBe(true);
    expect(second?.embedText).not.toContain('[context ...]');
    expect(second?.content.endsWith(second.embedText)).toBe(true);
  });

  it('marks a single oversized sentence as a forced split', () => {
    const oneLongSentence = normalizeDocument(
      `# Long\n\n${'word '.repeat(1200)}end of the sentence.\n`,
    );

    const chunks = chunkDocument(oneLongSentence);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.some((chunk) => chunk.forcedSplit)).toBe(true);
    expect(squash(chunks.map((chunk) => chunk.embedText).join(' '))).toBe(squash(oneLongSentence));
  });

  it('does not split a sentence after an abbreviation or an initial', () => {
    const text = 'Use the dashboards, e.g. the Commerce one. J. Fernandez wrote them.';

    expect(splitSentences(text)).toEqual([
      'Use the dashboards, e.g. the Commerce one.',
      'J. Fernandez wrote them.',
    ]);
  });

  it('keeps each section as a single chunk when it fits the budget', () => {
    const chunks = chunkDocument(document, 2000);

    // Four sections, and a heading is always a chunk boundary by design.
    expect(chunks).toHaveLength(4);
    expect(chunks.map((chunk) => chunk.section)).toEqual([
      'Commerce API observability',
      'What shipped',
      'Constraint',
      'Detail',
    ]);
    expect(chunks.every((chunk) => chunk.tokenEst < 2000)).toBe(true);
  });
});
