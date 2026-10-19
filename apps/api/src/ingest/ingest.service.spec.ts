import { FakeEmbeddingProvider } from '../providers/fakes';
import { InMemoryChunkStore } from './chunk-store';
import { CorpusFrontmatterError, parseCorpusFrontmatter } from './frontmatter';
import { IngestService } from './ingest.service';

const PROJECT_ID = 'commerce-observability';

function documentWith(sections: readonly string[]): string {
  return [
    '---',
    `id: ${PROJECT_ID}`,
    'title: Commerce API observability',
    'client: Disney Parks',
    'role: Senior Fullstack Developer',
    'period: 2024-2025',
    'stack:',
    '  - TypeScript',
    '  - Angular',
    '  - Splunk',
    '---',
    '',
    ...sections.flatMap((body, index) => [`## Section ${index + 1}`, '', body, '']),
  ].join('\n');
}

const bodies = [
  'Adopted structured logging with correlation ids across six Commerce APIs.',
  'Built Splunk dashboards over the same ids so a support ticket maps to one trace.',
  'Reduced mean time to diagnosis because every hop carries the identifier.',
];

function service(): { ingest: IngestService; embeddings: FakeEmbeddingProvider; store: InMemoryChunkStore } {
  const embeddings = new FakeEmbeddingProvider();
  const store = new InMemoryChunkStore();
  return { ingest: new IngestService(embeddings, store), embeddings, store };
}

describe('IngestService', () => {
  it('embeds and stores every chunk on the first run', async () => {
    const { ingest, embeddings, store } = service();

    const report = await ingest.ingest({ sourceUri: 'corpus/projects/a.md', markdown: documentWith(bodies) });

    expect(report.projectId).toBe(PROJECT_ID);
    expect(report.chunks).toBeGreaterThan(0);
    expect(report.embedded).toBe(report.chunks);
    expect(report.unchanged).toBe(0);
    expect(report.forcedSplits).toBe(0);
    expect(embeddings.seenDocuments).toHaveLength(report.chunks);
    expect(store.snapshot(PROJECT_ID).every((row) => row.embedding !== null)).toBe(true);
  });

  it('issues zero embedding calls on a second run over an unchanged corpus', async () => {
    const { ingest, embeddings } = service();
    const source = { sourceUri: 'corpus/projects/a.md', markdown: documentWith(bodies) };
    await ingest.ingest(source);
    const afterFirstRun = embeddings.seenDocuments.length;

    const report = await ingest.ingest(source);

    expect(report.embedded).toBe(0);
    expect(report.unchanged).toBe(report.chunks);
    expect(embeddings.seenDocuments).toHaveLength(afterFirstRun);
  });

  it('re-embeds only the chunk whose own text changed, not its neighbour', async () => {
    const { ingest, embeddings } = service();
    await ingest.ingest({ sourceUri: 'corpus/projects/a.md', markdown: documentWith(bodies) });
    const before = embeddings.seenDocuments.length;

    const edited = [...bodies];
    edited[1] = 'Built Splunk dashboards over the same ids, plus two saved searches per client.';
    const report = await ingest.ingest({
      sourceUri: 'corpus/projects/a.md',
      markdown: documentWith(edited),
    });

    // One edited section, one embedding call: the stored context prefix of the
    // next chunk is not part of the hash, so it does not cascade.
    expect(report.embedded).toBe(1);
    expect(embeddings.seenDocuments.length - before).toBe(1);
    expect(report.unchanged).toBe(report.chunks - 1);
  });

  it('preserves the stored vector for unchanged rows', async () => {
    const { ingest, store } = service();
    await ingest.ingest({ sourceUri: 'corpus/projects/a.md', markdown: documentWith(bodies) });
    const vectorsBefore = store.snapshot(PROJECT_ID).map((row) => row.embedding);

    await ingest.ingest({ sourceUri: 'corpus/projects/a.md', markdown: documentWith(bodies) });

    const vectorsAfter = store.snapshot(PROJECT_ID).map((row) => row.embedding);
    expect(vectorsAfter).toEqual(vectorsBefore);
  });

  it('deletes the tail when the document shrinks', async () => {
    const { ingest, store } = service();
    await ingest.ingest({ sourceUri: 'corpus/projects/a.md', markdown: documentWith(bodies) });

    const report = await ingest.ingest({
      sourceUri: 'corpus/projects/a.md',
      markdown: documentWith(bodies.slice(0, 2)),
    });

    expect(report.deleted).toBe(1);
    expect(store.snapshot(PROJECT_ID)).toHaveLength(2);
  });

  it('keeps the context prefix out of the text it embeds', async () => {
    const { ingest, embeddings } = service();

    await ingest.ingest({ sourceUri: 'corpus/projects/a.md', markdown: documentWith(bodies) });

    expect(embeddings.seenDocuments.some((text) => text.includes('[context ...]'))).toBe(false);
  });

  it('fails with a named error when the frontmatter lacks a stack', async () => {
    const { ingest } = service();
    const broken = documentWith(bodies).replace('stack:\n  - TypeScript\n  - Angular\n  - Splunk', 'stack: []');

    await expect(
      ingest.ingest({ sourceUri: 'corpus/projects/b.md', markdown: broken }),
    ).rejects.toThrow(CorpusFrontmatterError);

    await expect(
      ingest.ingest({ sourceUri: 'corpus/projects/b.md', markdown: broken }),
    ).rejects.toThrow(/corpus\/projects\/b\.md: frontmatter field "stack" must be a list of at least 2/);
  });
});

describe('parseCorpusFrontmatter', () => {
  it('reads scalars and the stack list, and returns the body without the block', () => {
    const { metadata, body } = parseCorpusFrontmatter(documentWith(bodies), 'a.md');

    expect(metadata).toEqual({
      id: PROJECT_ID,
      title: 'Commerce API observability',
      client: 'Disney Parks',
      role: 'Senior Fullstack Developer',
      period: '2024-2025',
      stack: ['TypeScript', 'Angular', 'Splunk'],
    });
    expect(body.trimStart().startsWith('## Section 1')).toBe(true);
  });

  it('accepts an inline stack list', () => {
    const doc = '---\nid: x\ntitle: X\nstack: [TypeScript, Angular]\n---\n\nBody.\n';

    expect(parseCorpusFrontmatter(doc, 'a.md').metadata.stack).toEqual(['TypeScript', 'Angular']);
  });

  it('names the missing fence when the document does not open with frontmatter', () => {
    expect(() => parseCorpusFrontmatter('# No frontmatter\n', 'c.md')).toThrow(/"---" is missing/);
  });

  it('names a missing required field', () => {
    const doc = '---\ntitle: X\nstack: [TypeScript, Angular]\n---\n\nBody.\n';

    expect(() => parseCorpusFrontmatter(doc, 'd.md')).toThrow(/field "id" is required/);
  });
});
