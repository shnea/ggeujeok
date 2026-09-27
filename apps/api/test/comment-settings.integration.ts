import 'reflect-metadata';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Database } from '../src/database/database.js';
import { config } from '../src/config.js';
import { Posts } from '../src/posts/posts.service.js';
import { Activity } from '../src/activity/activity.service.js';
import { Captchas } from '../src/activity/captcha.service.js';
import { Notifications } from '../src/notifications/notifications.service.js';

if (config.APP_ENV !== 'test' || config.PGDATABASE !== 'ggeujeok_test') throw Error('Requires isolated test DB');
const db = new Database(), posts = new Posts(db), activity = new Activity(db, new Captchas(db), new Notifications(db));
after(() => db.end());
test('published comment setting blocks member/guest roots and replies while preserving reads, edits and likes', async () => {
  const user = (await db.query("INSERT INTO users(issuer,subject,display_name,nickname) VALUES('test','comment-setting','reader','reader') RETURNING id")).rows[0].id;
  const session = {userId:user,name:'reader',nickname:'reader',isAdmin:true,csrfToken:'',data:{}};
  const {id} = await posts.create(user);
  const draft = await posts.edit(id);
  const data = {...draft.data,categoryId:(await posts.categories())[0].id,content:{format:'shnea-editor',version:3,content:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Comment settings test'}]}]}}};
  try {
    let saved = await posts.save(id,{version:draft.version,data});
    let published = await posts.publish(id,{draftVersion:saved.version,baseVersion:draft.baseVersion,status:'PUBLIC'},user);
    const root = await activity.create(id,session,{requestId:randomUUID(),content:'Existing comment'});
    saved = await posts.save(id,{version:published.version,data:{...data,commentsEnabled:false}});
    assert.equal((await activity.read(data.slug,null,1)).commentsEnabled,true,'Draft does not affect public comments');
    published = await posts.publish(id,{draftVersion:saved.version,baseVersion:published.baseVersion,status:'PUBLIC'},user);
    const before = await activity.read(data.slug,null,1);
    assert.equal(before.commentsEnabled,false);assert.equal(before.commentCount,1);
    for(const target of [{},{parentId:root.id,replyToId:root.id}]) {
      await assert.rejects(activity.create(id,session,{requestId:randomUUID(),content:'Blocked',...target}),{status:403});
      await assert.rejects(activity.guestCreate(id,'unused-client',{requestId:randomUUID(),nickname:'guest',password:'long-password',content:'Blocked guest',...target}),{status:403});
    }
    assert.equal((await activity.read(data.slug,null,1)).commentCount,1);
    await activity.edit(id,root.id,session,{content:'Owner can still edit'});
    assert.equal((await activity.like(id,session,true)).liked,true);
    saved = await posts.save(id,{version:published.version,data:{...data,commentsEnabled:true}});
    await posts.publish(id,{draftVersion:saved.version,baseVersion:published.baseVersion,status:'PUBLIC'},user);
    await activity.create(id,session,{requestId:randomUUID(),content:'Reopened reply',parentId:root.id,replyToId:root.id});
    assert.equal((await activity.read(data.slug,null,1)).commentCount,2);
  } finally { await db.query('DELETE FROM posts WHERE id=$1',[id]);await db.query('DELETE FROM users WHERE id=$1',[user]); }
});
