'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { EditorDocument } from '@shnea/editor';
import { api, ApiError, mutation } from '@/lib/api';

export type DraftData = { title: string; slug: string; summary: string; categoryId: string | null; thumbnailId?: string | null; commentsEnabled?: boolean; tags: string[]; content: EditorDocument };
export type Draft = { id: string; data: DraftData; version: number; baseVersion: number; postVersion: number; status: string; publishedAt: string | null };
export function useDraft(initial: Draft, csrf: string) {
  const [draft, setDraft] = useState(initial);
  const current = useRef(initial);
  const revision = useRef(0), savedRevision = useRef(0), dirtySince = useRef<number | null>(null);
  const flight = useRef<Promise<void> | null>(null);
  const conflicted = useRef(false);
  const [status, setStatus] = useState('저장됨');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [tick, setTick] = useState(0);

  const change = useCallback((fields: Partial<DraftData>) => {
    current.current = { ...current.current, data: { ...current.current.data, ...fields } };
    revision.current += 1;
    dirtySince.current ??= Date.now();
    setDraft(current.current);
    if (!conflicted.current) { setError(''); setStatus('저장 대기'); }
  }, []);

  const save = useCallback(async () => {
    if (flight.current) return flight.current;
    if (revision.current === savedRevision.current) return;
    if (conflicted.current) throw new Error('충돌한 편집본은 다시 열어야 합니다. 먼저 내용을 내려받아 보관하세요.');
    const snapshot = current.current, snapshotRevision = revision.current;
    setStatus('저장 중…'); setError('');
    const work = async () => {
      try {
        const result = await api<{ version: number; baseVersion: number }>(`/api/admin/posts/${snapshot.id}/draft`,
          mutation('PUT', csrf, { version: snapshot.version, data: snapshot.data }));
        current.current = { ...current.current, ...result };
        savedRevision.current = snapshotRevision;
        dirtySince.current = revision.current === snapshotRevision ? null : Date.now();
        setDraft(current.current); setStatus(dirtySince.current ? '저장 대기' : '저장됨');
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) conflicted.current = true;
        setError((error as Error).message); setStatus(conflicted.current ? '저장 충돌' : '저장 실패');
        throw error;
      } finally { flight.current = null; setTick(value => value + 1); }
    };
    flight.current = work();
    return flight.current;
  }, [csrf]);

  useEffect(() => {
    if (dirtySince.current === null || error || conflicted.current || pending) return;
    const remaining = Math.max(0, Math.min(3000, 30000 - (Date.now() - dirtySince.current)));
    const timer = setTimeout(() => { void save().catch(() => {}); }, remaining);
    return () => clearTimeout(timer);
  }, [draft.data, tick, error, pending, save]);

  useEffect(() => {
    const preventLoss = (event: BeforeUnloadEvent) => {
      if (revision.current !== savedRevision.current) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', preventLoss);
    return () => window.removeEventListener('beforeunload', preventLoss);
  }, []);

  async function publish(status: 'PUBLIC' | 'PRIVATE') {
    if (pending) return;
    setPending(true); setError('');
    try {
      do { await save(); } while (savedRevision.current !== revision.current);
      const snapshot = current.current;
      const result = await api<{ version: number; baseVersion: number; status: string }>(`/api/admin/posts/${snapshot.id}/publish`,
        mutation('POST', csrf, { draftVersion: snapshot.version, baseVersion: snapshot.baseVersion, status }));
      current.current = { ...current.current, ...result, publishedAt: status === 'PUBLIC' ? current.current.publishedAt || new Date().toISOString() : current.current.publishedAt };
      setDraft(current.current); setStatus(status === 'PUBLIC' ? '공개본 반영됨' : '비공개로 저장됨');
    } catch (error) { setError((error as Error).message); }
    finally { setPending(false); }
  }
  function allowExit() { savedRevision.current = revision.current; }
  return { draft, change, save, publish, status, error, pending, allowExit };
}
