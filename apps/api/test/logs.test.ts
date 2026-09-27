import { test } from 'node:test';
import assert from 'node:assert/strict';
import { logEntry, OperationalLogs, requestContext } from '../src/operations/logs.js';

test('operational logs accept only fixed messages and safe fields, with request correlation', () => {
  const id = 'eafce43e-1f12-4e30-b950-b7e6a8c93303';
  const entry = requestContext.run({ requestId: id }, () => logEntry('request.failed', {
    status: 500, component: 'api', platformRequestId: id,
    ...{ password: 'secret-password', cookie: 'session-private', body: 'private content', url: 'https://private/?token=abc' },
  }));
  assert.equal(entry.requestId, id);
  assert.equal(entry.attributes.platformRequestId, id);
  const text = JSON.stringify(entry);
  for (const secret of ['secret-password', 'session-private', 'private content', '?token=']) assert.equal(text.includes(secret), false);
  assert.equal(logEntry('request.failed', { requestId: 'secret-token' }).requestId, undefined);
});

test('log delivery retries transient errors only, bounds queues and counts discarded logs', async () => {
  let calls = 0;
  const sender = (async () => new Response(null, { status: ++calls === 1 ? 503 : 202 })) as typeof fetch;
  const logs = new OperationalLogs(sender, () => {}, 'test-key');
  logs.write('service.started'); await logs.flush();
  assert.equal(calls, 2); assert.deepEqual(logs.stats(), { queued: 0, dropped: 0, failedBatches: 0 });
  let deniedCalls = 0;
  const denied = new OperationalLogs((async () => { deniedCalls++; return new Response(null, { status: 403 }); }) as typeof fetch, () => {}, 'test-key');
  for (let index = 0; index < 205; index++) denied.write('request.failed');
  assert.deepEqual(denied.stats(), { queued: 200, dropped: 5, failedBatches: 0 });
  await Promise.all([denied.flush(), denied.flush()]);
  assert.equal(deniedCalls, 1); assert.deepEqual(denied.stats(), { queued: 190, dropped: 15, failedBatches: 1 });
  await denied.stop(); assert.equal(denied.stats().queued, 0); assert.equal(denied.stats().dropped, 205);
});
