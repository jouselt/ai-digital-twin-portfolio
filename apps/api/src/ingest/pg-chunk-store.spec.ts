import { Pool } from 'pg';

import { FakeEmbeddingProvider } from '../providers/fakes';
import { EMBEDDING_DIMENSIONS } from '@twin/contracts';
import { assertVectorWidth, readVectorWidth, VectorWidthError } from '../db/vector-width.guard';
import { IngestService } from './ingest.service';
import { PgChunkStore } from './pg-chunk-store';

const DATABASE_URL = process.env['DATABASE_URL'];

function documentWith(sections: readonly string[]): string {
  return [
    '---',
    'id: pg-integration',
    'title: PG integration project',
    'client: Disney Parks',
    'role: Senior Fullstack Developer',
    'period: 2024-2025',
    'stack: [TypeScript, Angular]',
    '---',
    '',
    ...sections.flatMap((body, index) => [`## Section ${index + 1}`, '', body, '']),
  ].join('\n');
}

const bodies = [
  'Adopted structured logging with correlation ids across six Commerce APIs.',
  'Built dashboards over the same ids so a support ticket maps to one trace.',
  'Reduced mean time to diagnosis because every hop carries the identifier.',
];

/**
 * Real-database checks. Skipped unless DATABASE_URL points at a database that has
 * had the migrations applied, so the default test run stays dependency-free.
 */
const describeWithDatabase = DATABASE_URL === undefined ? describe.skip : describe;

describeWithDatabase('PgChunkStore against a real database', () => {
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({ connectionString: DATABASE_URL });
  });

  afterAll(async () => {
    await pool.query("DELETE FROM projects WHERE id = 'pg-integration'");
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM projects WHERE id = 'pg-integration'");
  });

  it('reports the declared vector width from atttypmod', async () => {
    expect(await readVectorWidth(pool, 'chunks', 'embedding')).toBe(EMBEDDING_DIMENSIONS);
  });

  it('refuses to run when the column width disagrees with the provider', async () => {
    await expect(assertVectorWidth(pool, 'chunks', 'embedding', 1536)).rejects.toThrow(VectorWidthError);
    await expect(assertVectorWidth(pool, 'chunks', 'embedding', 1536)).rejects.toThrow(
      /chunks\.embedding is vector\(768\), but the embedding provider emits 1536/,
    );
  });

  it('writes chunks and stores a vector the database accepts as vector(768)', async () => {
    const embeddings = new FakeEmbeddingProvider();
    const ingest = new IngestService(embeddings, new PgChunkStore(pool));

    const report = await ingest.ingest({
      sourceUri: 'corpus/projects/pg.md',
      markdown: documentWith(bodies),
    });

    expect(report.embedded).toBe(report.chunks);
    const stored = await pool.query<{ ord: number; dims: number; section: string }>(
      `SELECT ord, vector_dims(embedding) AS dims, section
         FROM chunks WHERE project_id = 'pg-integration' ORDER BY ord`,
    );
    expect(stored.rows).toHaveLength(report.chunks);
    expect(stored.rows.every((row) => row.dims === EMBEDDING_DIMENSIONS)).toBe(true);
    expect(stored.rows[0]?.section).toBe('Section 1');
  });

  it('keeps stored vectors on a re-ingest and embeds nothing', async () => {
    const embeddings = new FakeEmbeddingProvider();
    const ingest = new IngestService(embeddings, new PgChunkStore(pool));
    const source = { sourceUri: 'corpus/projects/pg.md', markdown: documentWith(bodies) };
    await ingest.ingest(source);

    const before = await pool.query<{ ord: number; embedding: string }>(
      "SELECT ord, embedding::text AS embedding FROM chunks WHERE project_id = 'pg-integration' ORDER BY ord",
    );
    const callsBefore = embeddings.seenDocuments.length;

    const report = await ingest.ingest(source);

    const after = await pool.query<{ ord: number; embedding: string }>(
      "SELECT ord, embedding::text AS embedding FROM chunks WHERE project_id = 'pg-integration' ORDER BY ord",
    );
    expect(report.embedded).toBe(0);
    expect(embeddings.seenDocuments.length).toBe(callsBefore);
    expect(after.rows.map((row) => row.embedding)).toEqual(before.rows.map((row) => row.embedding));
  });

  it('deletes the tail when the document shrinks', async () => {
    const ingest = new IngestService(new FakeEmbeddingProvider(), new PgChunkStore(pool));
    await ingest.ingest({ sourceUri: 'corpus/projects/pg.md', markdown: documentWith(bodies) });

    const report = await ingest.ingest({
      sourceUri: 'corpus/projects/pg.md',
      markdown: documentWith(bodies.slice(0, 2)),
    });

    expect(report.deleted).toBe(1);
    const count = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM chunks WHERE project_id = 'pg-integration'",
    );
    expect(Number(count.rows[0]?.count)).toBe(2);
  });
});
