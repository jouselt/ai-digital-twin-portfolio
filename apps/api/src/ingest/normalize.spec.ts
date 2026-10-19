import { normalizeDocument } from './normalize';

describe('normalizeDocument', () => {
  it('collapses CRLF, blank-line runs and trailing spaces', () => {
    const raw = '# Title\r\n\r\n\r\n\r\nSome text   \r\nmore\r\n';

    expect(normalizeDocument(raw)).toBe('# Title\n\nSome text\nmore\n');
  });

  it('strips a BOM and HTML comments', () => {
    const raw = '\ufeff# Title\n\n<!-- authoring note -->\nBody.\n';

    expect(normalizeDocument(raw)).toBe('# Title\n\n\nBody.\n'.replace('\n\n\n', '\n\n'));
    expect(normalizeDocument(raw)).not.toContain('authoring note');
  });

  it('ends the document with exactly one newline, whatever the input ended with', () => {
    expect(normalizeDocument('Body.')).toBe('Body.\n');
    expect(normalizeDocument('Body.\n\n\n')).toBe('Body.\n');
  });

  it('is idempotent, so a re-ingest hashes the same bytes', () => {
    const once = normalizeDocument('# A\r\n\r\n\r\nText   \r\n');

    expect(normalizeDocument(once)).toBe(once);
  });
});
