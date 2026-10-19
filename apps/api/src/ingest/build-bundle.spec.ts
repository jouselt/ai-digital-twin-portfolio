import { buildBundle, type CorpusDocument } from './build-bundle';

function doc(id: string, title: string, body: string[]): CorpusDocument {
  return {
    sourceUri: `corpus/projects/${id}.md`,
    markdown: [
      '---',
      `id: ${id}`,
      `title: ${title}`,
      'client: Disney Parks',
      'role: Senior Fullstack Developer',
      'period: 2021-present',
      'stack: [TypeScript, Angular]',
      '---',
      '',
      ...body.flatMap((text, index) => [`## Section ${index + 1}`, '', text, '']),
    ].join('\n'),
  };
}

const first = doc('alpha', 'Alpha project', [
  'Adopted structured logging with correlation ids across six Commerce APIs.',
  'Built dashboards over the same ids so a support ticket maps to one trace.',
]);
const second = doc('beta', 'Beta project', [
  'Designed a WebSocket bridge to POS terminals under PCI constraints.',
]);

describe('buildBundle', () => {
  it('emits one chunk per section with a stable chunk id', () => {
    const bundle = buildBundle([first]);

    expect(bundle.chunks.map((chunk) => chunk.chunkId)).toEqual(['alpha:0', 'alpha:1']);
    expect(bundle.chunks.every((chunk) => chunk.projectId === 'alpha')).toBe(true);
  });

  it('carries no vectors, because they are computed in the browser', () => {
    const bundle = buildBundle([first, second]);
    const serialised = JSON.stringify(bundle);

    expect(serialised).not.toContain('embedding');
    expect(Object.keys(bundle.chunks[0] ?? {})).toEqual([
      'chunkId',
      'projectId',
      'title',
      'section',
      'embedText',
      'content',
      'contentHash',
    ]);
  });

  it('keeps the embed text free of the context prefix that content carries', () => {
    const bundle = buildBundle([first]);
    const withPrefix = bundle.chunks.filter((chunk) => chunk.content.startsWith('[context ...]'));

    expect(withPrefix).toHaveLength(1);
    expect(withPrefix[0]?.embedText).not.toContain('[context ...]');
  });

  it('is byte-stable regardless of the order documents are passed in', () => {
    const forward = JSON.stringify(buildBundle([first, second]));
    const backward = JSON.stringify(buildBundle([second, first]));

    expect(backward).toBe(forward);
  });

  it('changes the bundle hash when a document changes, and not when nothing does', () => {
    const before = buildBundle([first, second]).bundleHash;
    const same = buildBundle([first, second]).bundleHash;
    const edited = buildBundle([
      doc('alpha', 'Alpha project', [
        'Adopted structured logging with correlation ids across six Commerce APIs.',
        'Built dashboards over the same ids, plus two saved searches per client.',
      ]),
      second,
    ]).bundleHash;

    expect(same).toBe(before);
    expect(edited).not.toBe(before);
  });

  it('refuses two documents that claim the same project id', () => {
    const duplicate = doc('alpha', 'Another title', ['Different text.']);

    expect(() => buildBundle([first, duplicate])).toThrow(/project id "alpha" is already defined/);
  });

  it('lists every project once with its metadata', () => {
    const bundle = buildBundle([first, second]);

    expect(bundle.projects).toHaveLength(2);
    expect(bundle.projects[1]).toEqual({
      id: 'beta',
      title: 'Beta project',
      client: 'Disney Parks',
      role: 'Senior Fullstack Developer',
      period: '2021-present',
      stack: ['TypeScript', 'Angular'],
    });
  });
});
