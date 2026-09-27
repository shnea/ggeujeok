import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type { Response } from 'express';
import { Database } from '../src/database/database.js';
import { Posts } from '../src/posts/posts.service.js';
import { Sessions } from '../src/auth/sessions.js';
import { syncPlatformUser } from '../src/auth/platform-profile.js';
import { config } from '../src/config.js';

if (config.APP_ENV !== 'test' || config.PGDATABASE !== 'ggeujeok_test') throw new Error('Activity tests require isolated DB');
const db = new Database(), posts = new Posts(db), origin = 'http://127.0.0.1:30103';
const server = spawn(process.execPath, ['dist/main.js'], { env: { ...process.env, PORT: '30103', ADMIN_OIDC_SUBJECT: 'activity-admin' }, stdio: 'ignore' });
after(async () => { server.kill('SIGTERM'); await db.end(); });

async function account(subject: string) {
  const user = (await db.query(`INSERT INTO users(issuer,subject,display_name) VALUES($1,$2,'PRIVATE OIDC NAME')
    ON CONFLICT(issuer,subject) DO UPDATE SET subject=EXCLUDED.subject RETURNING id`, [config.ADMIN_OIDC_ISSUER, subject])).rows[0];
  let token = '';
  await new Sessions(db).create({cookie: (_name: string, value: string) => { token = value; }} as Response, user.id);
  const cookie = `ggeujeok_session=${token}`;
  const session = await (await fetch(origin+'/api/auth/session', {headers:{Cookie:cookie}})).json() as {csrfToken:string};
  return { id:user.id, headers: {Cookie:cookie,Origin:config.SITE_URL,'X-CSRF-Token':session.csrfToken,'Content-Type':'application/json'} };
}

test('comment ownership, nickname privacy, CSRF, idempotency, rate limits, likes and hidden posts', async () => {
  for(let i=0;i<50;i++) { try { if((await fetch(origin+'/api/health')).ok) break; } catch {} await new Promise(resolve=>setTimeout(resolve,100)); }
  const admin = await account('activity-admin'), a = await account('activity-a'), b = await account('activity-b');
  const send = (who: typeof a, path: string, method: string, body?: unknown) => fetch(origin+path,{method,headers:who.headers,body:body === undefined ? undefined : JSON.stringify(body)});
  const category = (await posts.categories())[0].id;
  const {id} = await posts.create(admin.id), draft = await posts.edit(id);
  const saved = await posts.save(id,{version:1,data:{...draft.data,slug:'activity-post',categoryId:category,
    content:{format:'shnea-editor',version:3,content:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Activity fixture'}]}]}}}});
  await posts.publish(id,{draftVersion:saved.version,baseVersion:1,status:'PUBLIC'},admin.id);
  const path = `/api/posts/${id}`, readPath = '/api/public/posts/activity-post/interactions';
  const read = async (who?: typeof a, page = 1) => (await fetch(origin+readPath+`?page=${page}`,{headers:who?.headers})).json() as Promise<any>;
  try {
    assert.equal((await fetch(origin+path+'/comments',{method:'POST'})).status,401);
    assert.equal((await fetch(origin+path+'/like',{method:'PUT',headers:{Cookie:a.headers.Cookie}})).status,403);
    assert.equal((await send(a,'/api/me/nickname','PUT',{nickname:'로컬 이름'})).status,404);
    assert.equal(await syncPlatformUser(db,config.ADMIN_OIDC_ISSUER,'activity-a','댓글회원A'), a.id);
    assert.equal(await syncPlatformUser(db,config.ADMIN_OIDC_ISSUER,'activity-b','댓글회원A'), b.id);
    assert.notEqual(a.id,b.id,'Duplicate nicknames never merge identities');
    const relogged = await account('activity-a');
    const reloggedSession = await (await fetch(origin+'/api/auth/session',{headers:relogged.headers})).json() as {user:{nickname:string}};
    assert.equal(reloggedSession.user.nickname,'댓글회원A');
    const input = {requestId:randomUUID(),content:'<script>alert(1)</script> 평문 댓글'};
    assert.equal((await send(a,path+'/comments','POST',{...input,content:'   '})).status,400);
    assert.equal((await send(a,path+'/comments','POST',{...input,content:'x'.repeat(2001)})).status,400);
    const parallel = await Promise.all(Array.from({length:8},()=>send(a,path+'/comments','POST',input)));
    assert.ok(parallel.every(result=>result.status===201));
    assert.equal((await read()).commentCount,1);
    assert.equal((await send(a,path+'/comments','POST',{...input,content:'changed request'})).status,409);
    const publicResult = await read(), personal = await read(a);
    assert.equal(publicResult.comments[0].authorName,'댓글회원A');
    assert.ok(!JSON.stringify(publicResult).includes('PRIVATE OIDC NAME'));
    assert.equal(publicResult.comments[0].canEdit,false); assert.equal(personal.comments[0].canEdit,true);
    const commentPath = path+`/comments/${input.requestId}`;
    assert.equal((await send(b,commentPath,'PUT',{content:'hijack'})).status,403);
    assert.equal((await send(admin,commentPath,'PUT',{content:'admin edit'})).status,403);
    assert.equal((await send(b,commentPath,'DELETE')).status,403);
    assert.equal((await send(a,commentPath,'PUT',{content:'본인 수정'})).status,200);
    assert.equal((await read()).comments[0].content,'본인 수정');
    assert.equal(await syncPlatformUser(db,config.ADMIN_OIDC_ISSUER,'activity-a','새'),a.id);
    assert.equal((await read()).comments[0].authorName,'새','Existing comments follow the synchronized nickname');
    assert.equal((await send(b,commentPath,'PUT',{content:'다른 계정'})).status,403);
    const profilePath = '/api/me/profile';
    assert.equal((await fetch(origin+profilePath)).status,401);
    assert.equal((await fetch(origin+profilePath,{method:'PUT',headers:{Cookie:a.headers.Cookie,'Content-Type':'application/json'},body:JSON.stringify({nickname:'탈취'})})).status,403);
    assert.equal((await send(a,profilePath,'PUT',{nickname:'<script>'})).status,400);
    assert.equal((await send(a,profilePath,'PUT',{nickname:'가'})).status,400);
    assert.equal((await send(a,profilePath,'PUT',{nickname:'관리자'})).status,403);
    assert.equal((await send(a,profilePath,'PUT',{nickname:'공격',userId:b.id})).status,400);
    const custom = await send(a,profilePath,'PUT',{nickname:'  끄적 이름  '});
    assert.equal(custom.status,200);
    assert.deepEqual(await custom.json(),{nickname:'끄적 이름',defaultNickname:'새',customNickname:'끄적 이름'});
    assert.equal((await read()).comments[0].authorName,'끄적 이름');
    await syncPlatformUser(db,config.ADMIN_OIDC_ISSUER,'activity-a','변경된 계정 이름');
    const nextLogin = await account('activity-a');
    assert.equal((await (await fetch(origin+'/api/auth/session',{headers:nextLogin.headers})).json() as any).user.nickname,'끄적 이름');
    const currentProfile = await (await send(a,profilePath,'GET')).json() as any;
    assert.equal(currentProfile.defaultNickname,'변경된 계정 이름');
    assert.equal((await (await send(b,profilePath,'GET')).json() as any).nickname,'댓글회원A','Other account unchanged');
    assert.equal((await send(b,profilePath,'PUT',{nickname:'끄적 이름'})).status,200,'Duplicate display names allowed');
    assert.equal((await send(b,commentPath,'DELETE')).status,403,'Duplicate display name never grants ownership');
    const reset = await send(a,profilePath,'PUT',{nickname:null});
    assert.equal(reset.status,200);
    assert.deepEqual(await reset.json(),{nickname:'변경된 계정 이름',defaultNickname:'변경된 계정 이름',customNickname:null});
    assert.equal((await read()).comments[0].authorName,'변경된 계정 이름');


    assert.equal((await send(a,path+'/comments','POST',input)).status,201,'Retry does not overwrite an edited comment');
    assert.equal((await read()).comments[0].content,'본인 수정');

    assert.equal((await send(admin,commentPath,'DELETE')).status,200);
    assert.equal((await read()).commentCount,0);
    for(let i=0;i<4;i++) assert.equal((await send(a,path+'/comments','POST',{requestId:randomUUID(),content:`comment ${i}`})).status,201);
    const limited = await send(a,path+'/comments','POST',{requestId:randomUUID(),content:'over minute limit'});
    assert.equal(limited.status,429); assert.ok(Number(limited.headers.get('retry-after'))>0);
    assert.ok((await limited.json() as {retryAfterSeconds:number}).retryAfterSeconds>0);
    await db.query("UPDATE activity_limits SET events=ARRAY(SELECT now()-interval '2 minutes' FROM generate_series(1,60)) WHERE user_id=$1 AND action='comment'",[a.id]);
    assert.equal((await send(a,path+'/comments','POST',{requestId:randomUUID(),content:'over hour limit'})).status,429);
    assert.ok((await Promise.all(Array.from({length:8},()=>send(a,path+'/like','PUT')))).every(result=>result.status===200));
    assert.equal((await read(a)).likeCount,1); assert.equal((await read(a)).liked,true); assert.equal((await read(b)).liked,false);
    await send(b,path+'/like','PUT'); assert.equal((await read()).likeCount,2);
    await verifyGuests(id,admin);
    assert.equal((await fetch(origin+'/api/admin/comments')).status,401);
    assert.equal((await fetch(origin+'/api/admin/comments',{headers:a.headers})).status,403);
    assert.equal((await fetch(origin+'/api/admin/comments',{headers:admin.headers})).status,200);
    await db.query("UPDATE activity_limits SET events=ARRAY(SELECT now() FROM generate_series(1,60)) WHERE user_id=$1 AND action='like'",[a.id]);
    assert.equal((await send(a,path+'/like','PUT')).status,200,'Idempotent retry does not consume rate limit');
    assert.equal((await send(a,path+'/like','DELETE')).status,429);
    await db.query("UPDATE activity_limits SET events=ARRAY[now()-interval '2 minutes'] WHERE user_id=$1 AND action='like'",[a.id]);
    assert.equal((await send(a,path+'/like','DELETE')).status,200);
    assert.equal((await send(a,path+'/like','DELETE')).status,200); assert.equal((await read()).likeCount,1);
    await db.query(`INSERT INTO comments(id,post_id,user_id,content,request_hash,created_at)
      SELECT gen_random_uuid(),$1,$2,'page comment','fixture','2020-01-01' FROM generate_series(1,22)`,[id,b.id]);
    const first = await read(a), second = await read(a,2);
    assert.equal(first.comments.length,20); assert.equal(second.comments.length,6);
    assert.equal(new Set([...first.comments,...second.comments].map(item=>item.id)).size,26);
    const current = await posts.edit(id);
    await posts.publish(id,{draftVersion:current.version,baseVersion:current.baseVersion,status:'PRIVATE'},admin.id);
    assert.equal((await fetch(origin+readPath)).status,404);
    assert.equal((await send(a,path+'/like','PUT')).status,404);
    assert.equal((await send(a,path+'/comments','POST',{requestId:randomUUID(),content:'hidden'})).status,404);
    assert.equal((await send(b,path+`/comments/${first.comments[0].id}`,'DELETE')).status,404);
    assert.equal((await send(admin,path+`/comments/${first.comments[0].id}`,'DELETE')).status,200);
    await posts.remove(id,admin.id);
    assert.equal((await db.query('SELECT 1 FROM comments WHERE post_id=$1',[id])).rowCount,0);
    assert.equal((await db.query('SELECT 1 FROM post_likes WHERE post_id=$1',[id])).rowCount,0);
    const neighbors = [];
    for(let i=0;i<3;i++) neighbors.push((await db.query(`INSERT INTO posts(slug,title,content,author_id,category_id,status,published_at)
      VALUES($1,$1,'{}',$2,$3,'PUBLIC',$4) RETURNING id`,[`neighbor-${i}`,admin.id,category,`2100-01-0${i+1}T00:00:00Z`])).rows[0].id);
    assert.deepEqual(await posts.neighbors('neighbor-1'),{previous:{slug:'neighbor-0',title:'neighbor-0'},next:{slug:'neighbor-2',title:'neighbor-2'}});
    assert.equal((await posts.neighbors('neighbor-2')).next,null);
    await db.query("UPDATE posts SET status='PRIVATE' WHERE id=$1",[neighbors[1]]);
    assert.equal((await posts.neighbors('neighbor-0')).next.slug,'neighbor-2');
    await assert.rejects(posts.neighbors('neighbor-1'),{status:404});
    await db.query('DELETE FROM posts WHERE id=ANY($1::uuid[])',[neighbors]);
  } finally { await db.query('DELETE FROM posts WHERE id=$1',[id]); }
});

async function verifyGuests(postId: string, admin: Awaited<ReturnType<typeof account>>) {
  let cookie = '';
  const path = `/api/guest/posts/${postId}/comments`;
  async function challenge() {
    const response = await fetch(origin+'/api/guest/captcha',{headers:cookie?{Cookie:cookie}:{}});
    assert.equal(response.status,200);
    assert.equal(response.headers.get('cache-control'),'no-store');
    assert.match(response.headers.get('set-cookie')!,/HttpOnly/);
    assert.match(response.headers.get('set-cookie')!,/Secure/);
    cookie = response.headers.get('set-cookie')!.split(';')[0];
    const result = await response.json() as {id:string;image:string;expiresIn:number};
    assert.equal(result.expiresIn,300);
    const image = await sharp(Buffer.from(result.image.split(',')[1],'base64')).metadata();
    assert.equal(image.format,'png'); assert.equal(image.width,210);
    // Set a known answer in this isolated DB; real challenges never return their answer.
    const answer = '234567';
    await db.query('UPDATE comment_captchas SET answer_hash=$2 WHERE id=$1',[result.id,createHash('sha256').update(result.id+answer).digest('hex')]);
    return {captchaId:result.id,captchaAnswer:answer};
  }
  const send = (suffix:string,method:string,body:unknown,originHeader=config.SITE_URL) => fetch(origin+path+suffix,{method,
    headers:{Cookie:cookie,Origin:originHeader,'Content-Type':'application/json'},body:JSON.stringify(body)});
  const data = {requestId:randomUUID(),nickname:'비회원검증',password:'guest-test-password',content:'<img src=x> 비회원 평문'};
  let code = await challenge();
  assert.equal((await send('','POST',{...data,...code},'https://evil.invalid')).status,403);
  assert.equal((await send('','POST',{...data,...code,captchaAnswer:'222222'})).status,400);
  assert.equal((await send('','POST',{...data,...code})).status,400,'Wrong answer consumes the challenge');
  code = await challenge();
  await db.query("UPDATE comment_captchas SET expires_at=now()-interval '1 second' WHERE id=$1",[code.captchaId]);
  assert.equal((await send('','POST',{...data,...code})).status,400);
  const older = await challenge(); code = await challenge();
  assert.equal((await send('','POST',{...data,...older})).status,400,'New challenge replaces old image');
  assert.equal((await send('','POST',{...data,...code})).status,201);
  assert.equal((await send('','POST',{...data,...code})).status,400,'Successful challenge cannot be reused');
  assert.equal((await send('','POST',{...data,...await challenge()})).status,201,'Same business request remains idempotent with a fresh challenge');
  assert.equal((await db.query('SELECT 1 FROM comments WHERE id=$1',[data.requestId])).rowCount,1);
  const stored = (await db.query('SELECT user_id,guest_password FROM comments WHERE id=$1',[data.requestId])).rows[0];
  assert.equal(stored.user_id,null); assert.ok(stored.guest_password !== data.password && !stored.guest_password.includes(data.password));
  const response = await (await fetch(origin+'/api/public/posts/activity-post/interactions')).json() as any;
  const guest = response.comments.find((item:any)=>item.id===data.requestId);
  assert.equal(guest.isGuest,true); assert.equal(guest.isAuthor,false); assert.equal(guest.authorName,data.nickname);
  assert.ok(!JSON.stringify(response).includes('guest_password'));
  assert.equal((await send('/'+data.requestId,'PUT',{password:'wrong-password',content:'wrong',...await challenge()})).status,403);
  assert.equal((await send('/'+data.requestId,'PUT',{password:data.password,content:'비회원 수정',...await challenge()})).status,200);
  assert.equal((await send('/'+data.requestId,'DELETE',{password:'wrong-password',...await challenge()})).status,403);
  assert.equal((await send('/'+data.requestId,'DELETE',{password:data.password,...await challenge()})).status,200);
  const moderated = {...data,requestId:randomUUID()};
  assert.equal((await send('','POST',{...moderated,...await challenge()})).status,201);
  assert.equal((await fetch(origin+`/api/posts/${postId}/comments/${moderated.requestId}`,{method:'DELETE',headers:admin.headers})).status,200);
  const tokenHash = createHash('sha256').update(cookie.slice('ggeujeok_guest='.length)).digest('hex');
  await db.query("UPDATE guest_clients SET comment_events=ARRAY(SELECT now() FROM generate_series(1,5)) WHERE token_hash=$1",[tokenHash]);
  assert.equal((await send('','POST',{...data,requestId:randomUUID(),...await challenge()})).status,429);
  await db.query("UPDATE guest_clients SET challenge_events=ARRAY(SELECT now() FROM generate_series(1,20)) WHERE token_hash=$1",[tokenHash]);
  assert.equal((await fetch(origin+'/api/guest/captcha',{headers:{Cookie:cookie}})).status,429);
}
