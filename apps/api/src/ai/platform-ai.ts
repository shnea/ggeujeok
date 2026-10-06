import { z } from 'zod';
import { config } from '../config.js';
import type { TaskKind } from './assistant.js';

const taskTypes: Record<TaskKind, string> = {
  summary: 'blog.summary', tags: 'blog.tags', comment: 'comment.generate', article: 'article.draft',
};

const jobSchema = z.object({
  id: z.uuid(), project: z.uuid(), environment: z.uuid(), request_id: z.string(),
  task_type: z.string(), status: z.enum(['running', 'succeeded', 'failed', 'cancelled']),
  result: z.unknown(), result_expired: z.boolean(),
});
export type PlatformAiJob = z.infer<typeof jobSchema>;

// The platform job contains the execution envelope; its nested result is the task contract.
export function taskResult(value: unknown): unknown {
  return value && typeof value === 'object' && !Array.isArray(value) && 'result' in value
    ? (value as { result: unknown }).result : value;
}

export class PlatformAiError extends Error {
  constructor(readonly status: number, readonly code: string) { super(`PLATFORM_AI_${status}_${code}`); }
}

export class PlatformAi {
  private async request(path: string, body?: unknown, signal?: AbortSignal): Promise<unknown> {
    const base = new URL(config.PLATFORM_URL);
    if ((base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)))
      || base.username || base.password || base.pathname !== '/' || base.search || base.hash || !config.PLATFORM_API_KEY)
      throw new Error('PLATFORM_AI_CONFIGURATION');
    const content = body === undefined ? undefined : JSON.stringify(body);
    if (content && Buffer.byteLength(content) > 2 * 1024 * 1024) throw new Error('PLATFORM_AI_INPUT_TOO_LARGE');
    const response = await fetch(new URL(path, base), {
      method: content === undefined ? 'GET' : 'POST', redirect: 'error',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000),
      headers: { 'X-Platform-Key': config.PLATFORM_API_KEY, Accept: 'application/json',
        ...(content === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: content,
    });
    // Do not expose upstream bodies, which can include submitted text.
    if (!response.ok) {
      let code = 'UNKNOWN';
      try { const problem = await response.json() as { code?: unknown }; if (typeof problem.code === 'string') code = problem.code; }
      catch { await response.body?.cancel(); }
      throw new PlatformAiError(response.status, code);
    }
    const limit = path === '/api/v1/ai/jobs?limit=100' ? 16 * 1024 * 1024 : 2 * 1024 * 1024;
    if (Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); throw new Error('PLATFORM_AI_RESPONSE_TOO_LARGE'); }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('PLATFORM_AI_EMPTY_RESPONSE');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) throw new Error('PLATFORM_AI_RESPONSE_TOO_LARGE');
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  }

  private checked(raw: unknown, requestId: string, kind: TaskKind): PlatformAiJob {
    const job = jobSchema.parse(raw);
    if (job.project !== config.PLATFORM_PROJECT_ID || job.environment !== config.PLATFORM_ENVIRONMENT_ID
      || job.request_id !== requestId || job.task_type !== taskTypes[kind]) throw new Error('PLATFORM_AI_JOB_MISMATCH');
    return job;
  }

  async submit(requestId: string, kind: TaskKind, hash: string, system: string, context: unknown, signal?: AbortSignal): Promise<PlatformAiJob> {
    const prompt = kind === 'article' ? (context as { topic: string }).topic : JSON.stringify(context);
    return this.checked(await this.request('/api/v1/ai/jobs', {
      request_id: requestId, task_type: taskTypes[kind], prompt,
      input: { hash, system, context }, sync: false,
    }, signal), requestId, kind);
  }

  async get(id: string, requestId: string, kind: TaskKind, signal?: AbortSignal): Promise<PlatformAiJob> {
    return this.checked(await this.request(`/api/v1/ai/jobs/${z.uuid().parse(id)}`, undefined, signal), requestId, kind);
  }

  async find(requestId: string, kind: TaskKind, signal?: AbortSignal): Promise<PlatformAiJob | null> {
    const jobs = z.array(jobSchema).max(100).parse(await this.request('/api/v1/ai/jobs?limit=100', undefined, signal));
    const match = jobs.find(job => job.request_id === requestId);
    return match ? this.checked(match, requestId, kind) : null;
  }
}
