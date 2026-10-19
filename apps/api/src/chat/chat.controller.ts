import { Body, Controller, Headers, HttpException, Post, Res } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import { TRACE_HEADER } from '@twin/contracts';
import { encodeSseEvent } from '@twin/contracts/sse';
import { z } from 'zod';

import { ChatService } from './chat.service';

const AskRequestSchema = z.object({
  question: z.string().trim().min(1, 'question must not be empty').max(2000),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().max(8000),
      }),
    )
    .max(40)
    .default([]),
  max_tokens: z.number().int().positive().optional(),
});

@Controller('chat')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Post()
  async ask(
    @Body() body: unknown,
    @Res() response: Response,
    @Headers(TRACE_HEADER) incomingTrace?: string,
  ): Promise<void> {
    const parsed = AskRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new HttpException(
        {
          message: 'invalid request',
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
        400,
      );
    }

    const traceId = incomingTrace?.trim() || randomUUID();
    const abort = new AbortController();
    response.on('close', () => abort.abort());

    response.status(200);
    response.setHeader('content-type', 'text/event-stream; charset=utf-8');
    response.setHeader('cache-control', 'no-cache, no-transform');
    response.setHeader('connection', 'keep-alive');
    response.setHeader('x-accel-buffering', 'no');
    response.setHeader(TRACE_HEADER, traceId);

    try {
      for await (const frame of this.chat.ask(parsed.data, traceId, abort.signal)) {
        if (abort.signal.aborted) break;
        response.write(encodeSseEvent(frame));
      }
    } catch (error) {
      if (!abort.signal.aborted) {
        const message = error instanceof Error ? error.message : 'unexpected failure';
        response.write(encodeSseEvent({ type: 'error', message }));
      }
    } finally {
      response.end();
    }
  }
}
