import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { CHUNK_TARGET_TOKENS, chunkDocument } from './chunker';
import { contentHash } from './content-hash';
import { parseCorpusFrontmatter } from './frontmatter';
import { normalizeDocument } from './normalize';

/**
 * The static artifact the browser loads instead of querying a database.
 *
 * No vectors here: they are computed in the browser with the same model that
 * embeds the visitor's question, so the two cannot end up in different spaces.
 * `contentHash` is per chunk so the browser can reuse cached vectors, and
 * `bundleHash` covers the whole file so a corpus edit invalidates them at once.
 */

export interface BundleProject {
  readonly id: string;
  readonly title: string;
  readonly client: string | null;
  readonly role: string | null;
  readonly period: string | null;
  readonly stack: readonly string[];
}

export interface BundleChunk {
  readonly chunkId: string;
  readonly projectId: string;
  readonly title: string;
  readonly section: string | null;
  /** Text sent to the embedder, without the context prefix. */
  readonly embedText: string;
  /** Text shown to the model and to the visitor, with the context prefix. */
  readonly content: string;
  readonly contentHash: string;
}

export interface CorpusBundle {
  readonly version: 1;
  readonly bundleHash: string;
  readonly chunkTargetTokens: number;
  readonly projects: readonly BundleProject[];
  readonly chunks: readonly BundleChunk[];
}

export interface CorpusDocument {
  readonly sourceUri: string;
  readonly markdown: string;
}

export function buildBundle(documents: readonly CorpusDocument[]): CorpusBundle {
  const projects = new Map<string, BundleProject>();
  const chunks: BundleChunk[] = [];

  // Sorted by source so the artifact is byte-stable across machines.
  const ordered = [...documents].sort((left, right) => left.sourceUri.localeCompare(right.sourceUri));

  for (const document of ordered) {
    const { metadata, body } = parseCorpusFrontmatter(document.markdown, document.sourceUri);

    if (projects.has(metadata.id)) {
      throw new Error(
        `${document.sourceUri}: project id "${metadata.id}" is already defined by another document`,
      );
    }
    projects.set(metadata.id, {
      id: metadata.id,
      title: metadata.title,
      client: metadata.client,
      role: metadata.role,
      period: metadata.period,
      stack: metadata.stack,
    });

    const chunked = chunkDocument(normalizeDocument(body), CHUNK_TARGET_TOKENS);
    for (const chunk of chunked) {
      chunks.push({
        chunkId: `${metadata.id}:${chunk.ord}`,
        projectId: metadata.id,
        title: metadata.title,
        section: chunk.section,
        embedText: chunk.embedText,
        content: chunk.content,
        contentHash: contentHash(metadata.id, chunk.ord, chunk.embedText),
      });
    }
  }

  const bundleHash = contentHash(
    'bundle',
    chunks.length,
    chunks.map((chunk) => chunk.contentHash).join(''),
  );

  return {
    version: 1,
    bundleHash,
    chunkTargetTokens: CHUNK_TARGET_TOKENS,
    projects: [...projects.values()],
    chunks,
  };
}

async function main(): Promise<void> {
  const corpusDir = resolve(process.cwd(), process.argv[2] ?? '../../corpus/projects');
  const outFile = resolve(process.cwd(), process.argv[3] ?? '../web/public/corpus/bundle.json');

  const files = (await readdir(corpusDir)).filter((name) => name.endsWith('.md')).sort();
  if (files.length === 0) throw new Error(`no corpus documents in ${corpusDir}`);

  const documents: CorpusDocument[] = [];
  for (const file of files) {
    documents.push({
      sourceUri: `corpus/projects/${file}`,
      markdown: await readFile(resolve(corpusDir, file), 'utf8'),
    });
  }

  const bundle = buildBundle(documents);
  const json = `${JSON.stringify(bundle, null, 2)}\n`;

  await mkdir(dirname(outFile), { recursive: true });
  await writeFile(outFile, json, 'utf8');

  console.log(`docs:    ${documents.length}`);
  console.log(`projects:${String(bundle.projects.length).padStart(3)}`);
  console.log(`chunks:  ${String(bundle.chunks.length).padStart(3)}`);
  console.log(`bundle:  ${(json.length / 1024).toFixed(1)} KB`);
  console.log(`hash:    ${bundle.bundleHash.slice(0, 16)}`);
  console.log(`written: ${outFile}`);
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
