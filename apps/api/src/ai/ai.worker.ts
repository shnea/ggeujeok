import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { config } from '../config.js';
import { NotFoundException } from '@nestjs/common';
import { Database } from '../database/database.js';
import { Ai, inputHash } from './ai.service.js';
import { PlatformJobs } from './platform-jobs.js';
import { PlatformAi, PlatformAiError, taskResult, type PlatformAiJob } from './platform-ai.js';

export class AiWorker {
  private readonly ai:Ai;
  private readonly jobs=new PlatformJobs();
  private readonly platformAi=new PlatformAi();
  private readonly workerId=`ggeujeok-${randomUUID()}`;
  constructor(private readonly db:Database){this.ai=new Ai(db);}

  async run(signal:AbortSignal,priorityOnly=false) {
    if (!config.PLATFORM_API_KEY || !config.PLATFORM_PROJECT_ID || !config.PLATFORM_ENVIRONMENT_ID) return;
    await this.jobs.checkEnvironment();
    if(!priorityOnly)await this.ai.schedule();
    // The request UUID persists before contacting Jobs, including a manual retry.
    await this.db.transaction(async tx=>{
      const row=(await tx.query("SELECT id,dispatch_id,priority FROM ai_tasks WHERE state='PENDING' AND priority=$1 ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED",[priorityOnly])).rows[0];
      if(!row)return;
      const job=await this.jobs.enqueue(row.id,row.dispatch_id,row.priority);
      await tx.query("UPDATE ai_tasks SET job_id=$2,state='QUEUED' WHERE id=$1",[row.id,job.id]);
    });
    const claim=await this.jobs.claim(this.workerId,priorityOnly);
    if(!claim)return;
    const {job,leaseToken}=claim;
    const abort=new AbortController();
    const stop=()=>abort.abort(); signal.addEventListener('abort',stop,{once:true});
    let verified=Date.now(), beating=false;
    const assertLease=()=>{if(abort.signal.aborted || signal.aborted || Date.now()-verified>25000)throw Error('LEASE_UNCONFIRMED');};
    const heartbeat=async()=>{
      if(beating)return;
      beating=true;
      try{await this.jobs.heartbeat(job.id,leaseToken);verified=Date.now();}
      catch{abort.abort();}
      finally{beating=false;}
    };
    const timer=setInterval(()=>void heartbeat(),20000);
    try {
      let task=await this.db.transaction(async tx=>{
        await tx.query('SELECT id FROM ai_tasks WHERE id=$1 FOR UPDATE',[job.payload.taskId]);
        // Recover an accepted Jobs request whose response/DB commit was lost.
        await tx.query(`UPDATE ai_tasks SET job_id=$2,state='QUEUED' WHERE id=$1 AND dispatch_id=$3
          AND state='PENDING' AND job_id IS NULL`,[job.payload.taskId,job.id,job.requestId]);
        assertLease();return this.ai.task(job.payload.taskId,tx);
      });
      // Jobs can outlive a deleted task or a superseded manual retry.
      if(task.job_id!==job.id){assertLease();await this.jobs.complete(job.id,leaseToken);return;}
      if(['SUCCEEDED','SKIPPED'].includes(task.state)){assertLease();await this.jobs.complete(job.id,leaseToken);return;}
      const context=await this.ai.context(task);
      if(!context){
        assertLease();await this.db.query("UPDATE ai_tasks SET state='SKIPPED',completed_at=now(),error_code='CONTEXT_CHANGED' WHERE id=$1",[task.id]);
      } else {
        const hash=inputHash(context);
        if(task.input_hash && task.input_hash!==hash) {
          assertLease();await this.db.query("UPDATE ai_tasks SET state='SKIPPED',completed_at=now(),error_code='CONTEXT_CHANGED' WHERE id=$1",[task.id]);
        } else {
          assertLease();await this.db.query("UPDATE ai_tasks SET state='RUNNING',input_hash=$2 WHERE id=$1",[task.id,hash]);
          if(!task.result) await this.execute(task.id, hash, context, abort.signal, assertLease);
          await heartbeat();assertLease();await this.ai.apply(task.id,assertLease);
        }
      }
      assertLease();await this.jobs.complete(job.id,leaseToken);
    } catch(error) {
      if(!abort.signal.aborted && !signal.aborted){
        try {
          assertLease();
          if(error instanceof NotFoundException){await this.jobs.complete(job.id,leaseToken);return;}
          const task=await this.ai.task(job.payload.taskId);
          const state=(await this.db.query('SELECT execution_started_at,execution_error FROM ai_tasks WHERE id=$1',[task.id])).rows[0];
          const errorCode=state.execution_error ? 'GENERATION_FAILED' : state.execution_started_at ? 'EXECUTION_UNCONFIRMED' : 'CONNECTION_FAILED';
          if(!['SUCCEEDED','SKIPPED'].includes(task.state))await this.db.query("UPDATE ai_tasks SET state='FAILED',error_code=$2 WHERE id=$1",[task.id,errorCode]);
          // Only a cached result or a request that was never sent may be retried by Jobs.
          await this.jobs.fail(job.id,leaseToken,!state.execution_started_at || !!task.result);
        } catch { /* Lease uncertainty prevents subsequent writes and reports. */ }
      }
    } finally {clearInterval(timer);signal.removeEventListener('abort',stop);}
  }

  private async execute(id:string, hash:string, context:unknown, signal:AbortSignal, assertLease:()=>void) {
    const task=await this.ai.task(id);
    let remote:PlatformAiJob | null=null;
    if(task.ai_job_id) remote=await this.platformAi.get(task.ai_job_id,task.ai_request_id,task.kind,signal);
    else if(task.execution_started_at) remote=await this.platformAi.find(task.ai_request_id,task.kind,signal);
    else {
      assertLease();
      const started=await this.db.query('UPDATE ai_tasks SET execution_started_at=now() WHERE id=$1 AND execution_started_at IS NULL RETURNING id',[id]);
      if(!started.rowCount) throw Error('AI_EXECUTION_ALREADY_STARTED');
      try { remote=await this.platformAi.submit(task.ai_request_id,task.kind,hash,this.ai.prompt(task),context,signal); }
      catch(error) {
        // The POST response may have been lost after acceptance. Search the current environment before stopping.
        if(error instanceof PlatformAiError && [400,401,403,413,422].includes(error.status))
          await this.db.query("UPDATE ai_tasks SET execution_error='REQUEST_REJECTED' WHERE id=$1",[id]);
        else remote=await this.platformAi.find(task.ai_request_id,task.kind,signal).catch(()=>null);
        if(!remote) throw error;
      }
    }
    if(!remote) throw Error('AI_REQUEST_UNCONFIRMED');
    assertLease();
    await this.db.query('UPDATE ai_tasks SET ai_job_id=$2 WHERE id=$1 AND ai_request_id=$3',[id,remote.id,task.ai_request_id]);
    const deadline=Date.now()+10*60*1000;
    while(remote.status==='running') {
      if(Date.now()>deadline)throw Error('AI_RESULT_PENDING');
      await delay(3000,undefined,{signal});assertLease();
      remote=await this.platformAi.get(remote.id,task.ai_request_id,task.kind,signal);
    }
    if(remote.status!=='succeeded' || remote.result_expired || remote.result==null) {
      if(remote.status==='failed' || remote.status==='cancelled')
        await this.db.query("UPDATE ai_tasks SET execution_error='GENERATION_FAILED' WHERE id=$1",[id]);
      throw Error('AI_RESULT_UNAVAILABLE');
    }
    assertLease();
    try { await this.ai.cacheResult(id,{hash,result:taskResult(remote.result)}); }
    catch(error) {
      await this.db.query("UPDATE ai_tasks SET execution_error='INVALID_RESPONSE' WHERE id=$1",[id]);
      throw error;
    }
  }
}
