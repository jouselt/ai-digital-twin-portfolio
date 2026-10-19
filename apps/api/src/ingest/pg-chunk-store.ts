import type { Pool, PoolClient } from 'pg';

import type { ChunkStore, ChunkWrite, StoredChunk } from './chunk-store';
import type { CorpusMetadata } from './frontmatter';

/** pgvector accepts the text form `[1,2,3]`, which is also valid JSON. */
function toVectorLiteral(vector: Float32Array): string {
  return JSON.stringify(Array.from(vector));
}

export class PgChunkStore implements ChunkStore {
  constructor(private readonly pool: Pool) {}

  async loadHashes(projectId: string): Promise<readonly StoredChunk[]> {
    const result = await this.pool.query<{ ord: number; content_hash: string }>(
      'SELECT ord, content_hash FROM chunks WHERE project_id = $1 ORDER BY ord',
      [projectId],
    );
    return result.rows.map((row) => ({ ord: row.ord, contentHash: row.content_hash }));
  }

  /**
   * One transaction per project: a half-written project would leave chunks that
   * answer questions from a document the visitor can no longer see.
   */
  async write(
    projectId: string,
    metadata: CorpusMetadata,
    sourceUri: string,
    rows: readonly ChunkWrite[],
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.upsertProject(client, projectId, metadata, sourceUri);
      for (const row of rows) {
        await this.upsertChunk(client, projectId, row);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async deleteOrphans(projectId: string, keepOrds: readonly number[]): Promise<number> {
    const result = await this.pool.query(
      'DELETE FROM chunks WHERE project_id = $1 AND NOT (ord = ANY($2::int[]))',
      [projectId, [...keepOrds]],
    );
    return result.rowCount ?? 0;
  }

  private async upsertProject(
    client: PoolClient,
    projectId: string,
    metadata: CorpusMetadata,
    sourceUri: string,
  ): Promise<void> {
    await client.query(
      `INSERT INTO projects (id, title, client, role, period, stack, source_uri, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6::text[], $7, now())
       ON CONFLICT (id) DO UPDATE
         SET title = EXCLUDED.title,
             client = EXCLUDED.client,
             role = EXCLUDED.role,
             period = EXCLUDED.period,
             stack = EXCLUDED.stack,
             source_uri = EXCLUDED.source_uri,
             updated_at = now()`,
      [
        projectId,
        metadata.title,
        metadata.client,
        metadata.role,
        metadata.period,
        [...metadata.stack],
        sourceUri,
      ],
    );
  }

  /**
   * COALESCE on the embedding is what makes "unchanged" cheap: an unchanged row
   * arrives with a null vector and keeps the one already stored.
   *
   * An UPDATE is tried first and a plain INSERT only runs when nothing matched.
   * A single INSERT ... ON CONFLICT does not work here: Postgres checks the
   * NOT NULL constraint on the proposed tuple before resolving the conflict, so
   * the null vector of an unchanged row fails even though the row exists.
   */
  private async upsertChunk(client: PoolClient, projectId: string, row: ChunkWrite): Promise<void> {
    const vector = row.embedding === null ? null : toVectorLiteral(row.embedding);

    const updated = await client.query(
      `UPDATE chunks
          SET section = $3,
              content = $4,
              content_hash = $5,
              token_est = $6,
              embedding = COALESCE($7::vector, embedding)
        WHERE project_id = $1 AND ord = $2`,
      [projectId, row.ord, row.section, row.content, row.contentHash, row.tokenEst, vector],
    );
    if ((updated.rowCount ?? 0) > 0) return;

    if (vector === null) {
      // The only way here is a chunk that claims to be unchanged while no row
      // exists for it, which would leave an unsearchable chunk in the corpus.
      throw new Error(
        `ingest tried to insert ${projectId} chunk ${row.ord} without an embedding; ` +
          'the store reported it as existing but no row matched',
      );
    }

    await client.query(
      `INSERT INTO chunks (project_id, ord, section, content, content_hash, token_est, embedding)
       VALUES ($1, $2, $3, $4, $5, $6, $7::vector)
       ON CONFLICT (project_id, ord) DO UPDATE
         SET section = EXCLUDED.section,
             content = EXCLUDED.content,
             content_hash = EXCLUDED.content_hash,
             token_est = EXCLUDED.token_est,
             embedding = EXCLUDED.embedding`,
      [projectId, row.ord, row.section, row.content, row.contentHash, row.tokenEst, vector],
    );
  }
}
