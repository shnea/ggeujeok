import 'reflect-metadata';
import { setTimeout } from 'node:timers/promises';
import { Database } from './database/database.js';
import { Notifications } from './notifications/notifications.service.js';

const db=new Database(), notifications=new Notifications(db), stop=new AbortController();
for (const signal of ['SIGTERM','SIGINT']) process.once(signal,()=>stop.abort());
let nextCleanup=0;
try {
  while (!stop.signal.aborted) {
    try {
      for (let count=0;count<25 && !stop.signal.aborted;count++) if (!await notifications.processOne()) break;
      if (Date.now()>=nextCleanup) {await notifications.prune();nextCleanup=Date.now()+60*60*1000;}
    } catch {console.error(JSON.stringify({level:'ERROR',event:'notification.worker',code:'WORKER_CYCLE_FAILED'}));}
    try {await setTimeout(2000,undefined,{signal:stop.signal});} catch { /* Shutdown interrupts the idle wait. */ }
  }
} finally {await db.end();}
