import { estimateTokens } from '@twin/core';

/** Chunk budget in estimated tokens. See design.md, "Ingest". */
export const CHUNK_TARGET_TOKENS = 320;
/** Tokens of the previous chunk carried for context. */
export const CONTEXT_TOKENS = 60;

export interface Chunk {
  /** Position within the document, zero based. Part of the content hash. */
  readonly ord: number;
  /** Nearest ATX heading above this text, or null before the first heading. */
  readonly section: string | null;
  /** Text sent to the embedder: this chunk's own words, with no context prefix. */
  readonly embedText: string;
  /** Text stored and shown to the model: context prefix plus own words. */
  readonly content: string;
  /** Trailing words of the previous chunk, or null for the first chunk. */
  readonly contextPrefix: string | null;
  readonly tokenEst: number;
  /** True when a single sentence had to be cut at whitespace to respect the budget. */
  readonly forcedSplit: boolean;
}

interface Unit {
  readonly text: string;
  readonly forced: boolean;
}

/**
 * Splits markdown into chunks of at most `targetTokens`.
 *
 * Split order is heading, then blank-line paragraph, then sentence, then a hard
 * whitespace cut. A heading always starts a new section and a new chunk, which
 * is what gives the UI a section-level citation. Sentence splitting uses a
 * lookbehind with an abbreviation guard so "e.g." and "Fig." do not end a
 * sentence.
 */
export function chunkDocument(
  markdown: string,
  targetTokens: number = CHUNK_TARGET_TOKENS,
  contextTokens: number = CONTEXT_TOKENS,
): Chunk[] {
  const chunks: Chunk[] = [];
  let previousText: string | null = null;

  for (const section of splitSections(markdown)) {
    for (const body of packUnits(splitUnits(section.text, targetTokens), targetTokens)) {
      const embedText = body.text.trim();
      if (embedText.length === 0) continue;

      const contextPrefix =
        previousText === null ? null : `[context ...] ${trailingTokens(previousText, contextTokens)}`;

      chunks.push({
        ord: chunks.length,
        section: section.heading,
        embedText,
        content: contextPrefix === null ? embedText : `${contextPrefix}\n${embedText}`,
        contextPrefix,
        tokenEst: Math.round(estimateTokens(embedText)),
        forcedSplit: body.forced,
      });
      previousText = embedText;
    }
  }

  return chunks;
}

interface Section {
  readonly heading: string | null;
  readonly text: string;
}

/** A heading always starts a new section, so it is always a chunk boundary. */
export function splitSections(markdown: string): Section[] {
  const sections: Section[] = [];
  let heading: string | null = null;
  let buffer: string[] = [];

  const flush = (): void => {
    const text = buffer.join('\n').trim();
    if (text.length > 0) sections.push({ heading, text });
    buffer = [];
  };

  for (const line of markdown.split('\n')) {
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (match === null) {
      buffer.push(line);
      continue;
    }
    flush();
    heading = (match[2] as string).trim();
    // The heading line itself is kept in the section text: a reader of the chunk
    // should see what the passage is about without the index.
    buffer.push(line);
  }
  flush();

  return sections;
}

/**
 * Breaks one section into atomic pieces that each fit the budget, splitting
 * paragraphs into sentences and a single oversized sentence at whitespace.
 */
export function splitUnits(text: string, targetTokens: number): Unit[] {
  const units: Unit[] = [];
  const push = (candidate: string, forced = false): void => {
    const trimmed = candidate.trim();
    if (trimmed.length === 0) return;
    if (estimateTokens(trimmed) <= targetTokens) {
      units.push({ text: trimmed, forced });
      return;
    }
    for (const sentence of splitSentences(trimmed)) {
      if (estimateTokens(sentence) <= targetTokens) {
        units.push({ text: sentence, forced });
      } else {
        for (const piece of hardCut(sentence, targetTokens)) {
          units.push({ text: piece, forced: true });
        }
      }
    }
  };

  for (const paragraph of text.split(/\n{2,}/)) {
    if (estimateTokens(paragraph) <= targetTokens) {
      push(paragraph);
    } else {
      for (const sentence of splitSentences(paragraph)) {
        push(sentence);
      }
    }
  }
  return units;
}

const ABBREVIATIONS = new Set(['mr', 'mrs', 'ms', 'dr', 'prof', 'fig', 'vs', 'etc', 'inc', 'ltd', 'no']);

/** Sentence boundary after terminal punctuation and before an opening token. */
export function splitSentences(text: string): string[] {
  const parts = text.split(/(?<=[.!?])\s+(?=[A-Z"'(\[])/);
  const merged: string[] = [];

  for (const part of parts) {
    const previous = merged.at(-1);
    if (previous !== undefined && endsWithAbbreviation(previous)) {
      merged[merged.length - 1] = `${previous} ${part}`;
      continue;
    }
    merged.push(part);
  }
  return merged;
}

function endsWithAbbreviation(sentence: string): boolean {
  const match = /(?:^|\s)([A-Za-z]{1,4})\.$/.exec(sentence.trim());
  if (match === null) return false;
  const token = match[1] as string;
  // A single initial ("J.") is an abbreviation too.
  return token.length === 1 || ABBREVIATIONS.has(token.toLowerCase());
}

/** Last resort: cut on whitespace, never mid-word, and keep every character. */
function hardCut(text: string, targetTokens: number): string[] {
  const words = text.split(/\s+/).filter((word) => word.length > 0);
  const pieces: string[] = [];
  let current: string[] = [];
  let currentTokens = 0;

  for (const word of words) {
    const wordTokens = estimateTokens(`${word} `);
    if (current.length > 0 && currentTokens + wordTokens > targetTokens) {
      pieces.push(current.join(' '));
      current = [];
      currentTokens = 0;
    }
    current.push(word);
    currentTokens += wordTokens;
  }
  if (current.length > 0) pieces.push(current.join(' '));
  return pieces;
}

/** Greedy packing of units into chunks that stay inside the budget. */
export function packUnits(units: readonly Unit[], targetTokens: number): Unit[] {
  const packed: Unit[] = [];
  let current: string[] = [];
  let currentTokens = 0;
  let currentForced = false;

  const flush = (): void => {
    if (current.length === 0) return;
    packed.push({ text: current.join('\n\n'), forced: currentForced });
    current = [];
    currentTokens = 0;
    currentForced = false;
  };

  for (const unit of units) {
    const unitTokens = estimateTokens(unit.text);
    if (current.length > 0 && currentTokens + unitTokens > targetTokens) flush();
    current.push(unit.text);
    currentTokens += unitTokens;
    currentForced = currentForced || unit.forced;
  }
  flush();
  return packed;
}

/** Last N tokens of a text, cut on a word boundary. */
function trailingTokens(text: string, tokens: number): string {
  const words = text.split(/\s+/).filter((word) => word.length > 0);
  const kept: string[] = [];
  let used = 0;
  for (let index = words.length - 1; index >= 0; index -= 1) {
    const word = words[index] as string;
    const cost = estimateTokens(`${word} `);
    if (used + cost > tokens) break;
    kept.unshift(word);
    used += cost;
  }
  return kept.join(' ');
}
