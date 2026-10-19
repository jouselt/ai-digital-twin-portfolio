import { ProviderUnavailable, type LlmProvider, type LlmStreamOptions } from './provider';

export interface OllamaLlmConfig {
  readonly baseUrl: string;
  readonly model: string;
  readonly contextWindow: number;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

interface OllamaChatFrame {
  message?: { content?: unknown };
  done?: unknown;
  error?: unknown;
}

/** `mistral-nemo` over Ollama's streaming `/api/chat`, yielding content deltas. */
export class OllamaLlmProvider implements LlmProvider {
  readonly id: string;
  readonly contextWindow: number;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: OllamaLlmConfig) {
    this.id = `ollama:${config.model}`;
    this.contextWindow = config.contextWindow;
    this.timeoutMs = config.timeoutMs ?? 120_000;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async *stream(options: LlmStreamOptions): AsyncIterable<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const onAbort = (): void => controller.abort();
    options.signal?.addEventListener('abort', onAbort, { once: true });

    try {
      const response = await this.fetchImpl(`${this.config.baseUrl.replace(/\/$/, '')}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.config.model,
          stream: true,
          messages: [{ role: 'system', content: options.system }, ...options.messages],
          options: { temperature: options.temperature, num_predict: options.maxTokens },
        }),
      });

      if (!response.ok || response.body === null) {
        throw new ProviderUnavailable(this.id, `HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          const frame = parseFrame(trimmed, this.id);
          if (typeof frame.error === 'string') {
            throw new ProviderUnavailable(this.id, frame.error);
          }
          const delta = frame.message?.content;
          if (typeof delta === 'string' && delta.length > 0) {
            yield delta;
          }
          if (frame.done === true) {
            await reader.cancel().catch(() => undefined);
            return;
          }
        }
      }
    } catch (error) {
      if (error instanceof ProviderUnavailable) throw error;
      const reason = error instanceof Error ? error.message : String(error);
      throw new ProviderUnavailable(this.id, reason);
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
    }
  }
}

function parseFrame(line: string, providerId: string): OllamaChatFrame {
  try {
    const parsed: unknown = JSON.parse(line);
    if (typeof parsed !== 'object' || parsed === null) {
      throw new ProviderUnavailable(providerId, 'stream frame was not a JSON object');
    }
    return parsed as OllamaChatFrame;
  } catch (error) {
    if (error instanceof ProviderUnavailable) throw error;
    throw new ProviderUnavailable(providerId, `unparseable stream frame: ${line.slice(0, 120)}`);
  }
}
