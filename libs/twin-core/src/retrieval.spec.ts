import { cosineSimilarity, retrieve, suggestionsFrom, type EmbeddedChunk } from './retrieval';

function vector(values: readonly number[]): Float32Array {
  return Float32Array.from(values);
}

function chunk(id: string, title: string, embedding: Float32Array): EmbeddedChunk {
  return {
    chunkId: id,
    projectId: id.split(':')[0] as string,
    title,
    section: 'Context',
    content: `content for ${id}`,
    embedding,
  };
}

const catalogue: EmbeddedChunk[] = [
  chunk('a:1', 'Project A', vector([1, 0, 0])),
  chunk('b:1', 'Project B', vector([0, 1, 0])),
  chunk('c:1', 'Project C', vector([0.9, 0.1, 0])),
  chunk('a:2', 'Project A', vector([0, 0, 1])),
];

describe('cosineSimilarity', () => {
  it('returns 1 for a vector against itself', () => {
    expect(cosineSimilarity(vector([0.3, 0.7]), vector([0.3, 0.7]))).toBeCloseTo(1, 6);
  });

  it('returns 0 for orthogonal vectors and for a zero vector', () => {
    expect(cosineSimilarity(vector([1, 0]), vector([0, 1]))).toBeCloseTo(0, 6);
    expect(cosineSimilarity(vector([0, 0]), vector([1, 1]))).toBe(0);
  });

  it('ignores magnitude, which a raw dot product would not', () => {
    const scaled = cosineSimilarity(vector([10, 0]), vector([1, 0]));
    expect(scaled).toBeCloseTo(1, 6);
  });
});

describe('retrieve', () => {
  it('sorts by score and caps at k', () => {
    const results = retrieve(vector([1, 0, 0]), catalogue, 2, 0);

    expect(results.map((result) => result.chunkId)).toEqual(['a:1', 'c:1']);
    expect(results[0]?.score).toBeCloseTo(1, 6);
  });

  it('drops everything below the floor, which is what produces an abstention', () => {
    const results = retrieve(vector([0, 0, 1]), catalogue, 6, 0.9);

    expect(results).toHaveLength(1);
    expect(results[0]?.chunkId).toBe('a:2');
  });

  it('returns nothing when no chunk clears a strict floor', () => {
    expect(retrieve(vector([0.5, 0.5, 0.5]), catalogue, 6, 0.99)).toEqual([]);
  });

  it('carries the citation fields through unchanged', () => {
    const [first] = retrieve(vector([1, 0, 0]), catalogue, 1, 0);

    expect(first).toEqual({
      chunkId: 'a:1',
      projectId: 'a',
      title: 'Project A',
      section: 'Context',
      content: 'content for a:1',
      score: expect.closeTo(1, 6) as number,
    });
  });
});

describe('suggestionsFrom', () => {
  it('dedupes titles and limits the list', () => {
    expect(suggestionsFrom(catalogue, 2)).toEqual(['Project A', 'Project B']);
    expect(suggestionsFrom(catalogue, 10)).toEqual(['Project A', 'Project B', 'Project C']);
  });
});
