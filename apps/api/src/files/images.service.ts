import { BadGatewayException, BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, unlink } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { z } from 'zod';
import type { PoolClient } from 'pg';
import { Database } from '../database/database.js';
import { config } from '../config.js';
import { PlatformFiles, type PlatformFile, type PlatformUpload } from './platform-files.js';
import type { Session } from '../auth/sessions.js';
import type { AttachmentViews } from '@shnea/editor';

export const chunkBytes = 4 * 1024 * 1024;
export const imageVariant = z.enum(['thumbnail', 'preview', 'original', 'download']);
const safeImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
export const uploadInput = z.object({ requestId: z.uuid(), name: z.string().trim().min(1).max(255),
  size: z.number().int().min(1).max(20 * 1024 * 1024), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
type Upload = { id: string; post_id: string | null; owner_id: string; project_id: string; environment_id: string;
  credential_hash: string; original_name: string; size: number; sha256: string; received: number;
  media_type: string | null; file_id: string | null; deleting_at?: Date | null };
const digest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');

@Injectable()
export class Images {
  constructor(@Inject(Database) private readonly db: Database, @Inject(PlatformFiles) private readonly platform: PlatformFiles) {}
  private diskPath(id: string) { return path.join(config.UPLOAD_DIRECTORY, `${z.uuid().parse(id)}.upload`); }
  private status(row: Upload) { return { id: row.id, received: row.received, size: row.size, fileId: row.file_id, name: row.original_name, chunkBytes }; }

  async start(postId: string, ownerId: string, input: unknown) {
    const data = uploadInput.parse(input);
    await this.platform.checkEnvironment();
    return this.db.transaction(async tx => {
      const post = await tx.query('SELECT id FROM posts WHERE id=$1 AND author_id=$2 FOR UPDATE', [postId, ownerId]);
      if (!post.rowCount) throw new NotFoundException();
      await tx.query(`INSERT INTO image_uploads(id,post_id,owner_id,project_id,environment_id,credential_hash,original_name,size,sha256)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(id) DO NOTHING`,
      [data.requestId, postId, ownerId, config.PLATFORM_PROJECT_ID, config.PLATFORM_ENVIRONMENT_ID, digest(config.PLATFORM_API_KEY), data.name, data.size, data.sha256]);
      const row = await this.owned(tx, data.requestId, ownerId);
      if (row.post_id !== postId || row.sha256 !== data.sha256 || row.size !== data.size || row.original_name !== data.name) throw new ConflictException('업로드 요청 ID에 다른 파일이 연결돼 있습니다. 새로 추가해 주세요.');
      return this.status(row);
    });
  }

  private async owned(tx: PoolClient, id: string, ownerId: string) {
    const result = await tx.query<Upload>('SELECT * FROM image_uploads WHERE id=$1 AND owner_id=$2 FOR UPDATE', [id, ownerId]);
    const row = result.rows[0];
    if (row?.deleting_at) throw new ConflictException('보존 기간이 지난 이미지입니다. 새로 추가해 주세요.');
    if (!row?.post_id || row.project_id !== config.PLATFORM_PROJECT_ID || row.environment_id !== config.PLATFORM_ENVIRONMENT_ID) throw new NotFoundException();
    if (!row.file_id && row.credential_hash !== digest(config.PLATFORM_API_KEY)) throw new ConflictException('플랫폼 키가 바뀌었습니다. 이미지 블록을 제거하고 새로 추가해 주세요.');
    return row;
  }

  async chunk(id: string, ownerId: string, offset: number, bytes: Buffer) {
    if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > chunkBytes) throw new BadRequestException('이미지 조각 크기를 확인해 주세요.');
    return this.db.transaction(async tx => {
      const row = await this.owned(tx, id, ownerId);
      if (row.file_id || row.received !== offset) throw new ConflictException('업로드 위치가 바뀌었습니다. 다시 시도하면 이어서 전송합니다.');
      if (offset + bytes.length > row.size) throw new BadRequestException('신고한 파일 크기를 초과했습니다.');
      await mkdir(config.UPLOAD_DIRECTORY, { recursive: true });
      const file = await open(this.diskPath(id), offset === 0 ? 'w' : 'r+');
      try {
        if ((await file.stat()).size < offset) throw new ConflictException('임시 파일이 없습니다. 이미지 블록을 새로 추가해 주세요.');
        // A process exit after writing but before DB commit may leave extra bytes.
        await file.truncate(offset);
        let written = 0;
        while (written < bytes.length) {
          const result = await file.write(bytes, written, bytes.length - written, offset + written);
          if (!result.bytesWritten) throw new Error('Image chunk write failed');
          written += result.bytesWritten;
        }
        await file.sync();
      } finally { await file.close(); }
      await tx.query('UPDATE image_uploads SET received=$2,updated_at=now() WHERE id=$1', [id, offset + bytes.length]);
      return { received: offset + bytes.length };
    });
  }

  async complete(id: string, ownerId: string) {
    await this.platform.checkEnvironment();
    const result = await this.db.transaction(async tx => {
      const row = await this.owned(tx, id, ownerId);
      if (row.file_id) return this.status(row);
      if (row.received !== row.size) throw new ConflictException('이미지 전송이 아직 끝나지 않았습니다.');
      const source = this.diskPath(id), hash = createHash('sha256');
      for await (const chunk of createReadStream(source)) hash.update(chunk);
      if (hash.digest('hex') !== row.sha256) throw new BadRequestException('전송한 파일이 원본과 다릅니다. 이미지 블록을 새로 추가해 주세요.');
      let format: string | undefined;
      try { format = (await sharp(source, { limitInputPixels: 40000000, failOn: 'warning' }).metadata()).format; }
      catch { throw new BadRequestException('이미지 형식이 손상됐거나 해상도가 너무 큽니다.'); }
      const mediaTypes: Record<string, string> = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };
      const mediaType = mediaTypes[format || ''];
      if (!mediaType) throw new BadRequestException('JPEG·PNG·WebP·GIF 이미지만 업로드할 수 있습니다.');
      try { await sharp(source, { limitInputPixels: 40000000, failOn: 'warning' }).stats(); }
      catch { throw new BadRequestException('이미지 데이터가 손상됐습니다. 다른 파일을 선택해 주세요.'); }
      const upload = await this.platform.json<PlatformUpload>('/api/v1/files/uploads', 'POST', {
        requestId: row.id, originalName: row.original_name, size: row.size, sha256: row.sha256, visibility: 'PRIVATE', retentionCode: '영구',
      });
      z.uuid().parse(upload.uploadId);
      const endpoint = `/api/v1/files/uploads/${upload.uploadId}`;
      const remote = await this.platform.json<PlatformUpload>(endpoint);
      if (!['UPLOADING', 'READY'].includes(remote.state) || remote.size !== row.size || !Number.isSafeInteger(remote.receivedBytes) || remote.receivedBytes < 0 || remote.receivedBytes > row.size) {
        throw new ConflictException('플랫폼 업로드가 만료되거나 변경됐습니다. 이미지 블록을 새로 추가해 주세요.');
      }
      const file = await open(source, 'r');
      try {
        let offset = remote.receivedBytes;
        while (offset < row.size) {
          const bytes = Buffer.alloc(Math.min(chunkBytes, row.size - offset));
          const { bytesRead } = await file.read(bytes, 0, bytes.length, offset);
          if (bytesRead !== bytes.length) throw new BadRequestException('임시 이미지가 변경됐습니다.');
          const response = await this.platform.request(endpoint, { method: 'PATCH', body: new Uint8Array(bytes),
            headers: { 'Content-Type': 'application/octet-stream', 'Upload-Offset': String(offset), 'X-Chunk-SHA256': digest(bytes) } });
          const next = await response.json() as PlatformUpload;
          if (next.receivedBytes !== offset + bytes.length) throw new ConflictException('플랫폼 수신 위치를 확인할 수 없습니다. 다시 시도해 주세요.');
          offset = next.receivedBytes;
        }
      } finally { await file.close(); }
      const saved = await this.platform.json<PlatformFile>(`${endpoint}/complete`, 'POST');
      if (!z.uuid().safeParse(saved.fileId).success || saved.sha256 !== row.sha256 || saved.size !== row.size || saved.visibility !== 'PRIVATE' || saved.retentionCode !== '영구') throw new ConflictException('플랫폼에 저장된 파일 설정을 확인할 수 없습니다.');
      await tx.query('UPDATE image_uploads SET file_id=$2,media_type=$3,updated_at=now() WHERE id=$1', [id, saved.fileId, mediaType]);
      return this.status({ ...row, file_id: saved.fileId });
    });
    await unlink(this.diskPath(id)).catch(() => {});
    return result;
  }

  async accessible(fileId: string, session: Session | null) {
    const result = await this.db.query<Upload>(`SELECT u.* FROM image_uploads u WHERE u.file_id=$1 AND u.project_id=$2 AND u.environment_id=$3 AND u.deleting_at IS NULL
      AND ((u.owner_id=$4 AND $5::boolean AND u.post_id IS NOT NULL) OR EXISTS(
        SELECT 1 FROM post_file_refs r JOIN posts p ON p.id=r.post_id WHERE r.file_id=u.file_id AND r.source='PUBLISHED' AND p.status='PUBLIC'))`,
    [fileId, config.PLATFORM_PROJECT_ID, config.PLATFORM_ENVIRONMENT_ID, session?.userId || null, session?.isAdmin || false]);
    if (!result.rows[0]) throw new NotFoundException('이미지를 찾을 수 없습니다.');
    return result.rows[0];
  }

  async resolve(fileId: string, session: Session | null) {
    await this.accessible(fileId, session);
    // Preserve platform-issued URLs, tokens, expiry, nulls and additional fields.
    // Only the scoped view ticket reaches the browser; the API key stays here.
    return this.platform.json<AttachmentViews>(`/api/v1/files/${fileId}/view-ticket`, 'POST');
  }

  async content(fileId: string, session: Session | null, signal: AbortSignal, variant: unknown = 'original') {
    const kind = imageVariant.parse(variant);
    const file = await this.accessible(fileId, session);
    const response = await this.platform.request(`/api/v1/files/${fileId}/content/${kind}`, { signal });
    // Converted variants can have a different format from the uploaded original.
    const supplied = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
    const mediaType = kind === 'original' || kind === 'download' ? file.media_type! : supplied;
    if (!mediaType || !safeImageTypes.has(mediaType)) {
      await response.body?.cancel();
      throw new BadGatewayException('이미지 응답 형식을 확인하지 못했습니다.');
    }
    return { response, file, mediaType };
  }
}
