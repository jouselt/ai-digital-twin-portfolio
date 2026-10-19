import type { SourceRef } from '@twin/contracts';

/**
 * Deterministic post-check on a streamed answer.
 *
 * The model is told to cite `[n]` against the retrieved sources. It lies in two
 * ways that a regex can catch without a second model call: it cites a source id
 * that was never retrieved, or it answers without citing anything at all. Both
 * end in an abstention, because an ungrounded answer about a real person is
 * worse than no answer.
 *
 * Source of truth: design.md, "Grounding, citation, abstention".
 */
export interface CitationCheck {
  /** citedMarkers / totalMarkers. Zero markers yields 0, which is below 1.0 by construction. */
  readonly grounded: number;
  readonly totalMarkers: number;
  readonly validMarkers: number;
  /** 1-based source ids the model invented, in the order they appeared. */
  readonly droppedMarkers: readonly number[];
  /** The answer with invented markers removed, so the client never renders a dead citation. */
  readonly text: string;
  /** Chunk ids actually cited, first appearance order, deduplicated. */
  readonly citedChunkIds: readonly string[];
}

const MARKER = /\[(\d{1,3})\]/g;

export function validateCitations(
  answer: string,
  sources: readonly SourceRef[],
): CitationCheck {
  const droppedMarkers: number[] = [];
  const citedChunkIds: string[] = [];
  let totalMarkers = 0;
  let validMarkers = 0;

  const text = answer.replace(MARKER, (match, digits: string) => {
    totalMarkers += 1;
    const id = Number.parseInt(digits, 10);
    const source = id >= 1 && id <= sources.length ? sources[id - 1] : undefined;
    if (source === undefined) {
      droppedMarkers.push(id);
      return '';
    }
    validMarkers += 1;
    if (!citedChunkIds.includes(source.chunkId)) {
      citedChunkIds.push(source.chunkId);
    }
    return match;
  });

  return {
    grounded: totalMarkers === 0 ? 0 : validMarkers / totalMarkers,
    totalMarkers,
    validMarkers,
    droppedMarkers,
    text: tidyAfterRemoval(text),
    citedChunkIds,
  };
}

/** Removing a marker leaves a stray space before punctuation; collapse it once. */
function tidyAfterRemoval(text: string): string {
  return text.replace(/[ \t]+([.,;:!?])/g, '$1').replace(/[ \t]{2,}/g, ' ');
}
