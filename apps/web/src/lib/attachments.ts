import type { AttachmentAdapter, AttachmentViews } from '@shnea/editor';
import { api, mutation } from './api';

type Upload = { id: string; received: number; size: number; fileId: string | null; chunkBytes: number };

export const viewerAttachments: AttachmentAdapter = {
  platformImageOrigin: 'https://platform.shnea.kr',
  scope: () => undefined,
  upload: async () => { throw new Error('편집 화면에서 이미지를 추가해 주세요.'); },
  resolve: (file, signal) => api<AttachmentViews>(`/api/files/${encodeURIComponent(file.fileId)}/views`, { signal }),
};

export function editorAttachments(postId: string, csrf: string): AttachmentAdapter {
  return {
    ...viewerAttachments,
    scope: () => postId,
    async upload(file, context) {
      if (!['image', 'file'].includes(context.kind)) throw new Error('현재는 이미지 업로드만 지원합니다.');
      if (!file.size || file.size > 20 * 1024 * 1024) throw new Error('이미지는 20MiB까지 업로드할 수 있습니다.');
      if (file.type && !['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) throw new Error('JPEG·PNG·WebP·GIF 이미지를 선택해 주세요.');
      const { signal } = context;
      context.progress(0, '이미지 확인 중');
      const hash = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
      signal.throwIfAborted();
      const sha256 = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
      const upload = await api<Upload>(`/api/admin/posts/${postId}/uploads`, {
        ...mutation('POST', csrf, { requestId: context.requestId, name: file.name, size: file.size, sha256 }), signal,
      });
      let offset = upload.received;
      // Repeating the same request ID returns the last confirmed offset.
      while (!upload.fileId && offset < file.size) {
        const end = Math.min(offset + upload.chunkBytes, file.size);
        const next = await api<{ received: number }>(`/api/admin/uploads/${upload.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/octet-stream', 'X-CSRF-Token': csrf, 'Upload-Offset': String(offset) },
          body: file.slice(offset, end), signal,
        });
        if (next.received !== end) throw new Error('업로드 위치를 확인하지 못했습니다. 다시 시도해 주세요.');
        offset = next.received;
        context.progress(Math.round(offset / file.size * 80), '이미지 전송 중');
      }
      context.progress(85, '이미지 저장 중');
      const saved = upload.fileId ? upload : await api<Upload>(`/api/admin/uploads/${upload.id}/complete`, { ...mutation('POST', csrf), signal });
      if (!saved.fileId) throw new Error('이미지 저장 결과를 확인하지 못했습니다. 다시 시도해 주세요.');
      context.progress(100, '업로드 완료');
      return { fileId: saved.fileId, scope: postId, kind: context.kind, name: file.name, size: file.size };
    },
  };
}
