import { cannedIntro, classifyIntent } from './intent';

describe('classifyIntent', () => {
  it('treats a bare greeting as a greeting', () => {
    expect(classifyIntent('Hi')).toBe('greeting');
    expect(classifyIntent('hello!')).toBe('greeting');
    expect(classifyIntent('good morning')).toBe('greeting');
  });

  it('treats a greeting followed by a real question as a question', () => {
    expect(classifyIntent('Hi, what did he ship for Carnival?')).toBe('ask');
  });

  it('treats questions about the tool itself as meta', () => {
    expect(classifyIntent('What can you do?')).toBe('meta');
    expect(classifyIntent('who are you?')).toBe('meta');
    expect(classifyIntent('How does this work?')).toBe('meta');
  });

  it('treats a work question as a question', () => {
    expect(classifyIntent('How did he handle observability?')).toBe('ask');
    expect(classifyIntent('Tell me about the Quick Quote API')).toBe('ask');
  });

  it('never sends empty input to the model', () => {
    expect(classifyIntent('   ')).toBe('meta');
  });
});

describe('cannedIntro', () => {
  it('names real projects, never a bare refusal', () => {
    const text = cannedIntro(['Structured logging', 'Quick Quote API', 'Find Me']);

    expect(text).toContain('every answer cites');
    expect(text).toContain('- Structured logging');
    expect(text).toContain('- Find Me');
  });

  it('survives an empty corpus without inventing examples', () => {
    expect(cannedIntro([])).not.toContain('- ');
  });
});
