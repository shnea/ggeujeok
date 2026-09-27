import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { NotFoundException } from '@nestjs/common';
import { Database } from '../database/database.js';
import { Ai, inputHash } from './ai.service.js';
import { PlatformJobs } from './platform-jobs.js';

export class AiWorker {
  private readonly ai:Ai;
  private readonly jobs=new PlatformJobs();
  private readonly workerId=`ggeujeok-${randomUUID()}`;
  constructor(private readonly db:Database){this.ai=new Ai(db);}

  async run(signal:AbortSignal,priorityOnly=false) {
    if (!config.N8N_WEBHOOK_BASE_URL || !config.N8N_WEBHOOK_TOKEN || !config.AI_CALLBACK_TOKEN) return;
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
          if(!task.result){
            const base=new URL(config.N8N_WEBHOOK_BASE_URL);
            if(base.protocol!=='https:' || base.username || base.password || base.search || base.hash)throw Error('N8N_CONFIGURATION');
            const response=await fetch(`${base.href.replace(/\/$/,'')}/ggeujeok-${config.APP_ENV}-${task.kind}`,{
              method:'POST',redirect:'error',signal:AbortSignal.any([abort.signal,signal,AbortSignal.timeout(90000)]),
              headers:{'Content-Type':'application/json','X-Ggeujeok-Key':config.N8N_WEBHOOK_TOKEN},
              body:JSON.stringify({requestId:task.id,hash,system:this.ai.prompt(task),context}),
            });
            await response.body?.cancel();
            task=await this.ai.task(task.id);
            if(!task.result)throw Error(response.ok?'RESULT_MISSING':'N8N_FAILED');
          }
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
          // A cached result can be reapplied safely; an unknown model execution cannot be repeated.
          const state=(await this.db.query('SELECT execution_started_at,execution_error FROM ai_tasks WHERE id=$1',[task.id])).rows[0];
          const retryable=!state.execution_started_at || !!task.result;
          if(!['SUCCEEDED','SKIPPED'].includes(task.state))await this.db.query("UPDATE ai_tasks SET state='FAILED',error_code=$2 WHERE id=$1",[task.id,state.execution_error?'GENERATION_FAILED':retryable?'CONNECTION_FAILED':'EXECUTION_UNCONFIRMED']);
          await this.jobs.fail(job.id,leaseToken,retryable);
        } catch { /* Lease uncertainty prevents subsequent writes and reports. */ }
      }
    } finally {clearInterval(timer);signal.removeEventListener('abort',stop);}
  }
}
