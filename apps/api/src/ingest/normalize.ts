/**
 * Corpus normalisation, applied before any chunking or hashing.
 *
 * Chunk boundaries and content hashes must not depend on which editor wrote the
 * document, so line endings and blank-line runs are collapsed first. HTML
 * comments are removed because they are authoring notes, not content.
 */
export function normalizeDocument(raw: string): string {
  return (
    raw
      .replace(/^\ufeff/, '')
      .replace(/\r\n?/g, '\n')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/[ \t]+$/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
      // A document that ends without a newline would otherwise change the hash of
      // its last chunk depending on how it was copied.
      .concat('\n')
  );
}
