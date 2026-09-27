import { BadRequestException } from '@nestjs/common';
import type { EditorDocument } from '@shnea/editor';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { config } from '../config.js';

export function imageReferences(document: EditorDocument, postId: string, allowPending: boolean) {
  const ids = new Set<string>();
  function visit(node: EditorDocument['content']) {
    if (node.type === 'attachment') {
      const attrs = node.attrs || {};
      if (attrs.scope !== postId || !['image', 'file'].includes(attrs.kind)) throw new BadRequestException('이 글에 연결된 이미지 파일만 사용할 수 있습니다.');
      if (!attrs.fileId) {
        if (!allowPending) throw new BadRequestException('이미지 업로드를 완료하거나 미완료 블록을 제거한 뒤 반영해 주세요.');
      } else {
        if (!z.uuid().safeParse(attrs.fileId).success) throw new BadRequestException('파일 식별자가 올바르지 않습니다.');
        ids.add(attrs.fileId);
      }
    }
    node.content?.forEach(visit);
  }
  visit(document.content);
  return [...ids];
}

export async function syncImageReferences(tx: PoolClient, postId: string, document: EditorDocument, source: 'DRAFT' | 'PUBLISHED', thumbnailId: string | null = null) {
  const bodyIds = imageReferences(document, postId, source === 'DRAFT');
  const ids = [...new Set(thumbnailId ? [...bodyIds, thumbnailId] : bodyIds)];
  const owned = await tx.query(`SELECT u.file_id FROM image_uploads u JOIN posts p ON p.id=u.post_id
    WHERE u.file_id=ANY($1::uuid[]) AND u.post_id=$2 AND u.owner_id=p.author_id AND u.project_id=$3 AND u.environment_id=$4`,
  [ids, postId, config.PLATFORM_PROJECT_ID, config.PLATFORM_ENVIRONMENT_ID]);
  if (owned.rowCount !== ids.length) throw new BadRequestException('이 글에서 사용할 수 없는 이미지가 포함되어 있습니다.');
  await tx.query('DELETE FROM post_file_refs WHERE post_id=$1 AND source=$2', [postId, source]);
  if (ids.length) await tx.query('INSERT INTO post_file_refs(post_id,file_id,source) SELECT $1,unnest($2::uuid[]),$3', [postId, ids, source]);
  // A separate cover does not count as non-empty article content.
  return bodyIds;
}
