import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { NotFoundException } from '@nestjs/common';
import { ZodError } from 'zod';
import { Database } from '../database/database.js';
import { Ai, inputHash } from './ai.service.js';
import { PlatformJobs } from './platform-jobs.js';
import { PlatformAi, PlatformAiError, taskResult } from './platform-ai.js';

const ready=()=>Boolean(config.PLATFORM_API_KEY&&config.PLATFORM_PROJECT_ID&&config.PLATFORM_ENVIRONMENT_ID);

export class AiWorker {
  private readonly ai:Ai;
  private readonly jobs=new PlatformJobs();
  private readonly platformAi=new PlatformAi();
  private readonly workerId=`ggeujeok-${randomUUID()}`;
  constructor(private readonly db:Database){this.ai=new Ai(db);}

  // The queue consumer submits an asynchronous AI job and releases its lease without waiting for generation.
  async run(signal:AbortSignal,priorityOnly=false) {
    if(!ready())return;
    await this.jobs.checkEnvironment();
    if(!priorityOnly)await this.ai.schedule();
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
    const stop=()=>abort.abort();signal.addEventListener('abort',stop,{once:true});
    let verified=Date.now(),beating=false;
    const assertLease=()=>{if(abort.signal.aborted||signal.aborted||Date.now()-verified>25000)throw Error('LEASE_UNCONFIRMED');};
    const heartbeat=async()=>{
      if(beating)return;
      beating=true;
      try{await this.jobs.heartbeat(job.id,leaseToken);verified=Date.now();}catch{abort.abort();}
      finally{beating=false;}
    };
    const timer=setInterval(()=>void heartbeat(),20000);
    try {
      const task=await this.db.transaction(async tx=>{
        await tx.query('SELECT id FROM ai_tasks WHERE id=$1 FOR UPDATE',[job.payload.taskId]);
        await tx.query(`UPDATE ai_tasks SET job_id=$2,state='QUEUED' WHERE id=$1 AND dispatch_id=$3
          AND state='PENDING' AND job_id IS NULL`,[job.payload.taskId,job.id,job.requestId]);
        assertLease();return this.ai.task(job.payload.taskId,tx);
      });
      if(task.job_id!==job.id||['SUCCEEDED','SKIPPED'].includes(task.state)){
        assertLease();await this.jobs.complete(job.id,leaseToken);return;
      }
      const context=await this.ai.context(task);
      if(!context || (!task.manual_request && task.input_hash && task.input_hash!==inputHash(context))){
        assertLease();await this.db.query("UPDATE ai_tasks SET state='SKIPPED',completed_at=now(),error_code='CONTEXT_CHANGED' WHERE id=$1",[task.id]);
      }else{
        const hash=task.execution_started_at&&task.input_hash?task.input_hash:inputHash(context);
        assertLease();const active=await this.db.query(`UPDATE ai_tasks SET state='RUNNING',input_hash=$2,
          input_snapshot=COALESCE(input_snapshot,$3),result_check_at=now()+interval '30 seconds'
          WHERE id=$1 AND state NOT IN ('SUCCEEDED','SKIPPED') RETURNING id`,[task.id,hash,context]);
        if(!active.rowCount){assertLease();await this.jobs.complete(job.id,leaseToken);return;}
        if(!task.execution_started_at&&!task.result){
          const started=await this.db.query('UPDATE ai_tasks SET execution_started_at=now() WHERE id=$1 AND execution_started_at IS NULL RETURNING id',[task.id]);
          if(started.rowCount){
            const remote=await this.platformAi.submit(task.ai_request_id,task.kind,hash,this.ai.prompt(task),context,abort.signal);
            assertLease();await this.db.query('UPDATE ai_tasks SET ai_job_id=$2 WHERE id=$1 AND ai_request_id=$3',[task.id,remote.id,task.ai_request_id]);
          }
        }
      }
      assertLease();await this.jobs.complete(job.id,leaseToken);
    }catch(error){
      if(!abort.signal.aborted&&!signal.aborted){
        try{
          assertLease();
          if(error instanceof NotFoundException){await this.jobs.complete(job.id,leaseToken);return;}
          const task=await this.ai.task(job.payload.taskId);
          if(error instanceof PlatformAiError&&[400,401,403,413,422].includes(error.status)){
            await this.db.query("UPDATE ai_tasks SET state='FAILED',execution_error='REQUEST_REJECTED',error_code='GENERATION_FAILED' WHERE id=$1",[task.id]);
            await this.jobs.fail(job.id,leaseToken,false);
          }else if(task.execution_started_at||task.result){
            await this.db.query("UPDATE ai_tasks SET state='RUNNING',error_code='EXECUTION_UNCONFIRMED' WHERE id=$1 AND state NOT IN ('SUCCEEDED','SKIPPED')",[task.id]);
            await this.jobs.complete(job.id,leaseToken);
          }else{
            await this.db.query("UPDATE ai_tasks SET state='FAILED',error_code='CONNECTION_FAILED' WHERE id=$1",[task.id]);
            await this.jobs.fail(job.id,leaseToken,true);
          }
        }catch{/* Lease uncertainty prevents subsequent writes and reports. */}
      }
    }finally{clearInterval(timer);signal.removeEventListener('abort',stop);}
  }

  // The independent result loop reads each due remote status once and applies by the stored business ID.
  async collect(signal:AbortSignal){
    if(!ready()||signal.aborted)return;
    await this.jobs.checkEnvironment();
    const task=await this.db.transaction(async tx=>{
      const row=(await tx.query(`SELECT id FROM ai_tasks WHERE
        (state='RUNNING' OR (state='FAILED' AND execution_error IS NULL
          AND execution_started_at>now()-interval '24 hours')) AND
        (execution_started_at IS NOT NULL OR result IS NOT NULL) AND result_check_at<=now()
        ORDER BY result_check_at,id LIMIT 1 FOR UPDATE SKIP LOCKED`)).rows[0];
      if(!row)return null;
      await tx.query("UPDATE ai_tasks SET state='RUNNING',completed_at=NULL,result_check_at=now()+interval '30 seconds' WHERE id=$1",[row.id]);
      return this.ai.task(row.id,tx);
    });
    if(!task)return;
    const assertActive=()=>{if(signal.aborted)throw Error('WORKER_STOPPED');};
    try{
      if(!task.result){
        const remote=task.ai_job_id
          ?await this.platformAi.get(task.ai_job_id,task.ai_request_id,task.kind,signal)
          :await this.platformAi.find(task.ai_request_id,task.kind,signal);
        assertActive();
        if(!remote){
          const old=task.execution_started_at&&Date.now()-new Date(task.execution_started_at).getTime()>24*60*60*1000;
          await this.db.query("UPDATE ai_tasks SET state=$2,error_code='EXECUTION_UNCONFIRMED' WHERE id=$1 AND state='RUNNING'",[task.id,old?'FAILED':'RUNNING']);return;
        }
        await this.db.query('UPDATE ai_tasks SET ai_job_id=$2 WHERE id=$1 AND ai_request_id=$3',[task.id,remote.id,task.ai_request_id]);
        if(remote.status==='running')return;
        if(remote.status!=='succeeded'||remote.result_expired||remote.result==null){
          await this.db.query("UPDATE ai_tasks SET state='FAILED',execution_error='GENERATION_FAILED',error_code='GENERATION_FAILED' WHERE id=$1 AND state='RUNNING'",[task.id]);return;
        }
        await this.ai.cacheResult(task.id,{hash:task.input_hash,result:taskResult(remote.result)},task.ai_request_id);
      }
      assertActive();await this.ai.apply(task.id,assertActive);
    }catch(error){
      if(signal.aborted||error instanceof NotFoundException)return;
      if(error instanceof ZodError){
        await this.db.query("UPDATE ai_tasks SET state='FAILED',execution_error='INVALID_RESPONSE',error_code='GENERATION_FAILED' WHERE id=$1 AND state='RUNNING'",[task.id]);
      }else{
        await this.db.query("UPDATE ai_tasks SET error_code='EXECUTION_UNCONFIRMED' WHERE id=$1 AND state='RUNNING'",[task.id]);
      }
    }
  }
}
