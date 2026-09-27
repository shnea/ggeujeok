import 'reflect-metadata';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { Database } from '../src/database/database.js';
import { config } from '../src/config.js';
import { Posts } from '../src/posts/posts.service.js';
import { Images } from '../src/files/images.service.js';
import { FileCleanup } from '../src/files/cleanup.js';
import { PlatformFiles, type PlatformUpload } from '../src/files/platform-files.js';

if (config.APP_ENV !== 'test' || config.PGDATABASE !== 'ggeujeok_test') throw Error('Requires isolated test DB');
const db = new Database(), posts = new Posts(db);
after(() => db.end());
class RemoteFiles extends PlatformFiles {
  removed: string[] = [];
  failingFile = '';
  remoteFile = randomUUID();
  remoteUpload = randomUUID();
  override async checkEnvironment() {}
  override async remove(path: string) {
    if (path.endsWith(this.failingFile) && this.failingFile) throw Error('Temporary upstream failure');
    this.removed.push(path);
  }
  override async json<T>(): Promise<T> {
    return { uploadId: this.remoteUpload, fileId: this.remoteFile, state: 'READY', size: 10 } as PlatformUpload as T;
  }
}
test('cleanup protects references and grace periods, reconciles uncertain uploads and retries tombstones safely', async () => {
  const owner = (await db.query("INSERT INTO users(issuer,subject,display_name) VALUES('cleanup',$1,'owner') RETURNING id", [randomUUID()])).rows[0].id;
  const { id: postId } = await posts.create(owner);
  const remote = new RemoteFiles(), cleanup = new FileCleanup(db, remote), images = new Images(db, remote);
  const created: string[] = [];
  const hash = createHash('sha256').update(config.PLATFORM_API_KEY).digest('hex');
  async function upload(fileId: string | null, days: number | null, received = 10, credential = hash) {
    const id = randomUUID(); created.push(id);
    await db.query(`INSERT INTO image_uploads(id,post_id,owner_id,project_id,environment_id,credential_hash,original_name,size,sha256,received,file_id,updated_at,unreferenced_since)
      VALUES($1,$2,$3,$4,$5,$6,'cleanup.png',10,$7,$8,$9,now()-interval '8 days',CASE WHEN $10::int IS NULL THEN NULL ELSE now()-$10*interval '1 day' END)`,
    [id, postId, owner, config.PLATFORM_PROJECT_ID, config.PLATFORM_ENVIRONMENT_ID, credential, 'a'.repeat(64), received, fileId, days]);
    return id;
  }
  try {
    const referencedFile = randomUUID(), referenced = await upload(referencedFile, 8);
    await db.query("INSERT INTO post_file_refs(post_id,file_id,source) VALUES($1,$2,'DRAFT')", [postId, referencedFile]);
    const bodyFile = randomUUID(), bodyOnly = await upload(bodyFile, 8);
    await db.query("UPDATE post_drafts SET data=jsonb_set(data,'{thumbnailId}',to_jsonb($2::text)) WHERE post_id=$1", [postId, bodyFile]);
    const recent = await upload(randomUUID(), null);
    const partial = await upload(null, 8, 5);
    await mkdir(config.UPLOAD_DIRECTORY, { recursive: true });
    await writeFile(`${config.UPLOAD_DIRECTORY}/${partial}.upload`, 'part');
    const changedKey = await upload(null, 8, 10, 'changed-key');
    const uncertain = await upload(null, 8);
    const failedFile = randomUUID(), failed = await upload(failedFile, 8);
    remote.failingFile = failedFile;
    await cleanup.run();
    for (const id of [referenced, bodyOnly, recent, changedKey, failed]) assert.equal((await db.query('SELECT 1 FROM image_uploads WHERE id=$1', [id])).rowCount, 1);
    for (const id of [partial, uncertain]) assert.equal((await db.query('SELECT 1 FROM image_uploads WHERE id=$1', [id])).rowCount, 0);
    await assert.rejects(access(`${config.UPLOAD_DIRECTORY}/${partial}.upload`));
    assert.ok(remote.removed.includes(`/api/v1/files/${remote.remoteFile}`), 'Recover a lost completion response before cleanup');
    assert.ok(remote.removed.includes(`/api/v1/files/uploads/${remote.remoteUpload}`));
    assert.ok((await db.query('SELECT deleting_at FROM image_uploads WHERE id=$1', [failed])).rows[0].deleting_at);
    await assert.rejects(images.accessible(failedFile, { userId: owner, name: '', isAdmin: true, csrfToken: '', data: {} }), { status: 404 });
    const draft = await posts.edit(postId);
    await assert.rejects(posts.save(postId, { version: draft.version, data: { ...draft.data, thumbnailId: failedFile } }), { status: 400 });
    remote.failingFile = '';
    await cleanup.run();
    assert.equal((await db.query('SELECT 1 FROM image_uploads WHERE id=$1', [failed])).rowCount, 0);
    assert.equal(remote.removed.some(path => path.endsWith(referencedFile) || path.endsWith(bodyFile)), false);
    // Removing an old reference starts a fresh seven-day grace period.
    await db.query('DELETE FROM post_file_refs WHERE file_id=$1', [referencedFile]);
    await db.query('UPDATE image_uploads SET unreferenced_since=NULL WHERE id=$1', [referenced]);
    await cleanup.run();
    assert.equal((await db.query('SELECT 1 FROM image_uploads WHERE id=$1', [referenced])).rowCount, 1);
  } finally {
    await db.query('DELETE FROM posts WHERE id=$1', [postId]);
    await db.query('DELETE FROM image_uploads WHERE id=ANY($1::uuid[])', [created]);
    await db.query('DELETE FROM users WHERE id=$1', [owner]);
  }
});
