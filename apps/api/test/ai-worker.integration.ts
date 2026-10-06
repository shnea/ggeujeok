import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { config } from '../src/config.js';
import { Database } from '../src/database/database.js';
import { createDraft } from '../src/posts/create-draft.js';
import { initialPost } from '../src/posts/post-input.js';
import { emptyAssistant } from '../src/ai/assistant.js';
import { Ai } from '../src/ai/ai.service.js';
import { AiWorker } from '../src/ai/ai.worker.js';

if(config.APP_ENV!=='test'||config.PGDATABASE!=='ggeujeok_test')throw Error('Requires isolated test database');

test('worker recovers lost acceptance and a failed result write without repeating generation, leaving the summary in the draft', async () => {
  const db=new Database(),ai=new Ai(db),original=globalThis.fetch;
  const actor=randomUUID(),postId=randomUUID(),queueId=randomUUID(),remoteId=randomUUID();
  const project=randomUUID(),environment=randomUUID();
  Object.assign(config,{PLATFORM_URL:'https://platform.test',PLATFORM_API_KEY:'test-key',PLATFORM_PROJECT_ID:project,PLATFORM_ENVIRONMENT_ID:environment});
  let queueJob:unknown,remote:unknown,submissions=0;
  const query=db.query.bind(db);
  let failResultWrite=true;
  db.query=((sql:string,values?:unknown[])=>{
    if(failResultWrite && sql.startsWith('UPDATE ai_tasks SET result=$3')){
      failResultWrite=false;return Promise.reject(Error('temporary database failure'));
    }
    return query(sql,values);
  }) as typeof db.query;
  globalThis.fetch=async(url,init)=>{
    const address=new URL(String(url));
    const body=init?.body ? JSON.parse(String(init.body)) : null;
    if(address.pathname==='/api/v1/integration/context')return Response.json({projectId:project,environmentId:environment});
    if(address.pathname==='/api/v1/jobs'){
      queueJob={id:queueId,requestId:body.requestId,payload:body.payload,state:'QUEUED'};
      return Response.json(queueJob);
    }
    if(address.pathname==='/api/v1/jobs/claim')return Response.json({job:queueJob,leaseToken:'test-lease'});
    if(address.pathname.startsWith('/api/v1/jobs/'))return new Response(null,{status:204});
    if(address.pathname==='/api/v1/ai/jobs' && init?.method==='POST'){
      submissions++;
      remote={id:remoteId,project,environment,request_id:body.request_id,task_type:body.task_type,
        status:'succeeded',result:{status:'completed',result:{summary:'씨앗을 심고 싹이 자라는 과정을 기록했어.'}},result_expired:false};
      throw Error('response lost after acceptance');
    }
    if(address.pathname==='/api/v1/ai/jobs' && address.search==='?limit=100')return Response.json([remote]);
    if(address.pathname===`/api/v1/ai/jobs/${remoteId}`)return Response.json(remote);
    throw Error('Unexpected external request');
  };
  try{
    await db.query('INSERT INTO users(id,issuer,subject,display_name) VALUES($1,$2,$3,$4)',[actor,'https://worker-test.invalid',actor,'worker']);
    const data=initialPost(`worker-test-${postId}`);
    data.content.content.content=[{type:'paragraph',content:[{type:'text',text:'씨앗을 심고 싹이 자랐다.'}]}];
    await db.transaction(tx=>createDraft(tx,postId,data,actor));
    await ai.saveSettings({revision:0,data:{...emptyAssistant,name:'루미',summaryEnabled:true}},actor);
    const task=await ai.requestSummary(postId,actor);
    await new AiWorker(db).run(new AbortController().signal);
    const uncertain=await ai.task(task.id);
    assert.equal(uncertain.state,'FAILED');
    assert.equal((await ai.status(task.id)).errorCode,'EXECUTION_UNCONFIRMED');
    await ai.retry(task.id);
    const reconciled=await ai.task(task.id);
    assert.equal(reconciled.ai_request_id,uncertain.ai_request_id,'uncertain retries keep the remote request ID');
    assert.notEqual(reconciled.dispatch_id,uncertain.dispatch_id,'the queue dispatches status reconciliation separately');
    await new AiWorker(db).run(new AbortController().signal);
    const completed=await ai.task(task.id);
    assert.equal(completed.state,'SUCCEEDED');assert.equal(completed.ai_job_id,remoteId);assert.equal(submissions,1);
    assert.equal((await db.query('SELECT ai_summary FROM post_drafts WHERE post_id=$1',[postId])).rows[0].ai_summary,'씨앗을 심고 싹이 자라는 과정을 기록했어.');
    assert.equal((await db.query('SELECT ai_summary FROM posts WHERE id=$1',[postId])).rows[0].ai_summary,null);
  } finally {
    globalThis.fetch=original;
    await db.query('DELETE FROM posts WHERE id=$1',[postId]);
    await db.query('DELETE FROM ai_settings');
    await db.query('DELETE FROM users WHERE id=$1',[actor]);
    await db.end();
  }
});
