import { createHash } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { Database } from '../database/database.js';
import { config } from '../config.js';
import { PlatformFiles, type PlatformUpload } from './platform-files.js';
import { logs } from '../operations/logs.js';

type Candidate = { id: string; post_id: string | null; file_id: string | null; credential_hash: string;
  original_name: string; size: number; sha256: string; received: number; deleting_at: Date | null };

export class FileCleanup {
  constructor(private readonly db: Database, private readonly platform: PlatformFiles) {}

  async run() {
    // Start the grace period when absence is first observed, never from an old upload date.
    await this.db.query(`UPDATE image_uploads u SET unreferenced_since=now()
      WHERE unreferenced_since IS NULL AND deleting_at IS NULL AND project_id=$1 AND environment_id=$2
      AND NOT EXISTS(SELECT 1 FROM post_file_refs r WHERE r.file_id=u.file_id)`, [config.PLATFORM_PROJECT_ID, config.PLATFORM_ENVIRONMENT_ID]);
    const candidates = await this.db.query<Candidate>(`SELECT * FROM image_uploads u WHERE project_id=$1 AND environment_id=$2
      AND (deleting_at IS NOT NULL OR (unreferenced_since<now()-interval '7 days' AND updated_at<now()-interval '7 days'))
      ORDER BY unreferenced_since,id LIMIT 25`, [config.PLATFORM_PROJECT_ID, config.PLATFORM_ENVIRONMENT_ID]);
    if (!candidates.rowCount) return 0;
    await this.platform.checkEnvironment();
    let removed = 0;
    for (const candidate of candidates.rows) {
      try {
        const row = await this.claim(candidate);
        if (!row) continue;
        await this.removeRemote(row);
        try { await unlink(path.join(config.UPLOAD_DIRECTORY, `${z.uuid().parse(row.id)}.upload`)); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        await this.db.query('DELETE FROM image_uploads WHERE id=$1 AND deleting_at IS NOT NULL', [row.id]);
        removed++;
      } catch { logs.write('worker.failed', { component: 'files' }); }
    }
    if (removed) logs.write('retention.completed', { component: 'files', count: removed });
    return removed;
  }

  private async claim(candidate: Candidate): Promise<Candidate | null> {
    return this.db.transaction(async tx => {
      // Match save/publish lock order: post first, then its image rows.
      if (candidate.post_id) {
        const post = await tx.query('SELECT id FROM posts WHERE id=$1 FOR UPDATE SKIP LOCKED', [candidate.post_id]);
        if (!post.rowCount) return null;
      }
      const selected = await tx.query<Candidate>(`SELECT * FROM image_uploads WHERE id=$1
        AND project_id=$2 AND environment_id=$3
        AND (deleting_at IS NOT NULL OR (unreferenced_since<now()-interval '7 days' AND updated_at<now()-interval '7 days'))
        FOR UPDATE SKIP LOCKED`, [candidate.id, config.PLATFORM_PROJECT_ID, config.PLATFORM_ENVIRONMENT_ID]);
      const row = selected.rows[0];
      if (!row) return null;
      if (row.file_id) {
        const refs = await tx.query(`SELECT 1 FROM post_file_refs WHERE file_id=$1 UNION ALL
          SELECT 1 FROM posts WHERE thumbnail_id=$1 OR content::text LIKE '%'||$1::text||'%' UNION ALL
          SELECT 1 FROM post_drafts WHERE data::text LIKE '%'||$1::text||'%' LIMIT 1`, [row.file_id]);
        if (refs.rowCount) {
          await tx.query('UPDATE image_uploads SET unreferenced_since=NULL WHERE id=$1', [row.id]);
          return null;
        }
      }
      if (!row.file_id && row.received === row.size
        && row.credential_hash !== createHash('sha256').update(config.PLATFORM_API_KEY).digest('hex')) {
        // A key-bound remote upload cannot be reconciled with a replacement key.
        logs.write('worker.failed', { component: 'files' });
        return null;
      }
      // Commit a tombstone before remote deletion. Retries cannot reattach a possibly deleted image.
      await tx.query('UPDATE image_uploads SET deleting_at=COALESCE(deleting_at,now()) WHERE id=$1', [row.id]);
      return row;
    });
  }

  private async removeRemote(row: Candidate) {
    if (row.file_id) return this.platform.remove(`/api/v1/files/${z.uuid().parse(row.file_id)}`);
    if (row.received < row.size) return; // Remote upload starts only after all local chunks arrive.
    // A remote complete response may have been lost before the local transaction committed.
    // Reconcile using the exact original idempotency input, then delete/cancel the returned resource.
    const remote = await this.platform.json<PlatformUpload>('/api/v1/files/uploads', 'POST', {
      requestId: row.id, originalName: row.original_name, size: row.size, sha256: row.sha256, visibility: 'PRIVATE', retentionCode: '영구',
    });
    const uploadId = z.uuid().parse(remote.uploadId);
    if (remote.size !== row.size || !['UPLOADING', 'READY', 'CANCELLED', 'EXPIRED', 'DELETED'].includes(remote.state)) {
      throw new Error('Unexpected upload reconciliation result');
    }
    if (remote.fileId) await this.platform.remove(`/api/v1/files/${z.uuid().parse(remote.fileId)}`);
    await this.platform.remove(`/api/v1/files/uploads/${uploadId}`);
  }
}
