/**
 * Deterministic token estimate, labelled as an estimate everywhere it appears.
 *
 * A real tokenizer would drag a model-specific vocabulary into the request path
 * for a number that only decides chunk packing and the reported `tokens_out`.
 * The formula is the one recorded in design.md, not a guess made at call time.
 */
export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;

  const chars = text.length;
  const words = text.split(/\s+/).filter((word) => word.length > 0).length;

  // Fenced code costs more per character than prose; CJK more per character again.
  const codeChars = countCodeChars(text);
  const cjkChars = countCjkChars(text);

  return Math.max(chars / 4.0, words * 1.3) + codeChars * 0.4 + cjkChars * 0.5;
}

function countCodeChars(text: string): number {
  const fences = text.split('```');
  if (fences.length < 3) return 0;
  let total = 0;
  for (let index = 1; index < fences.length; index += 2) {
    total += (fences[index] ?? '').length;
  }
  return total;
}

function countCjkChars(text: string): number {
  const matches = text.match(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/g);
  return matches === null ? 0 : matches.length;
}
