import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { ChatEvent, SourceRef } from '@twin/contracts';
import { parseSseFrame, splitSseBuffer } from '@twin/contracts/sse';

import { FakeLlmProvider } from '../providers/fakes';
import { LLM_PROVIDER } from '../providers/provider';
import { FakeRetrievalPort, RETRIEVAL_PORT } from '../retrieval/retrieval.port';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';

const sources: SourceRef[] = [
  {
    chunkId: 'chunk-1',
    projectId: 'commerce-observability',
    title: 'Commerce API observability',
    section: 'What shipped',
    content: 'Structured logging with correlation ids across 6+ Commerce APIs.',
    score: 0.74,
  },
];
const titles = ['Commerce API observability', 'POS WebSocket bridge', 'Quick Quote Vista'];

function framesOf(body: string): ChatEvent[] {
  return splitSseBuffer(body)
    .frames.map(parseSseFrame)
    .filter((frame): frame is ChatEvent => frame !== null);
}

async function appWith(llm: FakeLlmProvider, retrieval: FakeRetrievalPort): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers: [ChatController],
    providers: [
      ChatService,
      { provide: LLM_PROVIDER, useValue: llm },
      { provide: RETRIEVAL_PORT, useValue: retrieval },
    ],
  }).compile();

  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}

describe('POST /chat', () => {
  let app: INestApplication;

  afterEach(async () => {
    await app?.close();
  });

  it('streams the frames as server-sent events in order', async () => {
    app = await appWith(
      new FakeLlmProvider(['Shipped ', 'structured logging [1].']),
      new FakeRetrievalPort(sources, titles),
    );

    const response = await request(app.getHttpServer())
      .post('/chat')
      .send({ question: 'How did he handle observability?' })
      .expect(200);

    expect(response.headers['content-type']).toContain('text/event-stream');
    // Two deltas: the guard releases the first one once it stops being a prefix of ABSENT.
    expect(framesOf(response.text).map((frame) => frame.type)).toEqual([
      'trace',
      'retrieved',
      'delta',
      'delta',
      'done',
    ]);
  });

  it('generates a trace id and echoes an incoming one verbatim', async () => {
    app = await appWith(new FakeLlmProvider(['Ok [1].']), new FakeRetrievalPort(sources, titles));

    const generated = await request(app.getHttpServer())
      .post('/chat')
      .send({ question: 'q' })
      .expect(200);
    expect((generated.headers as Record<string, string>)['x-trace-id']).toMatch(/^[0-9a-f-]{36}$/);

    const supplied = await request(app.getHttpServer())
      .post('/chat')
      .set('x-trace-id', 'trace-from-the-client')
      .send({ question: 'q' })
      .expect(200);
    expect((supplied.headers as Record<string, string>)['x-trace-id']).toBe('trace-from-the-client');
    expect(framesOf(supplied.text)).toContainEqual({
      type: 'trace',
      trace_id: 'trace-from-the-client',
    });
  });

  it('rejects an empty question with a field-level message instead of streaming', async () => {
    app = await appWith(new FakeLlmProvider(['Ok [1].']), new FakeRetrievalPort(sources, titles));

    const response = await request(app.getHttpServer())
      .post('/chat')
      .send({ question: '   ' })
      .expect(400);

    expect(response.body).toMatchObject({
      message: 'invalid request',
      issues: [{ path: 'question', message: 'question must not be empty' }],
    });
  });

  it('turns an abstention into a terminal frame the client can render', async () => {
    app = await appWith(new FakeLlmProvider(['Ok [1].']), new FakeRetrievalPort([], titles));

    const response = await request(app.getHttpServer())
      .post('/chat')
      .send({ question: 'What did he do at Google?' })
      .expect(200);

    const frames = framesOf(response.text);
    expect(frames.map((frame) => frame.type)).toEqual(['trace', 'retrieved', 'abstain']);
    expect(frames.at(-1)).toMatchObject({ type: 'abstain', suggestions: titles });
  });
});
