import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';

import { EMBEDDING_DIMENSIONS } from '@twin/contracts';
import { assertVectorWidth } from '../db/vector-width.guard';
import { OllamaEmbeddingProvider } from '../providers/ollama-embedding.provider';
import { IngestService } from './ingest.service';
import { PgChunkStore } from './pg-chunk-store';

/**
 * Ingests every corpus document into Postgres with real embeddings.
 *
 * Runnable twice on purpose: the second run must embed nothing, which is the
 * incremental guarantee the ingest is built around.
 */
async function main(): Promise<void> {
  const corpusDir = resolve(process.cwd(), process.argv[2] ?? '../../corpus/projects');
  const databaseUrl =
    process.env['DATABASE_URL'] ?? 'postgres://twin:twindevlocal@127.0.0.1:55432/twin';
  const ollamaBaseUrl = process.env['OLLAMA_BASE_URL'] ?? 'http://127.0.0.1:11434';
  const model = process.env['EMBEDDING_MODEL'] ?? 'nomic-embed-text';
  const dimensions = Number(process.env['EMBEDDING_DIMENSIONS'] ?? EMBEDDING_DIMENSIONS);

  const pool = new Pool({ connectionString: databaseUrl });
  const embeddings = new OllamaEmbeddingProvider({
    baseUrl: ollamaBaseUrl,
    model,
    dimensions,
  });
  const service = new IngestService(embeddings, new PgChunkStore(pool));

  try {
    // Fail before any work if the column and the model disagree.
    await assertVectorWidth(pool, 'chunks', 'embedding', dimensions);

    const files = (await readdir(corpusDir)).filter((name) => name.endsWith('.md')).sort();
    if (files.length === 0) {
      throw new Error(`no corpus documents in ${corpusDir}`);
    }

    console.log(`corpus: ${corpusDir}`);
    console.log(`model:  ${model} (${dimensions} dims) via ${ollamaBaseUrl}`);
    console.log(`docs:   ${files.length}\n`);

    const startedAt = Date.now();
    const totals = { chunks: 0, embedded: 0, unchanged: 0, deleted: 0, forcedSplits: 0 };

    for (const file of files) {
      const markdown = await readFile(resolve(corpusDir, file), 'utf8');
      const report = await service.ingest({
        sourceUri: `corpus/projects/${file}`,
        markdown,
      });
      totals.chunks += report.chunks;
      totals.embedded += report.embedded;
      totals.unchanged += report.unchanged;
      totals.deleted += report.deleted;
      totals.forcedSplits += report.forcedSplits;
      console.log(
        `${file.padEnd(32)} chunks=${String(report.chunks).padStart(3)} ` +
          `embedded=${String(report.embedded).padStart(3)} ` +
          `unchanged=${String(report.unchanged).padStart(3)} ` +
          `deleted=${report.deleted}`,
      );
    }

    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(
      `\ntotal: ${totals.chunks} chunks, ${totals.embedded} embedded, ` +
        `${totals.unchanged} unchanged, ${totals.deleted} deleted, ` +
        `${totals.forcedSplits} forced splits in ${elapsed}s`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
