'use client';

import { Send, X, LogIn } from 'lucide-react';


import { useEffect, useRef, useState } from 'react';
import type { Session } from '@/lib/api';

export function CommentForm({ storageKey, initial = '', session, login, disabled, editing = false, replying = false, onSubmit, onCancel }: {
  storageKey: string; initial?: string; session: Session; login: string; disabled: boolean; editing?: boolean; replying?: boolean;
  onSubmit: (content: string, requestId: string) => Promise<void>; onCancel?: () => void;
}) {
  const [content, setContent] = useState(initial), [message, setMessage] = useState(''), [submitting, setSubmitting] = useState(false);
  const requestId = useRef('');
  const owner = useRef(session.user?.id || null);
  useEffect(() => {
    try {
      const stored = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
      if (stored && (!stored.owner || stored.owner === session.user?.id) && typeof stored.content === 'string' && stored.content.length <= 2000) {
        setContent(stored.content); requestId.current = stored.requestId || ''; owner.current = stored.owner;
        setMessage('작성 중이던 내용을 복원했습니다.');
      }
    } catch { /* Storage can be unavailable in private browsing. */ }
  }, [storageKey]);
  function change(value: string) {
    setContent(value); setMessage(''); requestId.current = crypto.randomUUID(); owner.current = session.user?.id || owner.current;
    try { sessionStorage.setItem(storageKey, JSON.stringify({ content: value, requestId: requestId.current, owner: owner.current })); }
    catch { setMessage('이 브라우저에서는 임시 보관이 안 됩니다. 이동 전에 내용을 복사해 주세요.'); }
  }
  return <form className="comment-form member-comment-form" onSubmit={async event => {
    event.preventDefault(); if (disabled || submitting || !session.user || !content.trim()) return;
    setSubmitting(true); setMessage(''); requestId.current ||= crypto.randomUUID();
    try {
      await onSubmit(content, requestId.current);
      try { sessionStorage.removeItem(storageKey); } catch { /* No stored draft. */ }
      setContent(''); requestId.current = ''; setMessage(editing ? '댓글을 수정했습니다.' : '댓글을 등록했습니다.');
    } catch (error) { setMessage((error as Error).message); }
    finally { setSubmitting(false); }
  }}>
    <label htmlFor={storageKey}>{editing ? '댓글 수정' : replying ? '답글 작성' : '댓글 작성'}</label>
    <textarea id={storageKey} value={content} rows={6} maxLength={2000} disabled={disabled || submitting}
      onChange={event => change(event.target.value)} placeholder="댓글을 입력해 주세요" aria-describedby={`${storageKey}-help`} />
    <p id={`${storageKey}-help`} className="field-help">{session.user ? session.user.nickname ? `${session.user.nickname} 이름으로 공개됩니다.` : '닉네임을 불러오려면 다시 로그인해 주세요.' : '등록하려면 로그인해 주세요. 입력은 이 탭에 임시 보관됩니다.'} {content.length}/2,000</p>
    <div className="button-row">{session.user?.nickname ? <button type="submit" disabled={disabled || submitting || !content.trim()}><Send aria-hidden="true" />{submitting ? '저장 중…' : editing ? '수정 저장' : replying ? '답글 등록' : '댓글 등록'}</button>
      : <a className="button" href={login}><LogIn aria-hidden="true" />로그인하고 댓글 등록</a>}
      {onCancel && <button className="text-button" type="button" disabled={submitting} onClick={onCancel}><X aria-hidden="true" />취소</button>}</div>
    {message && <p className="field-help" role="status">{message}</p>}
  </form>;
}
