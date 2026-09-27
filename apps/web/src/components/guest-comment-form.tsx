'use client';

import { RefreshCw, X, Send, Trash2, Save } from 'lucide-react';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';

type Captcha = { id: string; image: string; expiresIn: number };
export function GuestCommentForm({ postId, commentId, parentId, replyToId, initial = '', mode = 'create', login, onSaved, onCancel }: {
  postId: string; commentId?: string; initial?: string; mode?: 'create' | 'edit' | 'delete'; login: string;
  parentId?: string; replyToId?: string;
  onSaved: () => void; onCancel?: () => void;
}) {
  const [name, setName] = useState(''), [password, setPassword] = useState(''), [content, setContent] = useState(initial);
  const [captcha, setCaptcha] = useState<Captcha | null>(null), [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [message, setMessage] = useState('');
  const requestId = useRef(''), sequence = useRef(0);
  const key = mode === 'create' ? replyToId ? `ggeujeok-comment-reply:${replyToId}` : `ggeujeok-comment:${postId}` : `ggeujeok-comment-edit:${commentId}`;
  async function refresh() {
    const revision = ++sequence.current; setCaptcha(null); setAnswer(''); setLoading(true);
    try { const result = await api<Captcha>('/api/guest/captcha'); if (revision === sequence.current) setCaptcha(result); }
    catch (error) { if (revision === sequence.current) setMessage((error as Error).message); }
    finally { if (revision === sequence.current) setLoading(false); }
  }
  useEffect(() => {
    try {
      const stored = JSON.parse(sessionStorage.getItem(key) || 'null');
      if (stored && !stored.owner && typeof stored.content === 'string' && stored.content.length <= 2000) {
        setContent(stored.content); setName(typeof stored.name === 'string' ? stored.name : ''); requestId.current = stored.requestId || '';
      }
    } catch { /* Draft storage is optional. */ }
    void refresh();
    return () => { sequence.current++; };
  }, [key]);
  function preserve(text: string, nickname: string) {
    requestId.current = crypto.randomUUID();
    try { sessionStorage.setItem(key, JSON.stringify({content:text,name:nickname,requestId:requestId.current,owner:null})); }
    catch { setMessage('임시 보관을 사용할 수 없습니다. 이동 전에 내용을 복사해 주세요.'); }
  }
  const field = `${key}-${mode}`;
  return <form className={`comment-form guest-comment-form${mode === 'delete' ? ' guest-comment-form--delete' : ''}`} onSubmit={async event => {
    event.preventDefault(); if (busy || !captcha || loading) return;
    if (mode === 'delete' && !window.confirm('이 비회원 댓글을 삭제할까요?')) return;
    setBusy(true); setMessage(''); requestId.current ||= crypto.randomUUID();
    let succeeded = false;
    try {
      await api(`/api/guest/posts/${postId}/comments${commentId ? `/${commentId}` : ''}`, { method:mode==='create'?'POST':mode==='edit'?'PUT':'DELETE',
        headers:{'Content-Type':'application/json'}, body:JSON.stringify({content,nickname:name,password,parentId,replyToId,requestId:requestId.current,captchaId:captcha.id,captchaAnswer:answer}) });
      try { sessionStorage.removeItem(key); } catch { /* No stored draft. */ }
      succeeded = true;
      setContent(''); setPassword(''); requestId.current=''; setMessage(mode==='delete'?'댓글을 삭제했습니다.':mode==='edit'?'댓글을 수정했습니다.':'댓글을 등록했습니다.'); onSaved();
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); if (!succeeded || (mode === 'create' && !parentId)) void refresh(); }
  }}>
    <fieldset disabled={busy}><legend className="sr-only">{mode==='create'?'비회원 댓글 작성':mode==='edit'?'비회원 댓글 수정':'비회원 댓글 삭제'}</legend>
      <div className="composer-header">
        <div className="comment-credentials">
          {mode === 'create' && <div><label htmlFor={`${field}-name`}>닉네임<span className="sr-only"> (비회원)</span></label>
            <input id={`${field}-name`} value={name} minLength={2} maxLength={30} required placeholder="2~30자" aria-describedby={`${field}-name-help`}
              onChange={event => { setName(event.target.value); preserve(content, event.target.value); }} autoComplete="nickname" />
            <p id={`${field}-name-help`} className="sr-only">한글·영문·숫자·공백·밑줄·마침표·하이픈을 사용할 수 있습니다.</p></div>}
          <div><label htmlFor={`${field}-password`}>댓글 비밀번호</label>
            <input type="password" id={`${field}-password`} value={password} minLength={8} maxLength={128} required placeholder="8자 이상" aria-describedby={`${field}-password-help`}
              autoComplete={mode === 'create' ? 'new-password' : 'current-password'} onChange={event => setPassword(event.target.value)} /></div>
        </div>
        {mode === 'create' && <a className="composer-login" href={login}>로그인해서 작성</a>}
      </div>
        {mode !== 'delete' && <div className="comment-body-field">
          <label className="sr-only" htmlFor={`${field}-content`}>댓글 내용</label>
          <textarea id={`${field}-content`} rows={6} maxLength={2000} required value={content} placeholder="댓글을 입력해 주세요" aria-describedby={`${field}-content-help`}
            onChange={event => { setContent(event.target.value); preserve(event.target.value, name); }} />
          <p id={`${field}-content-help`} className="field-help comment-count">{content.length}/2,000</p>
        </div>}
      <div className="comment-form-footer">
        <div className="comment-captcha">
          <label className="sr-only" htmlFor={`${field}-captcha`}>보안문자 · 숫자 6자리</label>
          <div className="captcha-image">
            {captcha ? <img src={captcha.image} width={154} height={44} alt="오른쪽 입력란에 입력할 보안 숫자 6자리" />
              : <span role="status">{loading ? '불러오는 중…' : '새로고침해 주세요.'}</span>}
          </div>
          <div className="captcha-entry">
            <input id={`${field}-captcha`} inputMode="numeric" autoComplete="off" maxLength={6} minLength={6} pattern="[2-9]{6}" required value={answer} placeholder="6자리"
              aria-describedby={`${field}-captcha-help`} onChange={event => setAnswer(event.target.value)} />
            <button type="button" className="secondary captcha-refresh" aria-label="새 보안문자" title="새 보안문자" disabled={loading} onClick={() => void refresh()}>
              <RefreshCw aria-hidden="true" />
            </button>
          </div>
          <p id={`${field}-captcha-help`} className="sr-only">보안 숫자 6자리를 5분 안에 입력하세요. 읽기 어려우면 새 보안문자 버튼을 누르세요.</p>
        </div>
        <div className="button-row">{onCancel && <button className="text-button" type="button" onClick={onCancel}><X aria-hidden="true" />취소</button>}
          <button disabled={loading || !captcha || busy}>{mode === 'delete' ? <Trash2 aria-hidden="true" /> : mode === 'edit' ? <Save aria-hidden="true" /> : <Send aria-hidden="true" />}{busy?'처리 중…':mode==='delete'?'댓글 삭제':mode==='edit'?'수정 저장':parentId?'답글 등록':'댓글 등록'}</button></div>
      </div>
      <details className="comment-guidance"><summary>비회원 작성 안내</summary>
        <p id={`${field}-password-help`}>비밀번호는 수정·삭제에 사용하며 복구할 수 없습니다. 다른 곳과 다른 비밀번호를 사용해 주세요.</p>
        <p>보안문자는 5분 안에 입력해 주세요. 비회원은 댓글 알림을 받을 수 없습니다.</p>
      </details>
    </fieldset>{message && <p role="status" className="field-help">{message}</p>}
  </form>;
}
