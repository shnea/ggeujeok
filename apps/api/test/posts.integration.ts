import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import { Database } from '../src/database/database.js';
import { Posts } from '../src/posts/posts.service.js';
import { config } from '../src/config.js';
import { Sessions } from '../src/auth/sessions.js';
import { Categories } from '../src/posts/categories.service.js';

if (config.APP_ENV !== 'test' || config.PGDATABASE !== 'ggeujeok_test') throw new Error('Integration tests require the isolated ggeujeok_test database.');
const db = new Database(), posts = new Posts(db);
const server = spawn(process.execPath, ['dist/main.js'], { env: { ...process.env, PORT: '30102' }, stdio: 'ignore' });
after(async () => { server.kill('SIGTERM'); await db.end(); });
const origin = 'http://127.0.0.1:30102';

async function ready() {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`${origin}/api/health`)).ok) return; } catch { /* Server booting. */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Test API failed to start');
}

async function account(subject: string) {
  const user = await db.query('INSERT INTO users(issuer,subject,display_name) VALUES($1,$2,$2) RETURNING id', [config.ADMIN_OIDC_ISSUER, subject]);
  let token = '';
  const response = { cookie: (_name: string, value: string, options: { secure: boolean; httpOnly: boolean }) => {
    token = value; assert.equal(options.secure, true); assert.equal(options.httpOnly, true);
  } } as Response;
  await new Sessions(db).create(response, user.rows[0].id);
  const hash = createHash('sha256').update(token).digest('hex');
  const sessionResponse = await fetch(`${origin}/api/auth/session`, { headers: { Cookie: `ggeujeok_session=${token}` } });
  const { csrfToken: csrf, user: sessionUser } = await sessionResponse.json() as { csrfToken: string; user: { isAdmin: boolean } };
  assert.equal(sessionUser.isAdmin, subject === config.ADMIN_OIDC_SUBJECT);
  return { id: user.rows[0].id, cookie: `ggeujeok_session=${token}`, csrf, hash };
}

test('draft isolation, conflicts, publication dates, private visibility and authorization', async () => {
  await ready();
  const admin = await account(config.ADMIN_OIDC_SUBJECT), user = await account('reader');
  assert.equal((await fetch(`${origin}/api/admin/posts`)).status, 401);
  assert.equal((await fetch(`${origin}/api/admin/uploads/00000000-0000-4000-8000-000000000001/complete`, { method: 'POST' })).status, 401);
  assert.equal((await fetch(`${origin}/api/admin/posts`, { headers: { Cookie: user.cookie } })).status, 403);
  assert.equal((await fetch(`${origin}/api/admin/posts`, { method: 'POST', headers: { Cookie: admin.cookie } })).status, 403);
  assert.equal((await fetch(`${origin}/api/admin/posts`, { method: 'POST', headers: { Cookie: admin.cookie, Origin: 'https://evil.invalid', 'X-CSRF-Token': admin.csrf } })).status, 403);
  const createResponse = await fetch(`${origin}/api/admin/posts`, { method: 'POST', headers: { Cookie: admin.cookie, Origin: config.SITE_URL, 'X-CSRF-Token': admin.csrf } });
  assert.equal(createResponse.status, 201);
  const { id } = await createResponse.json() as { id: string };
  const draft = await posts.edit(id);
  assert.equal((await posts.list({ q: '한글 본문' })).total, 0);
  await assert.rejects(posts.publish(id, { draftVersion: 1, baseVersion: 1, status: 'PUBLIC' }, admin.id));
  const category = (await posts.categories())[0].id;
  const data = { ...draft.data, title: '한글 테스트 제목', slug: 'integration-post', categoryId: category, tags: ['React', 'react'],
    content: { format: 'shnea-editor', version: 3, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '검색 가능한 본문' }] }] } } };
  const saved = await posts.save(id, { version: 1, data });
  await assert.rejects(posts.save(id, { version: 1, data }), { status: 409 });
  await assert.rejects(posts.publish(id, { draftVersion: 1, baseVersion: 1, status: 'PUBLIC' }, admin.id), { status: 409 });
  const published = await posts.publish(id, { draftVersion: saved.version, baseVersion: 1, status: 'PUBLIC' }, admin.id);
  const publicPost = await posts.publicPost(data.slug);
  assert.equal(publicPost.tags.length, 1);
  assert.equal((await posts.list({ q: '한글 본문' })).total, 1);
  assert.equal((await posts.list({ q: '%' })).total, 0);
  const edited = await posts.save(id, { version: published.version, data: { ...data, title: '아직 공개하지 않은 제목' } });
  assert.equal((await posts.publicPost(data.slug)).title, '한글 테스트 제목');
  const simultaneous = await Promise.allSettled([
    posts.save(id, { version: edited.version, data }), posts.save(id, { version: edited.version, data }),
  ]);
  assert.equal(simultaneous.filter(result => result.status === 'fulfilled').length, 1);
  await assert.rejects(posts.save(id, { version: edited.version + 1, data: { ...data, slug: 'changed' } }), { status: 400 });
  const hidden = await posts.publish(id, { draftVersion: edited.version + 1, baseVersion: published.baseVersion, status: 'PRIVATE' }, admin.id);
  await assert.rejects(posts.publicPost(data.slug), { status: 404 });
  assert.equal((await posts.list({ q: '한글' })).total, 0);
  await posts.publish(id, { draftVersion: hidden.version, baseVersion: hidden.baseVersion, status: 'PUBLIC' }, admin.id);
  assert.equal((await posts.publicPost(data.slug)).publishedAt.toISOString(), publicPost.publishedAt.toISOString());
  await verifyCategories(admin, user);
  await verifyTags(admin, user);
  await db.query("UPDATE sessions SET last_seen_at=now()-interval '25 hours' WHERE token_hash=$1", [admin.hash]);
  assert.equal((await fetch(`${origin}/api/admin/posts`, { headers: { Cookie: admin.cookie } })).status, 401);
  await db.query("UPDATE sessions SET last_seen_at=now(),created_at=now()-interval '8 days' WHERE token_hash=$1", [admin.hash]);
  assert.equal((await fetch(`${origin}/api/admin/posts`, { headers: { Cookie: admin.cookie } })).status, 401);
  await posts.remove(id, admin.id);
  assert.equal((await db.query('SELECT 1 FROM post_drafts WHERE post_id=$1', [id])).rowCount, 0);
  assert.equal((await db.query('SELECT 1 FROM post_tags WHERE post_id=$1', [id])).rowCount, 0);
});

async function verifyTags(admin: Awaited<ReturnType<typeof account>>, reader: Awaited<ReturnType<typeof account>>) {
  const endpoint = `${origin}/api/admin/tags`;
  const search = async (q: string): Promise<{ name: string }[]> => {
    const response = await fetch(`${endpoint}?q=${encodeURIComponent(q)}`, { headers: { Cookie: admin.cookie } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    return response.json();
  };
  assert.equal((await fetch(`${endpoint}?q=react`)).status, 401);
  assert.equal((await fetch(`${endpoint}?q=react`, { headers: { Cookie: reader.cookie } })).status, 403);
  assert.equal((await fetch(`${endpoint}?q=${'x'.repeat(81)}`, { headers: { Cookie: admin.cookie } })).status, 400);
  assert.deepEqual(await search('   '), []);
  const { id } = await posts.create(admin.id), draft = await posts.edit(id);
  const tags = ['École', '첫한글태그', '태그%_검증', 'zz-tag-exact', 'zz-tag', ...Array.from({ length: 10 }, (_, i) => `zz-tag-${i}`)];
  await posts.save(id, { version: 1, data: { ...draft.data, tags } });
  assert.deepEqual(await search(' E\u0301COLE '), [{ name: 'École' }], 'NFC/case normalization includes draft-only tags');
  assert.deepEqual(await search('한글'), [{ name: '첫한글태그' }]);
  assert.deepEqual(await search('%_'), [{ name: '태그%_검증' }], 'SQL wildcard characters must be literal');
  assert.deepEqual(await search("' OR 1=1 --"), []);
  const matches = await search('ZZ-TAG');
  assert.equal(matches.length, 8);
  assert.equal(matches[0].name, 'zz-tag', 'Exact match comes first');
  assert.deepEqual(await search('no-such-tag'), []);
  // The catalog display name wins over differently cased draft-only names.
  await db.query("INSERT INTO tags(name,normalized_name,slug) VALUES('ÉCOLE','école','tag-search-ecole')");
  assert.deepEqual(await search('école'), [{ name: 'ÉCOLE' }]);
  await posts.remove(id, admin.id);
  assert.deepEqual(await search('한글'), [], 'Deleted draft-only tags disappear');
  assert.deepEqual(await search('école'), [{ name: 'ÉCOLE' }], 'Catalog tags remain reusable');
  await db.query("DELETE FROM tags WHERE slug='tag-search-ecole'");
}

async function verifyCategories(admin: Awaited<ReturnType<typeof account>>, reader: Awaited<ReturnType<typeof account>>) {
  const endpoint = `${origin}/api/admin/categories`;
  const headers = { Cookie: admin.cookie, Origin: config.SITE_URL, 'X-CSRF-Token': admin.csrf, 'Content-Type': 'application/json' };
  const send = (path: string, method: string, body?: unknown) => fetch(`${endpoint}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  type Row = { id: string; name: string; slug: string; sortOrder: number; postCount: number };
  const list = async (): Promise<Row[]> => (await fetch(endpoint, { headers })).json();
  assert.equal((await fetch(endpoint)).status, 401);
  assert.equal((await fetch(endpoint, { headers: { Cookie: reader.cookie } })).status, 403);
  for (const [path, method] of [['', 'POST'], ['/00000000-0000-4000-8000-000000000001', 'PUT'], ['/00000000-0000-4000-8000-000000000001', 'DELETE']]) {
    assert.equal((await fetch(endpoint + path, { method, headers: { Cookie: admin.cookie } })).status, 403);
  }
  assert.equal((await send('', 'POST', { name: '잘못된 주소', slug: '../invalid', sortOrder: 0 })).status, 400);
  const input = { name: '  E\u0301criture  ', slug: 'category-test-a', sortOrder: 42 };
  const created = await send('', 'POST', input);
  assert.equal(created.status, 201);
  const a = await created.json() as Row;
  assert.equal(a.name, 'Écriture');
  assert.equal((await send('', 'POST', { ...input, name: 'éCRITURE', slug: 'different-slug' })).status, 409);
  assert.equal((await send('', 'POST', { ...input, name: '다른 이름' })).status, 409);
  const second = await send('', 'POST', { name: '두 번째 분류', slug: 'category-test-b', sortOrder: 5 });
  assert.equal(second.status, 201);
  const b = await second.json() as Row;
  assert.equal((await send(`/${b.id}`, 'PUT', { name: a.name, slug: b.slug, sortOrder: 5 })).status, 409);
  assert.equal((await send(`/${a.id}`, 'PUT', { name: '수정한 분류', slug: a.slug, sortOrder: 10 })).status, 200);
  const publicCategories = await (await fetch(`${origin}/api/public/categories`)).json() as Row[];
  assert.ok(publicCategories.findIndex(row => row.id === b.id) < publicCategories.findIndex(row => row.id === a.id));
  assert.equal((await list()).find(row => row.id === a.id)?.postCount, 0);

  const { id } = await posts.create(admin.id), draft = await posts.edit(id);
  const data = { ...draft.data, categoryId: a.id, content: { format: 'shnea-editor', version: 3,
    content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '분류 검증' }] }] } } };
  const saved = await posts.save(id, { version: 1, data });
  assert.equal((await list()).find(row => row.id === a.id)?.postCount, 1);
  assert.equal((await send(`/${a.id}`, 'DELETE')).status, 409, 'Draft-only references block deletion');
  const published = await posts.publish(id, { draftVersion: saved.version, baseVersion: 1, status: 'PUBLIC' }, admin.id);
  assert.equal((await posts.list({ category: a.slug })).items.some(row => row.id === id), true);
  assert.equal((await list()).find(row => row.id === a.id)?.postCount, 1, 'Published and draft references count as one post');
  const changed = await posts.save(id, { version: published.version, data: { ...data, categoryId: b.id } });
  for (const category of [a, b]) assert.equal((await send(`/${category.id}`, 'DELETE')).status, 409);
  const moved = await posts.publish(id, { draftVersion: changed.version, baseVersion: published.baseVersion, status: 'PRIVATE' }, admin.id);
  assert.equal((await send(`/${a.id}`, 'DELETE')).status, 200);
  assert.equal((await send(`/${a.id}`, 'DELETE')).status, 404);
  assert.equal((await send(`/${b.id}`, 'DELETE')).status, 409, 'Private posts also retain their categories');
  await assert.rejects(posts.save(id, { version: moved.version, data }), { code: '23503' });
  await posts.remove(id, admin.id);
  assert.equal((await send(`/${b.id}`, 'DELETE')).status, 200);

  const categories = new Categories(db);
  const c = await categories.save(null, { name: '동시 요청 검증', slug: 'category-race', sortOrder: 0 }, admin.id);
  const racePost = await posts.create(admin.id), raceDraft = await posts.edit(racePost.id);
  const race = await Promise.allSettled([
    posts.save(racePost.id, { version: 1, data: { ...raceDraft.data, categoryId: c.id } }),
    categories.remove(c.id, admin.id),
  ]);
  assert.equal(race.filter(result => result.status === 'fulfilled').length, 1, 'Delete/save race must not create an orphan');
  assert.equal((await db.query('SELECT 1 FROM post_drafts d LEFT JOIN categories c ON c.id=d.category_id WHERE d.category_id IS NOT NULL AND c.id IS NULL')).rowCount, 0);
  await posts.remove(racePost.id, admin.id);
  if ((await categories.list()).some(row => row.id === c.id)) await categories.remove(c.id, admin.id);
}

test('temporary OIDC session can be consumed only once', async () => {
  const sessions = new Sessions(db);
  let token = '';
  await sessions.create({ cookie: (_name: string, value: string) => { token = value; } } as Response, null, { state: 'test-state' });
  const request = { headers: { cookie: `ggeujeok_session=${token}` } } as Request;
  assert.deepEqual(await sessions.consumeLogin(request), { state: 'test-state' });
  assert.equal(await sessions.consumeLogin(request), undefined);
});

test('related ranking, feed and sitemap use only current public versions', async () => {
  await ready();
  const actor = (await db.query("INSERT INTO users(issuer,subject,display_name) VALUES('test','discovery','writer') RETURNING id")).rows[0].id;
  const categoryIds: string[] = [];
  for (const name of ['discovery-a', 'discovery-b']) categoryIds.push((await db.query('INSERT INTO categories(name,slug) VALUES($1,$1) RETURNING id', [name])).rows[0].id);
  async function create(name: string, category: string, tags: string[], status: 'PUBLIC' | 'PRIVATE' | 'DRAFT' = 'PUBLIC') {
    const { id } = await posts.create(actor), draft = await posts.edit(id);
    const saved = await posts.save(id, { version: 1, data: { ...draft.data, title: name, slug: name, categoryId: category, tags,
      content: { format: 'shnea-editor', version: 3, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '공개 본문' }] }] } } } });
    if (status !== 'DRAFT') await posts.publish(id, { draftVersion: saved.version, baseVersion: 1, status }, actor);
    await db.query("UPDATE posts SET published_at='2026-09-01T00:00:00Z' WHERE id=$1 AND status='PUBLIC'", [id]);
    return id;
  }
  try {
    const [a, b] = categoryIds;
    const source = await create('discovery-source', a, ['discovery-tag-1', 'discovery-tag-2']);
    await create('discovery-score-seven', a, ['discovery-tag-1', 'discovery-tag-2']);
    await create('discovery-score-five', a, ['discovery-tag-1']);
    await create('discovery-score-four', b, ['discovery-tag-1', 'discovery-tag-2']);
    const tie1 = await create('discovery-tie-a', a, []), tie2 = await create('discovery-tie-b', a, []);
    await create('discovery-zero', b, []);
    await create('discovery-hidden', a, ['discovery-tag-1', 'discovery-tag-2'], 'PRIVATE');
    await create('discovery-draft', a, ['discovery-tag-1', 'discovery-tag-2'], 'DRAFT');
    const ranked = await posts.related('discovery-source');
    assert.deepEqual(ranked.slice(0, 3).map(row => row.slug), ['discovery-score-seven', 'discovery-score-five', 'discovery-score-four']);
    assert.equal(ranked.length, 4);
    assert.equal(ranked[3].id, [tie1, tie2].sort().at(-1), 'Equal scores and dates use descending ID');
    await db.query("UPDATE posts SET published_at='2026-09-02T00:00:00Z' WHERE id=$1", [tie1]);
    assert.equal((await posts.related('discovery-source'))[3].id, tie1, 'Equal scores use publication date first');
    for (const rows of [await posts.feed(), await posts.sitemap()]) {
      assert.ok(rows.some(row => row.slug === 'discovery-source'));
      assert.ok(!rows.some(row => ['discovery-hidden', 'discovery-draft'].includes(row.slug)));
    }
    await assert.rejects(posts.related('discovery-hidden'), { status: 404 });
    await assert.rejects(posts.related('discovery-draft'), { status: 404 });
    const draft = await posts.edit(source);
    const saved = await posts.save(source, { version: draft.version, data: { ...draft.data, title: 'unpublished-title', summary: 'unpublished-summary' } });
    assert.equal((await posts.feed()).find(row => row.id === source)?.title, 'discovery-source');
    const reflected = await posts.publish(source, { draftVersion: saved.version, baseVersion: draft.baseVersion, status: 'PUBLIC' }, actor);
    const updated = (await posts.feed()).find(row => row.id === source);
    assert.equal(updated?.summary, 'unpublished-summary');
    assert.equal(new Date(updated?.publishedAt).toISOString(), '2026-09-01T00:00:00.000Z');
    assert.equal(new Date((await posts.sitemap()).find(row => row.slug === 'discovery-source')?.updatedAt).toISOString(), new Date(updated?.updatedAt).toISOString());
    await posts.publish(source, { draftVersion: reflected.version, baseVersion: reflected.baseVersion, status: 'PRIVATE' }, actor);
    assert.ok(!(await posts.feed()).some(row => row.id === source));
    assert.ok(!(await posts.sitemap()).some(row => row.slug === 'discovery-source'));
    assert.ok(!(await posts.related('discovery-score-seven')).some(row => row.id === source));
    await posts.remove(tie1, actor);
    assert.ok(!(await posts.sitemap()).some(row => row.slug === 'discovery-tie-a'));
    // Recent feed is bounded independently from the complete sitemap.
    await db.query(`INSERT INTO posts(slug,title,content,content_text,author_id,category_id,status,published_at)
      SELECT 'feed-bulk-'||n,'feed bulk','{}','body',$1,$2,'PUBLIC','2099-01-01'::timestamptz+n*interval '1 second'
      FROM generate_series(1,55) n`, [actor, b]);
    const feed = await posts.feed();
    assert.equal(feed.length, 50); assert.equal(feed[0].slug, 'feed-bulk-55'); assert.equal(feed[49].slug, 'feed-bulk-6');
    assert.equal((await posts.sitemap()).filter(row => row.slug.startsWith('feed-bulk-')).length, 55);
    for (const path of ['/api/public/feed', '/api/public/sitemap', '/api/public/posts/discovery-score-seven/related']) {
      const response = await fetch(origin + path);
      assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
    }
  } finally {
    await db.query('DELETE FROM posts WHERE author_id=$1', [actor]);
    await db.query('DELETE FROM categories WHERE id=ANY($1::uuid[])', [categoryIds]);
  }
});
