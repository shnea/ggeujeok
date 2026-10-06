import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { config } from '../src/config.js';
import { PlatformAi, PlatformAiError, taskResult } from '../src/ai/platform-ai.js';
import { parseResult } from '../src/ai/assistant.js';

test('platform AI submits the four blog task contracts and recovers an existing request by ID', async () => {
  const original = globalThis.fetch;
  const project = randomUUID(), environment = randomUUID(), requestId = randomUUID(), jobId = randomUUID();
  Object.assign(config, { PLATFORM_URL: 'https://platform.test', PLATFORM_API_KEY: 'test-key',
    PLATFORM_PROJECT_ID: project, PLATFORM_ENVIRONMENT_ID: environment });
  const submitted: Record<string, unknown>[] = [];
  globalThis.fetch = async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (path === '/api/v1/ai/jobs' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      submitted.push(body);
      assert.equal(new Headers(init.headers).get('X-Platform-Key'), 'test-key');
      return Response.json({ id: jobId, project, environment, request_id: requestId,
        task_type: body.task_type, status: 'running', result: null, result_expired: false });
    }
    return Response.json([{ id: jobId, project, environment, request_id: requestId,
      task_type: 'article.draft', status: 'succeeded', result: { skip: true }, result_expired: false }]);
  };
  try {
    const ai = new PlatformAi();
    for (const [kind, taskType] of [['summary','blog.summary'],['tags','blog.tags'],
      ['comment','comment.generate'],['article','article.draft']] as const) {
      const context = kind === 'article' ? { topic: '새 주제' } : { article: { title: '제목', text: '본문' } };
      const job = await ai.submit(requestId, kind, 'hash', 'trusted instruction', context);
      assert.equal(job.task_type, taskType);
    }
    assert.equal(submitted.length, 4);
    assert.equal((submitted[3].input as { context: { topic: string } }).context.topic, '새 주제');
    assert.equal(submitted[3].prompt, '새 주제');
    assert.deepEqual(await ai.find(requestId, 'article'), {
      id: jobId, project, environment, request_id: requestId, task_type: 'article.draft',
      status: 'succeeded', result: { skip: true }, result_expired: false,
    });
  } finally { globalThis.fetch = original; }
});

test('platform AI rejects cross-environment results and retains upstream error codes', async () => {
  const original = globalThis.fetch;
  const project = randomUUID(), environment = randomUUID(), requestId = randomUUID();
  Object.assign(config, { PLATFORM_URL: 'https://platform.test', PLATFORM_API_KEY: 'test-key',
    PLATFORM_PROJECT_ID: project, PLATFORM_ENVIRONMENT_ID: environment });
  globalThis.fetch = async () => Response.json({ id: randomUUID(), project, environment: randomUUID(),
    request_id: requestId, task_type: 'blog.tags', status: 'succeeded', result: { tags: ['안전'] }, result_expired: false });
  try { await assert.rejects(() => new PlatformAi().submit(requestId,'tags','hash','system',{ title:'글' }), /PLATFORM_AI_JOB_MISMATCH/); }
  finally { globalThis.fetch = original; }
  globalThis.fetch = async () => Response.json({ code: 'INSUFFICIENT_SCOPE', detail: 'hidden' }, { status: 403 });
  try { await assert.rejects(() => new PlatformAi().submit(requestId,'tags','hash','system',{ title:'글' }),
    error => error instanceof PlatformAiError && error.status === 403 && error.code === 'INSUFFICIENT_SCOPE'); }
  finally { globalThis.fetch = original; }
});

test('platform execution envelope yields the task result without accepting its metadata as tags', () => {
  const envelope = { status:'completed',model:'provider-model',result:{ tags:['씨앗 심기'] } };
  assert.deepEqual(parseResult('tags',taskResult(envelope)),{tags:['씨앗 심기']});
  assert.throws(() => parseResult('tags',envelope));
});
