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
import { Posts } from '../src/posts/posts.service.js';

if(config.APP_ENV!=='test'||config.PGDATABASE!=='ggeujeok_test')throw Error('Requires isolated test database');

test('submission releases the queue immediately; detached collection survives edits, restart, lost acceptance and a failed result write', async () => {
  const db=new Database(),ai=new Ai(db),original=globalThis.fetch;
  const actor=randomUUID(),postId=randomUUID(),otherPostId=randomUUID(),queueId=randomUUID(),remoteId=randomUUID();
  const project=randomUUID(),environment=randomUUID();
  Object.assign(config,{PLATFORM_URL:'https://platform.test',PLATFORM_API_KEY:'test-key',PLATFORM_PROJECT_ID:project,PLATFORM_ENVIRONMENT_ID:environment});
  let queueJob:unknown,remote:any,submissions=0,reads=0,completedJobs=0;
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
    if(address.pathname.startsWith('/api/v1/jobs/')){
      if(address.pathname.endsWith('/complete'))completedJobs++;
      return new Response(null,{status:204});
    }
    if(address.pathname==='/api/v1/ai/jobs' && init?.method==='POST'){
      submissions++;
      remote={id:remoteId,project,environment,request_id:body.request_id,task_type:body.task_type,
        status:'running',result:null,result_expired:false};
      throw Error('response lost after acceptance');
    }
    if(address.pathname==='/api/v1/ai/jobs' && address.search==='?limit=100'){reads++;return Response.json([remote]);}
    if(address.pathname===`/api/v1/ai/jobs/${remoteId}`){reads++;return Response.json(remote);}
    throw Error('Unexpected external request');
  };
  try{
    await db.query('INSERT INTO users(id,issuer,subject,display_name) VALUES($1,$2,$3,$4)',[actor,'https://worker-test.invalid',actor,'worker']);
    const data=initialPost(`worker-test-${postId}`);
    data.content.content.content=[{type:'paragraph',content:[{type:'text',text:'씨앗을 심고 싹이 자랐다.'}]}];
    await db.transaction(async tx=>{
      await createDraft(tx,postId,data,actor);
      await createDraft(tx,otherPostId,{...data,slug:`other-${otherPostId}`},actor);
    });
    await ai.saveSettings({revision:0,data:{...emptyAssistant,name:'루미',summaryEnabled:true}},actor);
    const task=await ai.requestSummary(postId,actor);
    await new AiWorker(db).run(new AbortController().signal);
    const uncertain=await ai.task(task.id);
    assert.equal(uncertain.state,'RUNNING');assert.equal(reads,0,'submission does not query or wait for the result');
    assert.equal(completedJobs,1,'the submission queue lease is released immediately');
    assert.equal((await ai.status(task.id)).errorCode,'EXECUTION_UNCONFIRMED');
    const posts=new Posts(db),draft=await posts.edit(postId);
    await posts.save(postId,{version:draft.version,data:{...draft.data,title:'요청 후 바꾼 제목'}});
    const settings=await ai.settings();await ai.saveSettings({revision:settings.revision,data:{...settings.data,tone:'바꾼 말투'}},actor);
    const collect=async()=>{
      await db.query('UPDATE ai_tasks SET result_check_at=now() WHERE id=$1',[task.id]);
      await new AiWorker(db).collect(new AbortController().signal);
    };
    await db.query("UPDATE ai_tasks SET state='FAILED',execution_error='GENERATION_FAILED' WHERE id=$1",[task.id]);
    await collect();assert.equal(reads,0,'a confirmed failure requires an explicit retry');
    await db.query('UPDATE ai_tasks SET execution_error=NULL WHERE id=$1',[task.id]);
    await collect();assert.equal(reads,1);assert.equal((await ai.task(task.id)).state,'RUNNING');
    remote.status='succeeded';remote.result={status:'completed',result:{summary:'씨앗을 심고 싹이 자라는 과정을 기록했어.'}};
    await collect();assert.equal((await ai.task(task.id)).state,'RUNNING','a DB failure is retried by the collector');
    await collect();
    const completed=await ai.task(task.id);
    assert.equal(completed.state,'SUCCEEDED');assert.equal(completed.ai_job_id,remoteId);assert.equal(submissions,1);
    assert.equal(completed.ai_request_id,uncertain.ai_request_id);
    assert.equal(completed.input_snapshot.title,draft.data.title,'the request retains its original input after edits');
    assert.equal((await posts.edit(postId)).data.title,'요청 후 바꾼 제목');
    assert.equal((await db.query('SELECT ai_summary FROM post_drafts WHERE post_id=$1',[postId])).rows[0].ai_summary,'씨앗을 심고 싹이 자라는 과정을 기록했어.');
    assert.equal((await db.query('SELECT ai_summary FROM posts WHERE id=$1',[postId])).rows[0].ai_summary,'씨앗을 심고 싹이 자라는 과정을 기록했어.');
    assert.equal((await db.query('SELECT ai_summary FROM posts WHERE id=$1',[otherPostId])).rows[0].ai_summary,null,'the remote result cannot affect a different post ID');
  } finally {
    globalThis.fetch=original;
    await db.query('DELETE FROM posts WHERE id=ANY($1::uuid[])',[[postId,otherPostId]]);
    await db.query('DELETE FROM ai_settings');
    await db.query('DELETE FROM users WHERE id=$1',[actor]);
    await db.end();
  }
});
