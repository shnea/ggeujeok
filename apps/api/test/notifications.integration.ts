import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import { Database } from '../src/database/database.js';
import { Sessions, type Session } from '../src/auth/sessions.js';
import { Notifications } from '../src/notifications/notifications.service.js';
import { config } from '../src/config.js';

if(config.APP_ENV!=='test'||config.PGDATABASE!=='ggeujeok_test')throw new Error('Notifications require isolated DB');
const db=new Database(),worker=new Notifications(db),origin='http://127.0.0.1:30105';
const server=spawn(process.execPath,['dist/main.js'],{env:{...process.env,PORT:'30105',ADMIN_OIDC_SUBJECT:'notification-admin'},stdio:'ignore'});
after(async()=>{server.kill('SIGTERM');await db.end();});
async function account(subject:string){
  const user=(await db.query("INSERT INTO users(issuer,subject,display_name,nickname) VALUES($1,$2,'PRIVATE NAME',$2) RETURNING id",[config.ADMIN_OIDC_ISSUER,subject])).rows[0];
  let token='';await new Sessions(db).create({cookie:(_name:string,value:string)=>{token=value;}} as Response,user.id);
  const cookie=`ggeujeok_session=${token}`;
  const info=await(await fetch(origin+'/api/auth/session',{headers:{Cookie:cookie}})).json() as {csrfToken:string};
  return {id:user.id,headers:{Cookie:cookie,Origin:config.SITE_URL,'X-CSRF-Token':info.csrfToken,'Content-Type':'application/json'},
    session:{userId:user.id,name:subject,nickname:subject,isAdmin:subject==='notification-admin',csrfToken:info.csrfToken,data:{}} as Session};
}
async function drain(){for(let i=0;i<400;i++)if(!await worker.processOne())return;throw new Error('Worker did not drain');}

test('activity isolation, durable notifications, retries, read snapshots, deletion, visibility and deep links',async()=>{
  for(let i=0;i<50;i++){try{if((await fetch(origin+'/api/health')).ok)break;}catch{}await new Promise(resolve=>setTimeout(resolve,100));}
  const admin=await account('notification-admin'),a=await account('notification-a'),b=await account('notification-b');
  const category=(await db.query('SELECT id FROM categories ORDER BY sort_order,id LIMIT 1')).rows[0].id;
  const post=(await db.query("INSERT INTO posts(slug,title,content,author_id,category_id,status,published_at) VALUES('notification-post','알림 검증','{}',$1,$2,'PUBLIC',now()) RETURNING id",[admin.id,category])).rows[0].id;
  const base=`/api/posts/${post}/comments`;
  const send=(user:typeof a,path:string,method='GET',body?:unknown)=>fetch(origin+path,{method,headers:user.headers,body:body===undefined?undefined:JSON.stringify(body)});
  const json=async(user:typeof a,path:string)=>{const r=await send(user,path);assert.equal(r.status,200);return await r.json() as any;};
  const root=randomUUID(),reply=randomUUID(),second=randomUUID();
  try{
    for(const path of ['/api/me/comments','/api/me/likes','/api/me/notifications','/api/me/notifications/unread-count'])assert.equal((await fetch(origin+path)).status,401);
    assert.equal((await send(a,base,'POST',{requestId:root,content:'원댓글'})).status,201);
    assert.equal((await db.query('SELECT 1 FROM notifications WHERE comment_id=$1',[root])).rowCount,0,'Delivery must wait for worker');
    assert.equal((await db.query('SELECT 1 FROM notification_events WHERE comment_id=$1',[root])).rowCount,1);
    assert.equal((await send(b,base,'POST',{requestId:reply,content:'대상 회원에게 답글',parentId:root,replyToId:root})).status,201);
    assert.equal((await send(b,base,'POST',{requestId:reply,content:'대상 회원에게 답글',parentId:root,replyToId:root})).status,201);
    await Promise.all([drain(),drain()]);
    const aList=await json(a,'/api/me/notifications'),adminList=await json(admin,'/api/me/notifications');
    assert.equal(aList.total,1);assert.equal(aList.items[0].kind,'REPLY');assert.equal(aList.items[0].actorName,'notification-b');
    await db.query('UPDATE users SET custom_nickname=$2 WHERE id=$1',[b.id,'끄적 알림 이름']);
    assert.equal((await worker.list(a.session,1)).items[0].actorName,'끄적 알림 이름');
    await db.query('UPDATE users SET custom_nickname=NULL WHERE id=$1',[b.id]);
    assert.equal(adminList.total,2);assert.equal((await json(b,'/api/me/notifications')).total,0);
    assert.ok(!JSON.stringify(aList).includes('PRIVATE NAME'));
    const notice=aList.items[0].id;
    assert.equal((await send(b,`/api/me/notifications/${notice}/read`,'POST')).status,404);
    assert.equal((await send(b,`/api/me/notifications/${notice}/destination`)).status,404);
    assert.equal((await fetch(origin+`/api/me/notifications/${notice}/read`,{method:'POST',headers:{Cookie:a.headers.Cookie}})).status,403);
    assert.equal((await json(a,`/api/me/notifications/${notice}/destination`)).href,`/posts/notification-post#comment-${reply}`);
    assert.equal((await send(a,`/api/me/notifications/${notice}/read`,'POST')).status,201);
    assert.equal((await send(a,`/api/me/notifications/${notice}/read`,'POST')).status,201);
    assert.equal((await json(a,'/api/me/notifications/unread-count')).count,0);
    await db.query('UPDATE notification_events SET processed_at=NULL WHERE comment_id=$1',[reply]);await drain();
    assert.equal((await json(a,'/api/me/notifications')).total,1,'Retry must not duplicate delivery');
    assert.equal((await send(a,base,'POST',{requestId:second,content:'자기 답글',parentId:root,replyToId:root})).status,201);await drain();
    assert.equal((await json(a,'/api/me/notifications')).total,1,'Self reply must not notify self');
    assert.equal((await json(a,'/api/me/comments')).total,2);assert.equal((await json(b,'/api/me/comments')).items[0].id,reply);
    await send(a,`/api/posts/${post}/like`,'PUT');assert.equal((await json(a,'/api/me/likes')).total,1);assert.equal((await json(b,'/api/me/likes')).total,0);

    const authorRoot=randomUUID(),authorReply=randomUUID();
    await send(admin,base,'POST',{requestId:authorRoot,content:'작성자 자신의 댓글'});
    assert.equal((await db.query('SELECT 1 FROM notification_events WHERE comment_id=$1',[authorRoot])).rowCount,0);
    await send(b,base,'POST',{requestId:authorReply,content:'작성자에게 답글',parentId:authorRoot,replyToId:authorRoot});
    const deduped=(await db.query('SELECT recipient_id,kind FROM notification_events WHERE comment_id=$1',[authorReply])).rows;
    assert.deepEqual(deduped,[{recipient_id:admin.id,kind:'REPLY'}]);
    const guest=randomUUID();
    await db.transaction(async tx=>{
      await tx.query("INSERT INTO comments(id,post_id,guest_name,guest_password,content,request_hash) VALUES($1,$2,'비회원','test-only','비회원 알림','fixture')",[guest,post]);
      await worker.enqueue(tx,guest);
    });
    assert.deepEqual((await db.query('SELECT recipient_id FROM notification_events WHERE comment_id=$1',[guest])).rows,[{recipient_id:admin.id}]);
    await drain();

    // A trigger forces delivery failure without rejecting the successful comment write.
    const failed=randomUUID();
    await db.query(`CREATE FUNCTION test_notification_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.comment_id='${failed}'::uuid THEN RAISE EXCEPTION 'test failure' USING ERRCODE='23514'; END IF; RETURN NEW; END $$`);
    await db.query('CREATE TRIGGER test_notification_failure BEFORE INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION test_notification_failure()');
    assert.equal((await send(b,base,'POST',{requestId:failed,content:'알림 실패와 무관한 댓글'})).status,201);await drain();
    assert.equal((await db.query('SELECT attempts FROM notification_events WHERE comment_id=$1',[failed])).rows[0].attempts,1);
    assert.equal((await db.query("SELECT 1 FROM comments WHERE id=$1 AND status='VISIBLE'",[failed])).rowCount,1);
    for(let i=1;i<5;i++){await db.query('UPDATE notification_events SET next_attempt_at=now() WHERE comment_id=$1',[failed]);await drain();}
    assert.equal((await db.query('SELECT attempts FROM notification_events WHERE comment_id=$1',[failed])).rows[0].attempts,5);
    await db.query('DROP TRIGGER test_notification_failure ON notifications');await db.query('DROP FUNCTION test_notification_failure()');
    await db.query('UPDATE notification_events SET attempts=0,next_attempt_at=now() WHERE comment_id=$1',[failed]);await drain();
    assert.equal((await db.query('SELECT 1 FROM notifications WHERE comment_id=$1',[failed])).rowCount,1);

    // Hold an old notification lock while a genuinely new delivery arrives after read-all starts.
    const old=(await db.query('SELECT id FROM notifications WHERE recipient_id=$1 AND read_at IS NULL LIMIT 1',[admin.id])).rows[0].id;
    const lock=await db.connect();await lock.query('BEGIN');await lock.query('SELECT 1 FROM notifications WHERE id=$1 FOR UPDATE',[old]);
    const reading=worker.readAll(admin.session);
    try{
      let waiting=false;
      for(let i=0;i<100;i++){const r=await db.query("SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE 'UPDATE notifications SET read_at=%'");if(r.rowCount){waiting=true;break;}await new Promise(resolve=>setTimeout(resolve,10));}
      assert.ok(waiting,'Read-all must have taken its snapshot');
      const fresh=(await db.query("INSERT INTO comments(id,post_id,user_id,content,request_hash) VALUES(gen_random_uuid(),$1,$2,'새 도착','fixture') RETURNING id",[post,b.id])).rows[0].id;
      await db.query("INSERT INTO notifications(comment_id,recipient_id,kind) VALUES($1,$2,'COMMENT')",[fresh,admin.id]);
      await lock.query('COMMIT');await reading;
      assert.equal((await db.query('SELECT read_at FROM notifications WHERE comment_id=$1',[fresh])).rows[0].read_at,null);
    }finally{await lock.query('ROLLBACK');lock.release();}

    await db.query("UPDATE posts SET status='PRIVATE' WHERE id=$1",[post]);
    assert.equal((await json(a,'/api/me/comments')).total,0);assert.equal((await json(a,'/api/me/likes')).total,0);assert.equal((await json(a,'/api/me/notifications')).total,0);
    assert.equal((await send(a,`/api/me/notifications/${notice}/destination`)).status,404);
    const privateNotice=(await json(admin,'/api/me/notifications')).items[0];
    assert.match((await json(admin,`/api/me/notifications/${privateNotice.id}/destination`)).href,/^\/admin\/comments\?comment=/);
    const focused=await json(admin,`/api/admin/comments?comment=${privateNotice.commentId}`);assert.equal(focused.total,1);assert.equal(focused.items[0].id,privateNotice.commentId);
    assert.equal((await send(a,`/api/admin/comments?comment=${reply}`)).status,403);
    await db.query("UPDATE posts SET status='PUBLIC' WHERE id=$1",[post]);
    assert.equal((await send(b,base+'/'+reply,'DELETE')).status,200);
    assert.equal((await db.query('SELECT 1 FROM notifications WHERE comment_id=$1',[reply])).rowCount,0);
    assert.equal((await db.query('SELECT 1 FROM notification_events WHERE comment_id=$1',[reply])).rowCount,0);
    const pending=randomUUID();assert.equal((await send(b,base,'POST',{requestId:pending,content:'전달 전에 삭제'})).status,201);
    await send(b,base+'/'+pending,'DELETE');await drain();assert.equal((await db.query('SELECT 1 FROM notifications WHERE comment_id=$1',[pending])).rowCount,0);

    await db.query("UPDATE notifications SET created_at=now()-interval '91 days' WHERE recipient_id=$1",[admin.id]);
    await db.query("UPDATE notification_events SET processed_at=NULL,attempts=5,created_at=now()-interval '91 days' WHERE comment_id=$1",[guest]);
    assert.equal((await json(admin,'/api/me/notifications')).total,0);await worker.prune();
    assert.equal((await db.query('SELECT 1 FROM notifications WHERE recipient_id=$1',[admin.id])).rowCount,0);
    assert.equal((await db.query('SELECT 1 FROM notification_events WHERE comment_id=$1',[guest])).rowCount,1,'Unresolved failures must remain for investigation');
    await db.query(`INSERT INTO comments(id,post_id,user_id,content,request_hash,created_at)
      SELECT gen_random_uuid(),$1,$2,'페이지 댓글 '||n,'fixture','2100-01-01'::timestamptz+n*interval '1 second' FROM generate_series(1,22)n`,[post,a.id]);
    const first=await json(a,'/api/me/comments'),next=await json(a,'/api/me/comments?page=2');
    assert.equal(first.items.length,20);assert.equal(new Set([...first.items,...next.items].map(item=>item.id)).size,24);
    const lastRoot=(await db.query('SELECT id FROM comments WHERE post_id=$1 AND parent_id IS NULL ORDER BY created_at DESC,id DESC LIMIT 1',[post])).rows[0].id;
    await db.query(`INSERT INTO comments(id,post_id,user_id,parent_id,content,request_hash,created_at)
      SELECT gen_random_uuid(),$1,$2,$3,'페이지 답글 '||n,'fixture','2101-01-01'::timestamptz+n*interval '1 second' FROM generate_series(1,22)n`,[post,a.id,lastRoot]);
    const lastReply=(await db.query('SELECT id FROM comments WHERE parent_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1',[lastRoot])).rows[0].id;
    const located=await(await fetch(origin+`/api/public/posts/notification-post/comments/${lastReply}/location`)).json() as any;
    assert.equal(located.page,2);assert.equal(located.replyPage,2);assert.equal(located.parentId,lastRoot);
    assert.equal((await fetch(origin+`/api/public/posts/notification-post/comments/${reply}/location`)).status,404);
  }finally{
    await db.query('DROP TRIGGER IF EXISTS test_notification_failure ON notifications');await db.query('DROP FUNCTION IF EXISTS test_notification_failure()');
    await Promise.all([drain(),db.query('DELETE FROM posts WHERE id=$1',[post])]);
  }
});
