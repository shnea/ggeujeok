import 'reflect-metadata';
import { setTimeout } from 'node:timers/promises';
import { Database } from './database/database.js';
import { Notifications } from './notifications/notifications.service.js';
import { Visits } from './statistics/visits.service.js';
import { FileCleanup } from './files/cleanup.js';
import { PlatformFiles } from './files/platform-files.js';
import { AiWorker } from './ai/ai.worker.js';
import { logs } from './operations/logs.js';

const db = new Database();
const notifications = new Notifications(db);
const visits = new Visits(db);
const files = new FileCleanup(db, new PlatformFiles());
const ai = new AiWorker(db);
const stop = new AbortController();
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => stop.abort());
logs.start();
logs.write('service.started', { component: 'worker' });
async function runAi(priorityOnly:boolean) {
  while(!stop.signal.aborted) {
    try { await ai.run(stop.signal,priorityOnly); } catch { logs.write('worker.failed', {component:'worker'}); }
    try { await setTimeout(2000,undefined,{signal:stop.signal}); } catch { break; }
  }
}
// Mentions have their own consumer, so a long article cannot hold up a direct greeting or notifications.
const aiWork=Promise.all([runAi(false),runAi(true)]);
let nextCleanup = 0;
try {
  while (!stop.signal.aborted) {
    try {
      for (let count = 0; count < 25 && !stop.signal.aborted; count++) {
        if (!await notifications.processOne()) break;
      }
    } catch { logs.write('worker.failed', { component: 'worker' }); }
    if (Date.now() >= nextCleanup) {
      // One unavailable external service must not prevent the other retention jobs.
      for (const cleanup of [
        () => notifications.prune(),
        () => visits.prune(),
        () => db.query("DELETE FROM audit_events WHERE created_at<now()-interval '180 days'"),
        () => db.query("DELETE FROM sessions WHERE expires_at<now() OR created_at<now()-interval '7 days' OR last_seen_at<now()-interval '24 hours'"),
        () => files.run(),
        () => db.query("UPDATE ai_tasks SET result=NULL,profile='{}'::jsonb WHERE state IN ('SUCCEEDED','SKIPPED','FAILED') AND created_at<now()-interval '30 days' AND result IS NOT NULL"),
      ]) {
        if (stop.signal.aborted) break;
        try { await cleanup(); } catch { logs.write('worker.failed', { component: 'retention' }); }
      }
      nextCleanup = Date.now() + 60 * 60 * 1000;
    }
    try { await setTimeout(2000, undefined, { signal: stop.signal }); }
    catch { /* Shutdown interrupts the idle wait. */ }
  }
} finally {
  stop.abort();
  await aiWork;
  await logs.stop();
  await db.end();
}
