/**
 * The shape of the static corpus artifact.
 *
 * Types only plus a validator: the bundle is fetched at runtime, so the app has
 * to check what it got instead of trusting a cast. A malformed bundle has to say
 * what is wrong, because the alternative is an empty chat with no explanation.
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
  readonly embedText: string;
  readonly content: string;
  readonly contentHash: string;
}

export interface CorpusBundleLike {
  readonly version: number;
  readonly bundleHash: string;
  readonly chunkTargetTokens: number;
  readonly projects: readonly BundleProject[];
  readonly chunks: readonly BundleChunk[];
}

export class BundleError extends Error {
  constructor(detail: string) {
    super(`corpus bundle is invalid: ${detail}`);
    this.name = 'BundleError';
  }
}

export function parseBundle(value: unknown): CorpusBundleLike {
  if (typeof value !== 'object' || value === null) throw new BundleError('not an object');

  const candidate = value as Partial<CorpusBundleLike>;
  if (candidate.version !== 1) {
    throw new BundleError(`version ${String(candidate.version)} is not supported`);
  }
  if (typeof candidate.bundleHash !== 'string' || candidate.bundleHash.length === 0) {
    throw new BundleError('bundleHash is missing');
  }
  if (!Array.isArray(candidate.chunks) || candidate.chunks.length === 0) {
    throw new BundleError('chunks is empty');
  }
  if (!Array.isArray(candidate.projects)) throw new BundleError('projects is missing');

  for (const chunk of candidate.chunks) {
    if (typeof chunk?.chunkId !== 'string' || typeof chunk.embedText !== 'string') {
      throw new BundleError('a chunk is missing chunkId or embedText');
    }
    if (typeof chunk.content !== 'string') {
      throw new BundleError(`chunk ${chunk.chunkId} is missing content`);
    }
  }

  return candidate as CorpusBundleLike;
}
