'use client';

import { useEffect, useRef, useState } from 'react';
import type { AttachmentAdapter, EditorDocument } from '@shnea/editor';
import { documentImages } from '@/lib/document-images';
import { PostImage } from '@/components/post-image';

export function CoverPicker({ content, value, attachments, disabled, onChange, onBusy }: {
  content: EditorDocument; value: string | null; attachments: AttachmentAdapter; disabled: boolean;
  onChange: (id: string | null) => void; onBusy: (busy: boolean) => void;
}) {
  const images = documentImages(content), selected = value || images[0]?.fileId;
  const [busy, setBusy] = useState(false), [status, setStatus] = useState(''), [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  const retry = useRef<{ file: File; requestId: string } | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  async function upload(file: File, requestId = crypto.randomUUID()) {
    if (controller.current || disabled) return;
    const current = new AbortController(); controller.current = current;
    retry.current = { file, requestId };
    setBusy(true); onBusy(true); setError(''); setStatus('이미지 확인 중…');
    try {
      const scope = attachments.scope();
      if (!scope) throw new Error('글을 다시 연 뒤 업로드해 주세요.');
      const result = await attachments.upload(file, { scope, kind: 'image', requestId, signal: current.signal,
        progress: (percent, message) => setStatus(`${message || '업로드 중'} ${percent}%`) });
      current.signal.throwIfAborted();
      onChange(result.fileId); retry.current = null; setStatus('업로드 완료 · 대표 이미지로 선택됨');
    } catch (error) {
      if (current.signal.aborted) setStatus('업로드를 중단했습니다. 다시 시도하면 이어서 전송합니다.');
      else { setError((error as Error).message); setStatus(''); }
    } finally { controller.current = null; setBusy(false); onBusy(false); }
  }

  return <div className="cover-picker">
    <label htmlFor="cover-image">대표 이미지</label>
    <select id="cover-image" value={value || ''} disabled={disabled || busy} onChange={event => onChange(event.target.value || null)}>
      <option value="">자동 · 본문의 첫 이미지</option>
      {value && !images.some(image => image.fileId === value) && <option value={value}>별도로 선택한 이미지</option>}
      {images.map((image, index) => <option key={image.fileId} value={image.fileId}>{index + 1}. {image.name}</option>)}
    </select>
    {selected && <PostImage src={`/api/files/${encodeURIComponent(selected)}/content/preview`} alt="현재 대표 이미지" className="cover-preview" retry />}
    <p className="field-help">직접 선택하지 않으면 본문의 첫 이미지를 사용합니다. 변경 사항은 공개본에 반영해야 방문자에게 보입니다.</p>
    <label htmlFor="cover-upload">별도 이미지 업로드</label>
    <input id="cover-upload" type="file" accept="image/jpeg,image/png,image/webp,image/gif" disabled={disabled || busy}
      onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void upload(file); }} />
    <p className="field-help">JPEG·PNG·WebP·GIF, 최대 20MiB. 본문에는 삽입하지 않습니다.</p>
    <p className="field-help" role="status">{status}</p>
    {error && <p className="cover-error" role="alert">{error}</p>}
    {busy ? <button type="button" className="secondary" onClick={() => controller.current?.abort()}>업로드 중단</button>
      : retry.current && <button type="button" className="secondary" disabled={disabled} onClick={() => { const saved = retry.current; if (saved) void upload(saved.file, saved.requestId); }}>업로드 다시 시도</button>}
  </div>;
}
