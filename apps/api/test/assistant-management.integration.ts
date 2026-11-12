import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import { Database } from '../src/database/database.js';
import { config } from '../src/config.js';
import { Sessions } from '../src/auth/sessions.js';

if (config.APP_ENV!=='test' || config.PGDATABASE!=='ggeujeok_test') throw new Error('Requires isolated DB');
const db = new Database(), origin = 'http://127.0.0.1:30108';
const server = spawn(process.execPath,['dist/main.js'],{env:{...process.env,PORT:'30108'},stdio:'ignore'});
after(async()=>{server.kill('SIGTERM');await db.end();});
const automation = '/api/automation/assistant', keys = '/api/admin/settings/assistant-keys';

async function request(path:string,status:number,method='GET',headers:Record<string,string>={},body?:unknown) {
  const response = await fetch(origin+path,{method,headers:{...headers,...(body===undefined?{}:{'Content-Type':'application/json'})},
    body:body===undefined ? undefined : JSON.stringify(body)});
  assert.equal(response.status,status,`${method} ${path}`);
  return response.json();
}

async function session(id:string) {
  let token = '';
  await new Sessions(db).create({cookie:(_name:string,value:string)=>{token=value;}} as Response,id);
  const Cookie = `ggeujeok_session=${token}`;
  const current = await request('/api/auth/session',200,'GET',{Cookie});
  return {Cookie,Origin:config.SITE_URL,'X-CSRF-Token':current.csrfToken as string};
}

test('assistant key scope, attribution, protected writes, recent summaries and review queues',async()=>{
  for (let attempt=0;;attempt++) {
    if (await fetch(origin+'/api/health').then(r=>r.ok).catch(()=>false)) break;
    if (attempt===49) throw new Error('Test API did not start');
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  const users:string[] = [], categoryIds:string[] = [], prefix=`assistant-${randomUUID().slice(0,8)}`;
  const addUser = async (subject:string) => {
    const {rows:[row]} = await db.query('INSERT INTO users(issuer,subject,display_name,nickname) VALUES($1,$2,$2,$2) RETURNING id',
      [config.ADMIN_OIDC_ISSUER,subject]);
    users.push(row.id); return row.id as string;
  };
  const {rows:[oldAdmin]} = await db.query('SELECT id FROM users WHERE issuer=$1 AND subject=$2',[config.ADMIN_OIDC_ISSUER,config.ADMIN_OIDC_SUBJECT]);
  const adminId = oldAdmin?.id ?? await addUser(config.ADMIN_OIDC_SUBJECT), visitorId = await addUser(`${prefix}-visitor`);
  const admin = await session(adminId), visitor = await session(visitorId);
  const issued:string[] = [];
  const issue = async (name:string,scope:Record<string,boolean>={}) => {
    const result = await request(keys,201,'POST',admin,{name,...scope});
    assert.match(result.token,/^ggm_[A-Za-z0-9_-]{43}$/);
    issued.push(result.key.id);
    return {...result,auth:{Authorization:`Bearer ${result.token}`}};
  };
  const draft = (id:string,auth:Record<string,string>) => request(`${automation}/posts/${id}`,200,'GET',auth);
  const publish = (post:any,auth:Record<string,string>,status=201) => request(`${automation}/posts/${post.id}/publish`,status,'POST',auth,
    {draftVersion:post.version,baseVersion:post.baseVersion});

  try {
    await request(keys,403,'POST',visitor,{name:prefix});
    await request(keys,403,'POST',{Cookie:admin.Cookie,Origin:admin.Origin},{name:prefix});
    const read = await issue(prefix+' read',{canWrite:false});
    const write = await issue(prefix+' write');
    const full = await issue(prefix+' full',{canPublish:true,canDelete:true});
    const listedKeys = await request(keys,200,'GET',admin);
    assert.ok(listedKeys.every((row:any)=>!row.token && !row.token_hash));
    await request(keys,401,'GET',full.auth);
    await request('/api/admin/posts',401,'GET',full.auth);
    await request(`${automation}/posts`,401,'GET',admin);
    assert.deepEqual((await request(`${automation}/capabilities`,200,'GET',read.auth)).write,false);

    const input = {requestId:prefix,slug:prefix,title:'루미 검증 글',summary:'최근 글 요약',markdown:'# 검증\n\n첫 글의 본문입니다.'};
    await request(`${automation}/posts`,403,'POST',read.auth,input);
    const [first,retry] = await Promise.all([request(`${automation}/posts`,201,'POST',write.auth,input),request(`${automation}/posts`,201,'POST',write.auth,input)]);
    assert.equal(first.id,retry.id);
    assert.notEqual(first.reused,retry.reused);
    await request(`${automation}/posts`,409,'POST',write.auth,{...input,title:'다른 요청'});
    const original = await draft(first.id,write.auth);
    const list = await request(`${automation}/categories`,200,'GET',read.auth);
    assert.equal(original.data.categoryId,list.find((item:any)=>item.slug==='lumi-view').id);
    assert.equal(original.aiGenerated,true);
    assert.equal(original.aiIdentity.source,'mcp');
    assert.equal((await request(`${automation}/posts?q=${prefix}`,200,'GET',read.auth)).items.length,0);
    await publish(original,write.auth,403);
    await request(`${automation}/posts/${first.id}`,403,'DELETE',write.auth);
    await publish(original,full.auth);
    assert.equal((await request(`${automation}/posts?q=${prefix}`,200,'GET',read.auth)).items[0].summary,input.summary);

    const current = await draft(first.id,write.auth);
    const body = {version:current.version,changes:{title:'제목만 수정'}};
    await request(`${automation}/posts/${first.id}`,200,'PATCH',write.auth,body);
    await request(`${automation}/posts/${first.id}`,409,'PATCH',write.auth,body);
    const revised = await draft(first.id,write.auth);
    assert.deepEqual(revised.data.content,current.data.content);
    assert.equal((await request(`/api/public/posts/${prefix}`,200)).title,input.title);
    await request(`${automation}/posts/${first.id}/review-request`,201,'POST',write.auth,{version:revised.version,sourceUrl:'https://example.test/source'});
    const candidates = await request(`${automation}/posts/review-candidates`,200,'GET',read.auth);
    assert.equal(candidates.items.find((item:any)=>item.id===first.id).sourceUrl,'https://example.test/source');
    await request(`${automation}/posts/${first.id}/review-complete`,201,'POST',write.auth,{version:revised.version});
    assert.ok(!(await request(`${automation}/posts/review-candidates`,200,'GET',read.auth)).items.some((item:any)=>item.id===first.id));

    const postPath = `/api/posts/${first.id}/comments`, assistantComments = `${automation}/posts/${first.id}/comments`;
    const visitorComment = async (content:string) => request(postPath,201,'POST',visitor,{requestId:randomUUID(),content});
    const one = await visitorComment('답변이 필요한 질문입니다.');
    const two = await visitorComment('감사합니다.');
    const unanswered = (await request(`${automation}/comments/unanswered`,200,'GET',read.auth)).items;
    const reply = {content:'루미가 답변합니다.',replyToId:one.id,expectedUpdatedAt:unanswered.find((item:any)=>item.id===one.id).updatedAt};
    const replyKey = randomUUID();
    const answer = await request(assistantComments,201,'POST',write.auth,{...reply,requestId:replyKey});
    assert.equal((await request(assistantComments,201,'POST',write.auth,{...reply,requestId:replyKey})).reused,true);
    await request(assistantComments,409,'POST',write.auth,{...reply,requestId:randomUUID()});
    await request(`${assistantComments}/${two.id}/review-skip`,201,'POST',write.auth,{expectedUpdatedAt:unanswered.find((item:any)=>item.id===two.id).updatedAt});
    assert.ok(!(await request(`${automation}/comments/unanswered`,200,'GET',read.auth)).items.some((item:any)=>[one.id,two.id].includes(item.id)));
    const thread = (await request(`${assistantComments}?thread=${one.id}`,200,'GET',read.auth)).items;
    assert.equal(thread.find((comment:any)=>comment.id===answer.id).aiIdentity.source,'mcp');
    assert.equal(thread.find((comment:any)=>comment.id===one.id).aiIdentity,null);
    await request(`${assistantComments}/${answer.id}`,403,'DELETE',write.auth);
    await request(`${assistantComments}/${answer.id}`,200,'DELETE',full.auth);

    for (const slug of ['privacy','app100']) {
      const category = await request(`${automation}/categories`,201,'POST',write.auth,{name:`검증 ${slug}`,slug});
      categoryIds.push(category.id);
      const {id} = await request(`${automation}/posts`,201,'POST',write.auth,{...input,requestId:`${prefix}-${slug}`,slug:`${prefix}-${slug}`,category:slug,adsEnabled:false});
      const saved = await draft(id,write.auth);
      await request(`${automation}/posts/${id}`,403,'DELETE',full.auth);
      await request(`${automation}/posts/${id}`,403,'PATCH',write.auth,{version:saved.version,changes:{category:'lumi-view'}});
      await request(`${automation}/posts/${id}`,200,'PATCH',write.auth,{version:saved.version,changes:{title:'보호 글은 수정 가능'}});
      const editable = await draft(id,write.auth);
      assert.equal(editable.data.adsEnabled,false);
      await publish(editable,full.auth);
      const published = await draft(id,write.auth);
      await request(`/api/admin/posts/${id}/publish`,403,'POST',admin,{draftVersion:published.version,baseVersion:published.baseVersion,status:'PRIVATE'});
      await request(`/api/admin/posts/${id}`,403,'DELETE',admin);
      await request(`${automation}/categories/${category.id}`,403,'PUT',write.auth,{name:`검증 ${slug}`,slug:`${prefix}-renamed`,sortOrder:0});
      await request(`${automation}/categories/${category.id}`,403,'DELETE',full.auth);
    }

    await db.query(`WITH inserted AS (INSERT INTO posts(slug,title,content,summary,status,published_at,category_id,author_id)
      SELECT $1||'-recent-'||i,'최근 목록 검증','{}','요약','PUBLIC',now()+i*interval '1 second',$2,$3
      FROM generate_series(1,26) i RETURNING id,slug)
      INSERT INTO post_drafts(post_id,data,base_version) SELECT id,jsonb_build_object('slug',slug),1 FROM inserted`,[prefix,original.data.categoryId,adminId]);
    const recent = await request(`${automation}/posts?q=${prefix}-recent`,200,'GET',read.auth);
    assert.equal(recent.items.length,25); assert.equal(recent.nextPage,2);
    assert.equal(recent.items[0].slug,`${prefix}-recent-26`);

    await request(`${automation}/posts/${first.id}`,200,'DELETE',full.auth);
    await request(`${automation}/posts`,409,'POST',write.auth,input);
    const {rows:audit} = await db.query('SELECT action,assistant_key_id,assistant_name FROM audit_events WHERE target_id=ANY($1::uuid[])',[ [first.id,answer.id] ]);
    for (const action of ['post.create','post.update','post.publish','post.delete','comment.create','comment.delete']) {
      assert.ok(audit.some(row=>row.action===action && row.assistant_key_id && row.assistant_name),action);
    }
    await request(`${keys}/${full.key.id}`,200,'DELETE',admin);
    await request(`${automation}/posts`,401,'GET',full.auth);
    await db.query("UPDATE assistant_keys SET expires_at=now()-interval '1 second' WHERE id=$1",[write.key.id]);
    await request(`${automation}/posts`,401,'GET',write.auth);
  } finally {
    await db.query('DELETE FROM posts WHERE starts_with(slug,$1)',[prefix]);
    await db.query('DELETE FROM categories WHERE id=ANY($1::uuid[])',[categoryIds]);
    await db.query('DELETE FROM assistant_keys WHERE id=ANY($1::uuid[])',[issued]);
    await db.query('DELETE FROM assistant_post_requests WHERE starts_with(id,$1)',[prefix]);
    await db.query('DELETE FROM users WHERE id=ANY($1::uuid[])',[users]);
  }
});
