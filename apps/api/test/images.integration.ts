import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { Database } from '../src/database/database.js';
import { Posts } from '../src/posts/posts.service.js';
import { Images } from '../src/files/images.service.js';
import { PlatformFiles } from '../src/files/platform-files.js';
import { config } from '../src/config.js';
import type { Session } from '../src/auth/sessions.js';

if (config.APP_ENV !== 'test' || config.PGDATABASE !== 'ggeujeok_test') throw new Error('Images tests require the isolated test database.');
const db = new Database(), posts = new Posts(db);
after(() => db.end());
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

class FileServer extends PlatformFiles {
  bytes = Buffer.alloc(0);
  fileId = randomUUID();
  uploadId = randomUUID();
  size = 0;
  loseChunkResponse = true;
  state = 'READY';
  thumbnailUrl: string | null = '/api/v1/files/test/content/thumbnail?token=scoped-ticket';
  previewUrl: string | null = '/api/v1/files/test/content/preview?token=scoped-ticket';
  tickets = 0;
  ticketError: Error | null = null;
  viewTicket() {
    const path = `/api/v1/files/${this.fileId}`;
    return { fileId: this.fileId, kind: 'IMAGE', state: this.state, mediaType: 'image/png', errorCode: null,
      thumbnailUrl: this.thumbnailUrl, previewUrl: this.previewUrl,
      originalUrl: `${path}/content/original?token=scoped-ticket`, viewerUrl: `${path}/view?token=scoped-ticket`,
      downloadUrl: `${path}/content/download?token=scoped-ticket`, expiresAt: '2030-01-01T00:00:00Z',
      extensionField: { preserved: true } };
  }
  contentType = 'image/webp';
  paths: string[] = [];
  override async checkEnvironment() {}
  override async json<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    if (path.endsWith('/view-ticket')) {
      assert.equal(path, `/api/v1/files/${this.fileId}/view-ticket`);
      assert.equal(method, 'POST'); assert.equal(body, undefined);
      this.tickets++;
      if (this.ticketError) throw this.ticketError;
      return this.viewTicket() as T;
    }
    if (method === 'POST' && path.endsWith('/uploads')) {
      const input = body as { size: number; visibility: string; retentionCode: string };
      assert.equal(input.visibility, 'PRIVATE'); assert.equal(input.retentionCode, '영구');
      this.size = input.size;
    }
    if (path.endsWith('/complete')) return { fileId: this.fileId, size: this.size, sha256: hash(this.bytes), visibility: 'PRIVATE', retentionCode: '영구' } as T;
    return { uploadId: this.uploadId, state: 'UPLOADING', size: this.size, receivedBytes: this.bytes.length, maxChunkBytes: 8388608, fileId: null } as T;
  }
  override async request(path: string, init: RequestInit = {}) {
    this.paths.push(path);
    if (path.includes('/content/')) return new Response(new Uint8Array(this.bytes), { headers: { 'Content-Type': this.contentType } });
    assert.equal(Number(new Headers(init.headers).get('Upload-Offset')), this.bytes.length);
    const chunk = Buffer.from(init.body as Uint8Array);
    assert.equal(new Headers(init.headers).get('X-Chunk-SHA256'), hash(chunk));
    this.bytes = Buffer.concat([this.bytes, chunk]);
    if (this.loseChunkResponse) { this.loseChunkResponse = false; throw new Error('Simulated lost response after persistence'); }
    return Response.json({ receivedBytes: this.bytes.length });
  }
}

test('resumable images, ownership, draft isolation and public/private/deletion access', async () => {
  const owner = (await db.query('INSERT INTO users(issuer,subject,display_name) VALUES($1,$2,$2) RETURNING id', ['https://images.test.invalid', randomUUID()])).rows[0].id;
  const session: Session = { userId: owner, name: 'test', isAdmin: true, csrfToken: '', data: {} };
  const { id: postId } = await posts.create(owner);
  const platform = new FileServer(), images = new Images(db, platform);
  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#118833' } }).png().toBuffer();
  const requestId = randomUUID(), input = { requestId, name: '테스트.png', size: png.length, sha256: hash(png) };
  assert.equal((await images.start(postId, owner, input)).received, 0);
  await assert.rejects(images.start(postId, owner, { ...input, name: 'other.png' }), { status: 409 });
  const split = Math.floor(png.length / 2);
  await images.chunk(requestId, owner, 0, png.subarray(0, split));
  await assert.rejects(images.chunk(requestId, owner, 0, png.subarray(0, split)), { status: 409 });
  assert.equal((await images.start(postId, owner, input)).received, split);
  await images.chunk(requestId, owner, split, png.subarray(split));
  assert.deepEqual(await readFile(`${config.UPLOAD_DIRECTORY}/${requestId}.upload`), png);
  await assert.rejects(images.complete(requestId, owner), /Simulated lost response/);
  const saved = await images.complete(requestId, owner);
  assert.deepEqual(platform.bytes, png);
  assert.equal((await images.complete(requestId, owner)).fileId, saved.fileId);
  await assert.rejects(readFile(`${config.UPLOAD_DIRECTORY}/${requestId}.upload`), { code: 'ENOENT' });
  await assert.rejects(images.accessible(saved.fileId!, null), { status: 404 });
  await assert.rejects(images.accessible(saved.fileId!, { ...session, isAdmin: false }), { status: 404 });
  await assert.rejects(images.accessible(saved.fileId!, { ...session, userId: randomUUID() }), { status: 404 });
  for (const denied of [null, { ...session, isAdmin: false }, { ...session, userId: randomUUID() }]) {
    await assert.rejects(images.resolve(saved.fileId!, denied), { status: 404 });
  }
  assert.equal(platform.tickets, 0, 'Do not issue a ticket before access is authorized');
  assert.deepEqual(await images.resolve(saved.fileId!, session), platform.viewTicket());
  platform.ticketError = new Error('Ticket service unavailable');
  await assert.rejects(images.resolve(saved.fileId!, session), platform.ticketError);
  platform.ticketError = null;
  for (const variant of ['thumbnail', 'preview', 'original', 'download']) {
    const result = await images.content(saved.fileId!, session, AbortSignal.timeout(1000), variant);
    assert.equal(platform.paths.at(-1), `/api/v1/files/${saved.fileId}/content/${variant}`);
    assert.equal(result.mediaType, ['thumbnail', 'preview'].includes(variant) ? 'image/webp' : 'image/png');
    await result.response.body?.cancel();
    await assert.rejects(images.content(saved.fileId!, null, AbortSignal.timeout(1000), variant), { status: 404 });
  }
  platform.contentType = 'text/html';
  await assert.rejects(images.content(saved.fileId!, session, AbortSignal.timeout(1000), 'thumbnail'), { status: 502 });
  await assert.rejects(images.content(saved.fileId!, session, AbortSignal.timeout(1000), '../original'));
  platform.contentType = 'image/webp';
  platform.state = 'PROCESSING'; platform.thumbnailUrl = platform.previewUrl = null;
  const processing = await images.resolve(saved.fileId!, session);
  assert.deepEqual(processing, platform.viewTicket());
  assert.equal(processing.state, 'PROCESSING');
  assert.equal(processing.thumbnailUrl, null); assert.equal(processing.previewUrl, null);
  platform.state = 'READY'; platform.thumbnailUrl = 'https://platform.invalid/thumbnail';
  assert.deepEqual(await images.resolve(saved.fileId!, session), platform.viewTicket());
  const draft = await posts.edit(postId);
  const document = (scope: string, fileId: string) => ({ format: 'shnea-editor', version: 3, content: { type: 'doc', content: [
    { type: 'attachment', attrs: { id: randomUUID(), scope, fileId, kind: 'image', name: input.name, size: input.size } },
  ] } });
  const data = { ...draft.data, categoryId: (await posts.categories())[0].id, content: document(postId, saved.fileId!) };
  await assert.rejects(posts.save(postId, { version: 1, data: { ...data, content: document(randomUUID(), saved.fileId!) } }), { status: 400 });
  await assert.rejects(posts.save(postId, { version: 1, data: { ...data, content: document(postId, randomUUID()) } }), { status: 400 });
  const pending = await posts.save(postId, { version: 1, data: { ...data, content: document(postId, '') } });
  await assert.rejects(posts.publish(postId, { draftVersion: pending.version, baseVersion: 1, status: 'PUBLIC' }, owner), { status: 400 });
  const ready = await posts.save(postId, { version: pending.version, data });
  await assert.rejects(images.accessible(saved.fileId!, null), { status: 404 });
  const published = await posts.publish(postId, { draftVersion: ready.version, baseVersion: 1, status: 'PUBLIC' }, owner);
  await images.accessible(saved.fileId!, null);
  assert.deepEqual(await images.resolve(saved.fileId!, null), platform.viewTicket());
  const withoutImage = { ...data, content: { ...data.content, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '본문' }] }] } } };
  const revised = await posts.save(postId, { version: published.version, data: withoutImage });
  await images.accessible(saved.fileId!, null); // Editing does not change the published references.
  const applied = await posts.publish(postId, { draftVersion: revised.version, baseVersion: published.baseVersion, status: 'PUBLIC' }, owner);
  await assert.rejects(images.accessible(saved.fileId!, null), { status: 404 });
  const restored = await posts.save(postId, { version: applied.version, data });
  await posts.publish(postId, { draftVersion: restored.version, baseVersion: applied.baseVersion, status: 'PRIVATE' }, owner);
  await assert.rejects(images.accessible(saved.fileId!, null), { status: 404 });
  await images.accessible(saved.fileId!, session);
  const issued = platform.tickets;
  await assert.rejects(images.resolve(saved.fileId!, null), { status: 404 });
  assert.equal(platform.tickets, issued, 'A private post cannot issue new anonymous tickets');
  await posts.remove(postId, owner);
  await assert.rejects(images.accessible(saved.fileId!, session), { status: 404 });
  await assert.rejects(images.resolve(saved.fileId!, session), { status: 404 });
  assert.equal(platform.tickets, issued);
});

test('image bytes must match the hash and supported format', async () => {
  const owner = (await db.query('INSERT INTO users(issuer,subject,display_name) VALUES($1,$2,$2) RETURNING id', ['https://images.test.invalid', randomUUID()])).rows[0].id;
  const { id: postId } = await posts.create(owner);
  const images = new Images(db, new FileServer());
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2"/></svg>');
  for (const sha256 of ['0'.repeat(64), hash(svg)]) {
    const requestId = randomUUID();
    await images.start(postId, owner, { requestId, name: 'pretend.png', size: svg.length, sha256 });
    await images.chunk(requestId, owner, 0, svg);
    await assert.rejects(images.complete(requestId, owner), { status: 400 });
  }
  await posts.remove(postId, owner);
});

test('cover selection, automatic fallback, draft isolation and file access follow publication', async () => {
  const owner = (await db.query('INSERT INTO users(issuer,subject,display_name) VALUES($1,$2,$2) RETURNING id', ['https://covers.test.invalid', randomUUID()])).rows[0].id;
  const session: Session = { userId: owner, name: 'test', isAdmin: true, csrfToken: '', data: {} };
  const { id } = await posts.create(owner), other = await posts.create(owner);
  const png = await sharp({ create: { width: 16, height: 8, channels: 3, background: '#118833' } }).png().toBuffer();
  async function upload(postId: string) {
    const platform = new FileServer(); platform.loseChunkResponse = false;
    const images = new Images(db, platform), requestId = randomUUID();
    await images.start(postId, owner, { requestId, name: 'cover.png', size: png.length, sha256: hash(png) });
    await images.chunk(requestId, owner, 0, png);
    return (await images.complete(requestId, owner)).fileId!;
  }
  const a = await upload(id), b = await upload(id), foreign = await upload(other.id);
  const images = new Images(db, new FileServer()), draft = await posts.edit(id);
  const image = (fileId: string) => ({ type: 'attachment', attrs: { id: randomUUID(), scope: id, fileId, kind: 'image', name: 'cover.png', size: png.length } });
  const data = { ...draft.data, title: '대표 이미지 검증', categoryId: (await posts.categories())[0].id,
    content: { format: 'shnea-editor', version: 3, content: { type: 'doc', content: [
      { type: 'mediaRow', attrs: { id: randomUUID() }, content: [image(a)] },
      { type: 'paragraph', content: [{ type: 'text', text: '대표 이미지 본문' }] },
    ] } } };
  for (const thumbnailId of [randomUUID(), foreign]) await assert.rejects(posts.save(id, { version: 1, data: { ...data, thumbnailId } }), { status: 400 });
  const saved = await posts.save(id, { version: 1, data });
  let state = await posts.publish(id, { draftVersion: saved.version, baseVersion: 1, status: 'PUBLIC' }, owner);
  assert.equal((await posts.publicPost(data.slug)).thumbnailId, a);
  assert.equal(await posts.publicImage(data.slug), a);
  assert.equal((await posts.list({ q: '대표 이미지 검증' })).items.find(row => row.id === id)?.thumbnailId, a);

  const chosen = await posts.save(id, { version: state.version, data: { ...data, thumbnailId: b } });
  assert.equal(await posts.publicImage(data.slug), a, 'Draft cover must not change public metadata');
  await assert.rejects(images.accessible(b, null), { status: 404 });
  await images.accessible(b, session);
  state = await posts.publish(id, { draftVersion: chosen.version, baseVersion: state.baseVersion, status: 'PUBLIC' }, owner);
  assert.equal(await posts.publicImage(data.slug), b);
  await images.accessible(b, null);

  const textOnly = { ...data, content: { ...data.content, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '이미지 없는 본문' }] }] } } };
  const keep = await posts.save(id, { version: state.version, data: { ...textOnly, thumbnailId: b } });
  state = await posts.publish(id, { draftVersion: keep.version, baseVersion: state.baseVersion, status: 'PUBLIC' }, owner);
  await images.accessible(b, null); // A separate cover remains referenced without a body block.
  await assert.rejects(images.accessible(a, null), { status: 404 });
  const reset = await posts.save(id, { version: state.version, data: { ...textOnly, thumbnailId: null } });
  state = await posts.publish(id, { draftVersion: reset.version, baseVersion: state.baseVersion, status: 'PUBLIC' }, owner);
  assert.equal((await posts.publicPost(data.slug)).thumbnailId, null);
  await assert.rejects(posts.publicImage(data.slug), { status: 404 });
  await assert.rejects(images.accessible(b, null), { status: 404 });

  const empty = await posts.save(id, { version: state.version, data: { ...data, thumbnailId: b, content: { ...data.content, content: { type: 'doc', content: [{ type: 'paragraph' }] } } } });
  await assert.rejects(posts.publish(id, { draftVersion: empty.version, baseVersion: state.baseVersion, status: 'PUBLIC' }, owner), { status: 400 });
  const hidden = await posts.save(id, { version: empty.version, data: { ...data, thumbnailId: b } });
  await posts.publish(id, { draftVersion: hidden.version, baseVersion: state.baseVersion, status: 'PRIVATE' }, owner);
  await assert.rejects(posts.publicImage(data.slug), { status: 404 });
  await assert.rejects(images.accessible(b, null), { status: 404 });
  await posts.remove(id, owner); await posts.remove(other.id, owner);
  await assert.rejects(posts.publicImage(data.slug), { status: 404 });
  await assert.rejects(images.accessible(b, session), { status: 404 });
});
