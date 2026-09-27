import 'reflect-metadata';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Database } from '../src/database/database.js';
import { config } from '../src/config.js';
import { Ai, enqueueAssistantReply, inputHash } from '../src/ai/ai.service.js';
import { emptyAssistant } from '../src/ai/assistant.js';
import { Activity } from '../src/activity/activity.service.js';
import { Captchas } from '../src/activity/captcha.service.js';
import { Notifications } from '../src/notifications/notifications.service.js';
import { initialPost } from '../src/posts/post-input.js';

if(config.APP_ENV!=='test'||config.PGDATABASE!=='ggeujeok_test')throw Error('Requires isolated test database');
Object.assign(config,{N8N_WEBHOOK_BASE_URL:'https://test.invalid/webhook',N8N_WEBHOOK_TOKEN:'test',AI_CALLBACK_TOKEN:'test'});
const db=new Database(),ai=new Ai(db),ids:string[]=[],posts:string[]=[];
after(async()=>{await db.query('DELETE FROM posts WHERE id=ANY($1::uuid[])',[posts]);await db.query('DELETE FROM ai_tasks WHERE actor_id=ANY($1::uuid[])',[ids]);await db.query('DELETE FROM users WHERE id=ANY($1::uuid[])',[ids]);await db.query('DELETE FROM ai_settings');await db.end();});
async function user(name:string){const id=randomUUID();ids.push(id);await db.query('INSERT INTO users(id,issuer,subject,display_name,nickname) VALUES($1::uuid,$2,$1::text,$3,$3)',[id,'https://ai-test.invalid',name]);return id;}
async function post(author:string,title:string){
  const id=randomUUID();posts.push(id);const data=initialPost(`ai-test-${id}`);data.title=title;
  await db.query(`INSERT INTO posts(id,slug,title,author_id,content,content_text,status,category_id,published_at)
    SELECT $1,$2,$3,$4,$5,'실제 본문', 'PUBLIC',id,now() FROM categories WHERE slug='lumi-view'`,[id,data.slug,title,author,data.content]);
  await db.query('INSERT INTO post_drafts(post_id,data,base_version) VALUES($1,$2,1)',[id,data]);return id;
}
async function comment(postId:string,userId:string|null,content:string,guest='same-name'){
  const id=randomUUID();await db.query(`INSERT INTO comments(id,post_id,user_id,guest_name,guest_password,content,request_hash)
    VALUES($1,$2,$3,$4,$5,$6,'test')`,[id,postId,userId,userId?null:guest,userId?null:'not-a-real-password',content]);return id;
}
async function generated(id:string,result:unknown){
  const task=await ai.task(id),context=await ai.context(task);assert.ok(context);
  const hash=inputHash(context);await db.query("UPDATE ai_tasks SET state='RUNNING',input_hash=$2 WHERE id=$1",[id,hash]);
  assert.deepEqual(await ai.claim(id,{hash}),{cached:false});
  await assert.rejects(()=>ai.claim(id,{hash}));
  await ai.cacheResult(id,{hash,result});assert.equal((await ai.claim(id,{hash})).cached,true);
}

test('assistant memory is account scoped, mentions bypass scheduled batch limit, results are guarded and disclosed',async()=>{
  const owner=await user('ai-owner'),member=await user('same-name'),other=await user('ai-other');
  const profile={...emptyAssistant,name:'루미',personality:'작은 요정',tone:'반말',summaryEnabled:true,tagsEnabled:true,
    commentsEnabled:true,mentionsEnabled:true,mentionKeyword:'@루미'};
  const settings=await ai.settings();await ai.saveSettings({data:profile,revision:settings.revision},owner);
  const a=await post(owner,'A'),b=await post(owner,'B');
  const remembered=await comment(b,member,'도커를 배우고 있어');await comment(b,other,'다른 회원의 기억');
  const target=await comment(a,member,'@루미 안녕');await db.transaction(tx=>enqueueAssistantReply(tx,a,target,'@루미 안녕'));
  const task=(await db.query('SELECT id FROM ai_tasks WHERE comment_id=$1',[target])).rows[0];
  let context=await ai.context(await ai.task(task.id)) as any;
  assert.equal(context.directMention,true);assert.deepEqual(context.memory.map((m:any)=>m.content),['도커를 배우고 있어']);
  await db.query("UPDATE users SET custom_nickname='changed-name' WHERE id=$1",[member]);
  context=await ai.context(await ai.task(task.id)) as any;assert.equal(context.target.name,'changed-name');assert.equal(context.memory.length,1);
  const guest=await comment(a,null,'@루미 안녕');await db.transaction(tx=>enqueueAssistantReply(tx,a,guest,'@루미 안녕'));
  const guestTask=(await db.query('SELECT id FROM ai_tasks WHERE comment_id=$1',[guest])).rows[0];
  assert.deepEqual((await ai.context(await ai.task(guestTask.id)) as any).memory,[]);
  await db.query("UPDATE comments SET status='DELETED',content='삭제됨',user_id=NULL WHERE id=$1",[remembered]);
  assert.deepEqual((await ai.context(await ai.task(task.id)) as any).memory,[]);
  const scheduled=[];for(let i=0;i<4;i++)scheduled.push(await comment(a,member,`질문 ${i}`));
  await ai.schedule();assert.equal((await db.query('SELECT count(*)::int AS n FROM ai_tasks WHERE post_id=ANY($1::uuid[]) AND priority=false',[[a,b]])).rows[0].n,3);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM ai_tasks WHERE post_id=$1 AND priority=true',[a])).rows[0].n,2);
  await generated(task.id,{comment:'안녕. 오늘은 어떤 글을 보고 있었어?'});
  await assert.rejects(()=>ai.apply(task.id,()=>{throw Error('lease lost');}));
  assert.equal((await db.query('SELECT count(*)::int AS n FROM comments WHERE ai_identity IS NOT NULL AND post_id=$1',[a])).rows[0].n,0);
  await ai.apply(task.id,()=>{});await ai.apply(task.id,()=>{});
  const replies=(await db.query('SELECT * FROM comments WHERE ai_identity IS NOT NULL AND post_id=$1',[a])).rows;
  assert.equal(replies.length,1);assert.equal(replies[0].ai_identity.name,'루미');assert.equal(replies[0].user_id,null);
  const activity=new Activity(db,new Captchas(db),new Notifications(db));
  const visible=await activity.replies(`ai-test-${a}`,target,null,1);assert.equal(visible.items[0].isGuest,false);assert.equal(visible.items[0].authorName,'루미');
  await assert.rejects(()=>activity.guestChange(a,replies[0].id,{password:'not-a-real-password'},true));
  await generated(guestTask.id,{comment:'반가워.'});await db.query("UPDATE comments SET content='수정한 댓글' WHERE id=$1",[guest]);
  await ai.apply(guestTask.id,()=>{});assert.equal((await ai.task(guestTask.id)).state,'SKIPPED');
  const summary=await ai.requestSummary(a,owner);await generated(summary.id,{summary:'루미가 핵심을 요약했어.'});
  await ai.apply(summary.id,()=>{});
  const result=(await db.query('SELECT ai_summary,summary,ai_summary_identity FROM posts WHERE id=$1',[a])).rows[0];
  assert.equal(result.summary,'');assert.equal(result.ai_summary_identity.name,'루미');assert.equal(result.ai_summary,'루미가 핵심을 요약했어.');
  await db.query("UPDATE posts SET summary='직접 쓴 요약' WHERE id=$1",[b]);await assert.rejects(()=>ai.requestSummary(b,owner));
  const pending=(await db.query("SELECT id FROM ai_tasks WHERE post_id=$1 AND kind='comment' AND state='PENDING' LIMIT 1",[a])).rows[0];
  const current=await ai.settings();await ai.saveSettings({revision:current.revision,data:{...profile,commentsEnabled:false,mentionsEnabled:false}},owner);
  assert.equal(await ai.context(await ai.task(pending.id)),null);
});

test('tags fill an empty draft without hiding an editor conflict; generated articles stay disclosed drafts in the assigned category',async()=>{
  const owner=await user('ai-draft-owner'),p=await post(owner,'태그 없는 글');
  const settings=await ai.settings();
  const tags=(await db.query(`INSERT INTO ai_tasks(kind,post_id,post_version,profile,settings_revision)
    VALUES('tags',$1,1,$2,$3) RETURNING id`,[p,settings.data,settings.revision])).rows[0];
  await generated(tags.id,{tags:['도커','운영']});await ai.apply(tags.id,()=>{});
  const draft=(await db.query('SELECT version,data FROM post_drafts WHERE post_id=$1',[p])).rows[0];
  assert.equal(draft.version,2);assert.deepEqual(draft.data.tags,['도커','운영']);
  const article=await ai.requestArticle({topic:'요즘 기술',requestId:randomUUID()},owner);
  await generated(article.id,{title:'새로운 기술 이야기',paragraphs:['첫 문단.','두 번째 문단.','마지막 문단.'],sources:[{title:'자료',url:'https://example.com/source'}]});
  await ai.apply(article.id,()=>{});await ai.apply(article.id,()=>{});
  const task=await ai.task(article.id);posts.push(task.post_id!);
  const created=(await db.query('SELECT p.status,p.ai_generated,p.ai_identity,c.slug FROM posts p JOIN categories c ON c.id=p.category_id WHERE p.id=$1',[task.post_id])).rows[0];
  assert.equal(created.status,'DRAFT');assert.equal(created.ai_generated,true);assert.equal(created.ai_identity.name,'루미');assert.equal(created.slug,'lumi-view');
  const another=await post(owner,'설정 변경 중인 요약');
  const before=await ai.requestSummary(another,owner);
  const current=await ai.settings();await ai.saveSettings({data:{...current.data,tone:'짧은 반말'},revision:current.revision},owner);
  await ai.apply(before.id,()=>{});assert.equal((await ai.task(before.id)).state,'SKIPPED');
  const next=await ai.requestSummary(another,owner);assert.notEqual(next.id,before.id,'a new configuration gets a new request UUID');
});

test('comments on AI-authored posts call the assistant without a keyword, including guests and replies',async()=>{
  const owner=await user('ai-call-owner'),member=await user('ai-call-member');
  const settings=await ai.settings();
  await ai.saveSettings({revision:settings.revision,data:{...settings.data,mentionsEnabled:true,commentsEnabled:false}},owner);
  const human=await post(owner,'사람의 글'),written=await post(owner,'루미의 글');
  await db.query(`UPDATE posts SET ai_generated=true,ai_identity='{"name":"루미","imageUrl":null}' WHERE id=$1`,[written]);
  const plain=await comment(human,member,'잘 읽었어');
  await db.transaction(tx=>enqueueAssistantReply(tx,human,plain,'잘 읽었어'));
  assert.equal((await db.query('SELECT id FROM ai_tasks WHERE comment_id=$1',[plain])).rowCount,0,'category alone never identifies AI authorship');
  const root=await comment(written,member,'이 글 이해했어?'),guest=await comment(written,null,'나도 궁금해');
  await db.query('UPDATE comments SET parent_id=$2,reply_to_id=$2 WHERE id=$1',[guest,root]);
  for(const [id,content] of [[root,'이 글 이해했어?'],[guest,'나도 궁금해']]){
    await db.transaction(tx=>enqueueAssistantReply(tx,written,id,content));
    await db.transaction(tx=>enqueueAssistantReply(tx,written,id,content));
    const task=(await db.query('SELECT * FROM ai_tasks WHERE comment_id=$1',[id])).rows;
    assert.equal(task.length,1);assert.equal(task[0].priority,true);
    assert.equal((await ai.context(task[0]) as any).directMention,true);
  }
  const task=(await db.query('SELECT id FROM ai_tasks WHERE comment_id=$1',[root])).rows[0];
  await generated(task.id,{comment:'응! 여기서 새로 알게 된 게 있어 ✨'});await ai.apply(task.id,()=>{});
  const reply=(await db.query('SELECT id,content FROM comments WHERE post_id=$1 AND ai_identity IS NOT NULL',[written])).rows[0];
  await db.transaction(tx=>enqueueAssistantReply(tx,written,reply.id,reply.content));
  assert.equal((await db.query('SELECT id FROM ai_tasks WHERE comment_id=$1',[reply.id])).rowCount,0,'AI never calls itself');
  const guestTask=(await db.query('SELECT * FROM ai_tasks WHERE comment_id=$1',[guest])).rows[0];
  await db.query('UPDATE posts SET comments_enabled=false WHERE id=$1',[written]);
  assert.equal(await ai.context(guestTask),null,'closing comments cancels pending replies');
  await db.query('UPDATE posts SET comments_enabled=true WHERE id=$1',[written]);
  const latest=await ai.settings();await ai.saveSettings({revision:latest.revision,data:{...latest.data,mentionsEnabled:false}},owner);
  const disabled=await comment(written,member,'기능을 껐을 때');
  await db.transaction(tx=>enqueueAssistantReply(tx,written,disabled,'기능을 껐을 때'));
  assert.equal((await db.query('SELECT id FROM ai_tasks WHERE comment_id=$1',[disabled])).rowCount,0);
});
