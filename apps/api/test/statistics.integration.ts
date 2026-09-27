import 'reflect-metadata';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { Database } from '../src/database/database.js';
import { config } from '../src/config.js';
import { Visits, visitDay } from '../src/statistics/visits.service.js';
import { Posts } from '../src/posts/posts.service.js';

if (config.APP_ENV !== 'test' || config.PGDATABASE !== 'ggeujeok_test') throw Error('Requires isolated test DB');
const db = new Database(), visits = new Visits(db), posts = new Posts(db);
after(() => db.end());

test('visits deduplicate concurrent tabs, count daily browsers, reject private posts and retain aggregates', async () => {
  const user = (await db.query("INSERT INTO users(issuer,subject,display_name) VALUES('test',$1,'statistics') RETURNING id", [randomUUID()])).rows[0].id;
  const ids: string[] = [];
  const visitor = createHash('sha256').update(randomUUID()).digest('hex');
  const now = new Date(`${visitDay()}T10:00:00+09:00`);
  const later = new Date(now.getTime() + 30 * 60000);
  try {
    for (let index = 0; index < 2; index++) {
      const { id } = await posts.create(user); ids.push(id);
      await db.query("UPDATE posts SET status='PUBLIC',published_at=now(),category_id=(SELECT id FROM categories ORDER BY sort_order,id LIMIT 1) WHERE id=$1", [id]);
    }
    const concurrent = await Promise.all(Array.from({ length: 8 }, () => visits.record(ids[0], visitor, 'example.com', now)));
    assert.equal(concurrent.filter(Boolean).length, 1);
    assert.equal(await visits.record(ids[1], visitor, '', now), true, 'Another post is a new view, same daily browser');
    assert.equal(await visits.record(ids[0], visitor, '', new Date(later.getTime() - 1)), false);
    assert.equal(await visits.record(ids[0], visitor, '', later), true, 'Exactly 30 minutes can count');
    let report = await visits.report(7);
    assert.equal(report.daily.at(-1)?.views, 3);
    assert.equal(report.daily.at(-1)?.visitors, 1);
    assert.equal(report.totalViews, 3);
    assert.equal(report.daily.length, 7);
    assert.equal(report.popular[0].views, 2);
    assert.equal(JSON.stringify(report).includes(visitor), false, 'Do not return visitor hashes');
    await db.query("UPDATE posts SET status='PRIVATE' WHERE id=$1", [ids[0]]);
    assert.equal(await visits.record(ids[0], 'b'.repeat(64), '', later), false);
    assert.equal(await visits.record(randomUUID(), visitor, '', later), false);
    assert.equal(visitDay(new Date('2026-09-28T14:59:59Z')), '2026-09-28');
    assert.equal(visitDay(new Date('2026-09-28T15:00:00Z')), '2026-09-29');

    await db.query("UPDATE visit_events SET visited_at=now()-interval '31 days' WHERE visitor_hash=$1", [visitor]);
    await db.query("INSERT INTO visit_days(day,views,visitors) VALUES(current_date-interval '14 months',10,4)");
    await db.query("INSERT INTO post_visit_days(day,post_id,views) VALUES(current_date-interval '14 months',$1,10)", [ids[0]]);
    await db.query("INSERT INTO referrer_visit_days(day,host,views) VALUES(current_date-interval '14 months','old.example',10)");
    await visits.prune();
    report = await visits.report(7);
    assert.equal(report.recent.length, 0);
    assert.equal(report.totalViews, 3, 'Raw retention does not reset lifetime total');
    assert.equal(report.daily.at(-1)?.visitors, 1, 'Daily aggregates survive raw retention');
    for (const table of ['visit_days', 'post_visit_days', 'referrer_visit_days']) {
      assert.equal((await db.query(`SELECT 1 FROM ${table} WHERE day<current_date-interval '13 months'`)).rowCount, 0);
    }
  } finally {
    await db.query('DELETE FROM posts WHERE id=ANY($1::uuid[])', [ids]);
    await db.query('DELETE FROM users WHERE id=$1', [user]);
    await db.query('DELETE FROM visit_days');
    await db.query('DELETE FROM referrer_visit_days');
  }
});
