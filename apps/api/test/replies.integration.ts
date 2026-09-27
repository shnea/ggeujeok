import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import type { Response } from 'express';
import { Database } from '../src/database/database.js';
import { Sessions } from '../src/auth/sessions.js';
import { config } from '../src/config.js';

if (config.APP_ENV !== 'test' || config.PGDATABASE !== 'ggeujeok_test') throw new Error('Replies require isolated DB');
const db = new Database(), origin = 'http://127.0.0.1:30104';
const server = spawn(process.execPath, ['dist/main.js'], { env: { ...process.env, PORT:'30104', ADMIN_OIDC_SUBJECT:'reply-admin' }, stdio:'ignore' });
after(async () => { server.kill('SIGTERM'); await db.end(); });

async function account(subject: string) {
  const user = (await db.query(`INSERT INTO users(issuer,subject,display_name,nickname) VALUES($1,$2,'PRIVATE OIDC NAME',$2) RETURNING id`, [config.ADMIN_OIDC_ISSUER,subject])).rows[0];
  let token = '';
  await new Sessions(db).create({cookie: (_name: string,value: string) => {token=value;}} as Response,user.id);
  const cookie = `ggeujeok_session=${token}`;
  const session = await (await fetch(origin+'/api/auth/session',{headers:{Cookie:cookie}})).json() as {csrfToken:string};
  return {id:user.id,headers:{Cookie:cookie,Origin:config.SITE_URL,'X-CSRF-Token':session.csrfToken,'Content-Type':'application/json'}};
}

test('one-level replies preserve target names, ownership, pagination and deleted thread anchors', async () => {
  for (let i=0;i<50;i++) { try { if ((await fetch(origin+'/api/health')).ok) break; } catch {} await new Promise(resolve=>setTimeout(resolve,100)); }
  const admin=await account('reply-admin'), a=await account('reply-a'), b=await account('reply-b');
  const category=(await db.query('SELECT id FROM categories ORDER BY sort_order,id LIMIT 1')).rows[0].id;
  const ids:string[]=[];
  for (const slug of ['reply-post','reply-other']) {
    ids.push((await db.query(`INSERT INTO posts(slug,title,content,author_id,category_id,status,published_at) VALUES($1,$1,'{}',$2,$3,'PUBLIC',now()) RETURNING id`,[slug,admin.id,category])).rows[0].id);
  }
  const post=ids[0], base=`/api/posts/${post}/comments`;
  const send=(user:typeof a,path:string,method:string,body?:unknown)=>fetch(origin+path,{method,headers:user.headers,body:body===undefined?undefined:JSON.stringify(body)});
  const root=randomUUID(), child=randomUUID(), mention=randomUUID();
  const read=async()=> (await (await fetch(origin+'/api/public/posts/reply-post/interactions',{headers:a.headers})).json()) as any;
  const replies=async(page=1)=> (await (await fetch(origin+`/api/public/posts/reply-post/comments/${root}/replies?page=${page}`,{headers:a.headers})).json()) as any;
  let guestCookie='';
  async function guest(body:object,method='POST',suffix='') {
    const issued=await fetch(origin+'/api/guest/captcha',{headers:guestCookie?{Cookie:guestCookie}:{}});
    guestCookie=issued.headers.get('set-cookie')!.split(';')[0];
    const captcha=await issued.json() as {id:string};
    await db.query('UPDATE comment_captchas SET answer_hash=$2 WHERE id=$1',[captcha.id,createHash('sha256').update(captcha.id+'234567').digest('hex')]);
    return fetch(origin+`/api/guest/posts/${post}/comments${suffix}`,{method,headers:{Cookie:guestCookie,Origin:config.SITE_URL,'Content-Type':'application/json'},
      body:JSON.stringify({...body,captchaId:captcha.id,captchaAnswer:'234567'})});
  }
  try {
    assert.equal((await send(a,base,'POST',{requestId:root,content:'원댓글 비밀 원문'})).status,201);
    assert.equal((await send(b,base,'POST',{requestId:child,content:'첫 답글',parentId:root,replyToId:root})).status,201);
    const input={requestId:mention,content:'대댓글에 답글',parentId:root,replyToId:child};
    assert.equal((await send(a,base,'POST',input)).status,201);
    assert.equal((await send(a,base,'POST',input)).status,201);
    assert.equal((await send(a,base,'POST',{...input,replyToId:root})).status,409);
    let result=await read();
    assert.equal(result.comments.length,1); assert.equal(result.threadCount,1); assert.equal(result.commentCount,3); assert.equal(result.comments[0].replyCount,2);
    let list=await replies();
    assert.equal(list.items[1].replyToName,'reply-b'); assert.equal(list.items[1].parentId,root);
    assert.equal(list.items[0].replyToName,null);
    assert.ok(!JSON.stringify(list).includes('PRIVATE OIDC NAME'));
    const otherRoot=randomUUID();
    assert.equal((await send(a,`/api/posts/${ids[1]}/comments`,'POST',{requestId:otherRoot,content:'다른 글'})).status,201);
    for (const target of [{parentId:otherRoot},{parentId:child},{parentId:root,replyToId:otherRoot},{parentId:root,replyToId:randomUUID()}]) {
      assert.equal((await send(b,base,'POST',{requestId:randomUUID(),content:'잘못 연결',...target})).status,404);
    }
    assert.equal((await send(b,base,'POST',{requestId:randomUUID(),content:'부모 없음',replyToId:child})).status,409);
    assert.equal((await send(a,base+'/'+child,'PUT',{content:'탈취'})).status,403);
    assert.equal((await send(b,base+'/'+child,'PUT',{content:'수정 답글'})).status,200);
    assert.equal((await send(a,base+'/'+child,'DELETE')).status,403);
    const guestId=randomUUID(), password='guest-reply-password';
    assert.equal((await guest({requestId:guestId,nickname:'비회원답글',password,content:'비회원 멘션',parentId:root,replyToId:mention})).status,201);
    list=await replies(); assert.equal(list.items[2].replyToName,'reply-a');
    await db.query('UPDATE users SET custom_nickname=$2 WHERE id=$1',[a.id,'끄적 답글 이름']);
    list=await replies(); assert.equal(list.items[2].replyToName,'끄적 답글 이름');
    await db.query('UPDATE users SET custom_nickname=NULL WHERE id=$1',[a.id]);
    assert.equal((await guest({password:'wrong-password',content:'탈취'},'PUT','/'+guestId)).status,403);
    assert.equal((await guest({password,content:'수정한 비회원 답글'},'PUT','/'+guestId)).status,200);
    assert.equal((await send(admin,base+'/'+root,'DELETE')).status,200);
    result=await read();
    assert.equal(result.threadCount,1); assert.equal(result.comments[0].isDeleted,true); assert.equal(result.commentCount,3);
    assert.ok(!JSON.stringify(result).includes('비밀 원문'));
    const erased=(await db.query('SELECT user_id,guest_name,guest_password,request_hash FROM comments WHERE id=$1',[root])).rows[0];
    assert.deepEqual(erased,{user_id:null,guest_name:null,guest_password:null,request_hash:''});
    assert.equal((await send(a,base+'/'+root,'PUT',{content:'복원'})).status,404);
    assert.equal((await send(b,base,'POST',{requestId:randomUUID(),content:'삭제한 원글에 직접답글',parentId:root,replyToId:root})).status,404);
    assert.equal((await send(b,base,'POST',{requestId:randomUUID(),content:'살아있는 답글에 답글',parentId:root,replyToId:mention})).status,201);
    assert.equal((await send(b,base+'/'+child,'DELETE')).status,200);
    list=await replies(); assert.equal(list.items.find((item:any)=>item.id===mention).replyToName,'삭제된 댓글');
    assert.equal((await guest({password},'DELETE','/'+guestId)).status,200);
    assert.equal((await db.query('SELECT guest_password FROM comments WHERE id=$1',[guestId])).rows[0].guest_password,null);
    await db.query(`INSERT INTO comments(id,post_id,user_id,parent_id,content,request_hash)
      SELECT gen_random_uuid(),$1,$2,$3,'페이지 답글 '||n,'fixture' FROM generate_series(1,22) n`,[post,a.id,root]);
    const first=await replies(), second=await replies(2);
    assert.equal(first.items.length,20); assert.equal(second.items.length,4);
    assert.equal(new Set([...first.items,...second.items].map(item=>item.id)).size,24);
    await db.query("UPDATE posts SET status='PRIVATE' WHERE id=$1",[post]);
    assert.equal((await fetch(origin+`/api/public/posts/reply-post/comments/${root}/replies`)).status,404);
    assert.equal((await send(b,base,'POST',{requestId:randomUUID(),content:'비공개 답글',parentId:root,replyToId:mention})).status,404);
    await db.query("UPDATE posts SET status='PUBLIC' WHERE id=$1",[post]);
    for (const item of [...first.items,...second.items]) assert.equal((await send(admin,base+'/'+item.id,'DELETE')).status,200);
    result=await read(); assert.equal(result.threadCount,0); assert.equal(result.commentCount,0); assert.equal(result.comments.length,0);
    const raceRoot=randomUUID();
    assert.equal((await send(a,base,'POST',{requestId:raceRoot,content:'동시 요청'})).status,201);
    const race=await Promise.all([send(admin,base+'/'+raceRoot,'DELETE'),send(b,base,'POST',{requestId:randomUUID(),content:'동시 답글',parentId:raceRoot})]);
    assert.equal(race[0].status,200); assert.ok([201,404].includes(race[1].status));
    const adminList=await (await fetch(origin+'/api/admin/comments',{headers:admin.headers})).json() as any;
    assert.ok(adminList.items.every((item:any)=>item.id!==root));
  } finally {
    await db.query('DELETE FROM posts WHERE id=ANY($1::uuid[])',[ids]);
    assert.equal((await db.query('SELECT 1 FROM comments WHERE post_id=ANY($1::uuid[])',[ids])).rowCount,0);
  }
});
