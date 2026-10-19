import { sharesContentWord } from './relevance';

describe('sharesContentWord', () => {
  it('matches a question to the passage that answers it', () => {
    expect(
      sharesContentWord(
        'How did he handle logging across the commerce APIs?',
        'Structured logging across Commerce APIs',
      ),
    ).toBe(true);
  });

  it('refuses to match a personal question to a technical passage', () => {
    // The exact pair the eval produced.
    expect(
      sharesContentWord('What is his current salary?', 'Structured logging across Commerce APIs'),
    ).toBe(false);
    expect(
      sharesContentWord('What are his political opinions?', 'Node.js BFF for commerce APIs'),
    ).toBe(false);
  });

  it('ignores question scaffolding', () => {
    expect(sharesContentWord('Tell me about it', 'Structured logging')).toBe(false);
  });
});
