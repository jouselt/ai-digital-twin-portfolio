import { validateCitations } from './citation-validator';
import type { SourceRef } from '@twin/contracts';

function source(chunkId: string): SourceRef {
  return {
    chunkId,
    projectId: 'commerce-observability',
    title: 'Commerce API observability',
    section: 'What shipped',
    content: 'Structured logging with correlation ids.',
    score: 0.71,
  };
}

const sources: SourceRef[] = [source('a'), source('b'), source('c')];

describe('validateCitations', () => {
  it('reports a fully grounded answer and leaves the text alone', () => {
    const answer = 'Adopted correlation ids across 6+ APIs [1][2].';

    const check = validateCitations(answer, sources);

    expect(check.grounded).toBe(1);
    expect(check.totalMarkers).toBe(2);
    expect(check.validMarkers).toBe(2);
    expect(check.droppedMarkers).toEqual([]);
    expect(check.text).toBe(answer);
    expect(check.citedChunkIds).toEqual(['a', 'b']);
  });

  it('treats an answer with no markers as ungrounded rather than as exempt', () => {
    const check = validateCitations('I shipped a lot of things.', sources);

    expect(check.totalMarkers).toBe(0);
    expect(check.grounded).toBe(0);
    expect(check.citedChunkIds).toEqual([]);
  });

  it('drops an invented source id from the text and from the score', () => {
    const check = validateCitations('One [1] and a made-up [9] one.', sources);

    expect(check.droppedMarkers).toEqual([9]);
    expect(check.grounded).toBe(0.5);
    expect(check.text).not.toContain('[9]');
    expect(check.text).toContain('[1]');
    expect(check.citedChunkIds).toEqual(['a']);
  });

  it('counts repeated markers individually instead of collapsing them', () => {
    const check = validateCitations('A [1] B [1] C [1].', sources);

    expect(check.totalMarkers).toBe(3);
    expect(check.grounded).toBe(1);
    expect(check.citedChunkIds).toEqual(['a']);
  });

  it('rejects marker id zero, which no source can ever satisfy', () => {
    const check = validateCitations('Shipped [0].', sources);

    expect(check.droppedMarkers).toEqual([0]);
    expect(check.grounded).toBe(0);
    expect(check.text).toBe('Shipped.');
  });

  it('ignores bracketed text that is not a numeric marker', () => {
    const check = validateCitations('See [note] and [see below] for context.', sources);

    expect(check.totalMarkers).toBe(0);
    expect(check.grounded).toBe(0);
    expect(check.text).toBe('See [note] and [see below] for context.');
  });

  it('keeps first-appearance order when a source is cited twice', () => {
    const check = validateCitations('B first [2], then A [1], then B again [2].', sources);

    expect(check.citedChunkIds).toEqual(['b', 'a']);
    expect(check.grounded).toBe(1);
  });

  it('collapses the space a dropped marker leaves before punctuation', () => {
    const check = validateCitations('Shipped it [7].', sources);

    expect(check.text).toBe('Shipped it.');
  });
});
