import { uncoveredEntities } from './coverage';

const corpus = [
  'Disney Parks (WDW) structured logging across Commerce APIs.',
  'Carnival Cruise Line booking flow and the Quick Quote Vista web component.',
  'LATAM Airlines upgrade platform, Node.js BFF for commerce APIs.',
  'Globant internal Angular app delivered from concept to production.',
].join(' ');

describe('uncoveredEntities', () => {
  it('names the company the corpus has no record of', () => {
    // The exact question that produced six irrelevant passages in a real browser.
    expect(uncoveredEntities('What did he ship for autodesk?', corpus)).toEqual(['autodesk']);
  });

  it('says nothing when the company is covered', () => {
    expect(uncoveredEntities('What did he ship for Carnival?', corpus)).toEqual([]);
    expect(uncoveredEntities('Tell me about the LATAM upgrade platform', corpus)).toEqual([]);
  });

  it('ignores the capitalised question words that open a sentence', () => {
    expect(uncoveredEntities('What did he do at Disney Parks?', corpus)).toEqual([]);
    expect(uncoveredEntities('How did the Carnival flow work?', corpus)).toEqual([]);
  });

  it('catches a company the corpus never mentions, wherever it sits', () => {
    expect(uncoveredEntities('At Google, what did he build?', corpus)).toEqual(['Google']);
  });

  it('returns each missing name once, whatever the casing', () => {
    const found = uncoveredEntities('autodesk and Autodesk both', corpus);

    expect(found).toHaveLength(1);
    expect(found[0]?.toLowerCase()).toBe('autodesk');
  });
});
