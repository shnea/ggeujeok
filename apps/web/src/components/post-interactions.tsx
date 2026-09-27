'use client';

import { Reply, Pencil, Trash2, Heart, RefreshCw, ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react';


import { useEffect, useState } from 'react';
import { api, ApiError, mutation, type Session } from '@/lib/api';
import { GuestCommentForm } from './guest-comment-form';
import { CommentForm } from './comment-form';

type Comment = {
  id: string; parentId: string | null; content: string; authorName: string; replyToName: string | null;
  isDeleted: boolean; isGuest: boolean; isAuthor: boolean; createdAt: string; updatedAt: string;
  canEdit: boolean; canDelete: boolean; replyCount?: number;
};
type Activity = { comments: Comment[]; commentsEnabled: boolean; commentCount: number; threadCount: number; likeCount: number; liked: boolean; page: number };
type Replies = { items: Comment[]; total: number; page: number };
type Action = { kind: 'reply' | 'edit' | 'delete'; comment: Comment; rootId: string };
const date = (value: string) => new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Seoul' }).format(new Date(value));

export function PostInteractions({ postId, slug }: { postId: string; slug: string }) {
  const [session, setSession] = useState<Session | null>(null);
  const [data, setData] = useState<Activity | null>(null);
  const [page, setPage] = useState(1), [retry, setRetry] = useState(0);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true);
  const [action, setAction] = useState<Action | null>(null);
  const [expanded, setExpanded] = useState<{ id: string; page: number } | null>(null);
  const [replies, setReplies] = useState<Replies | null>(null), [replyError, setReplyError] = useState('');
  const [focusId,setFocusId]=useState<string|null>(null),[linkError,setLinkError]=useState('');
  const login = `/login?returnTo=${encodeURIComponent(`/posts/${slug}#comments`)}`;
  const path = `/api/posts/${postId}`;
  const replyDraftKey = `ggeujeok-reply-target:${postId}`;

  useEffect(()=>{
    const controller=new AbortController();
    let revision=0;
    function locate(){
      const current=++revision;
      const match=window.location.hash.match(/^#comment-([a-f0-9-]{36})$/i);
      if(!match)return;
      api<{id:string;parentId:string|null;page:number;replyPage:number}>(`/api/public/posts/${slug}/comments/${match[1]}/location`,{signal:controller.signal})
        .then(result=>{if(!controller.signal.aborted&&current===revision){setPage(result.page);setExpanded(result.parentId?{id:result.parentId,page:result.replyPage}:null);setFocusId(result.id);setAction(null);setLinkError('');}})
        .catch(error=>{if(!controller.signal.aborted&&current===revision)setLinkError(error.message);});
    }
    locate();window.addEventListener('hashchange',locate);
    return ()=>{controller.abort();window.removeEventListener('hashchange',locate);};
  },[slug]);

  useEffect(()=>{
    if(!focusId)return;
    const target=document.getElementById(`comment-${focusId}`);
    if(target){target.scrollIntoView({block:'center'});target.focus({preventScroll:true});setFocusId(null);}
  },[focusId,data,replies]);

  useEffect(() => {
    try {
      const stored = JSON.parse(sessionStorage.getItem(replyDraftKey) || 'null');
      if (stored?.kind === 'reply' && typeof stored.rootId === 'string' && typeof stored.comment?.id === 'string') {
        setAction(stored); setExpanded({ id: stored.rootId, page: 1 });
        if (Number.isInteger(stored.page) && stored.page > 0) setPage(stored.page);
      }
    } catch { /* A reply draft is optional. The server validates its target. */ }
  }, [replyDraftKey]);

  useEffect(() => {
    const controller = new AbortController(); setLoading(true);
    Promise.all([api<Session>('/api/auth/session', { signal: controller.signal }),
      api<Activity>(`/api/public/posts/${slug}/interactions?page=${page}`, { signal: controller.signal })])
      .then(([session, result]) => {
        if (controller.signal.aborted) return;
        setSession(session); setData(result); setError('');
        if (page > 1 && !result.comments.length) setPage(Math.max(1, Math.ceil(result.threadCount / 20)));
      }).catch(error => { if (!controller.signal.aborted) { setData(null); setError(error.message); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [slug, page, retry]);

  useEffect(() => {
    if (!expanded) { setReplies(null); return; }
    const controller = new AbortController(); setReplies(null); setReplyError('');
    api<Replies>(`/api/public/posts/${slug}/comments/${expanded.id}/replies?page=${expanded.page}`, { signal: controller.signal })
      .then(result => {
        if (controller.signal.aborted) return;
        if (expanded.page > 1 && !result.items.length) setExpanded({ id: expanded.id, page: Math.max(1, Math.ceil(result.total / 20)) });
        else setReplies(result);
      }).catch(error => { if (!controller.signal.aborted) setReplyError(error.message); });
    return () => controller.abort();
  }, [slug, expanded, retry]);

  function chooseAction(next: Action | null) {
    setAction(next);
    try {
      if (next?.kind === 'reply') sessionStorage.setItem(replyDraftKey, JSON.stringify({ ...next, page }));
      else sessionStorage.removeItem(replyDraftKey);
    } catch { /* Content storage reports its own availability. */ }
  }
  function savedReply(rootId: string) {
    const root = data?.comments.find(comment => comment.id === rootId);
    setExpanded({ id: rootId, page: Math.max(1, Math.ceil(((root?.replyCount || 0) + 1) / 20)) });
    chooseAction(null); setRetry(value => value + 1);
  }
  function savedComment() { chooseAction(null); setRetry(value => value + 1); }
  function savedRoot() {
    setPage(Math.max(1, Math.ceil(((data?.threadCount || 0) + 1) / 20))); savedComment();
  }
  async function write<T>(url: string, method: string, body?: unknown) {
    setBusy(true); setError('');
    try { return await api<T>(url, mutation(method, session!.csrfToken!, body)); }
    catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setSession(current => current ? { ...current, user: null, csrfToken: null } : null);
        setError('로그인이 만료됐습니다. 작성 중인 내용은 이 탭에 보관됩니다. 다시 로그인해 주세요.');
      }
      throw error;
    } finally { setBusy(false); }
  }
  async function like() {
    if (!data) return;
    try {
      const result = await write<{ liked: boolean; count: number }>(`${path}/like`, data.liked ? 'DELETE' : 'PUT');
      setData(current => current ? { ...current, liked: result.liked, likeCount: result.count } : current);
    } catch (error) { setError((error as Error).message); }
  }
  async function remove(comment: Comment) {
    if (!window.confirm('이 댓글을 삭제할까요? 달린 답글은 남으며 삭제한 내용은 복구할 수 없습니다.')) return;
    try { await write(`${path}/comments/${comment.id}`, 'DELETE'); savedComment(); }
    catch (error) { setError((error as Error).message); }
  }

  function renderComment(comment: Comment, rootId: string) {
    const editing = action?.comment.id === comment.id && action.kind !== 'reply';
    return <article id={`comment-${comment.id}`} className="comment-entry" tabIndex={-1}>
      {comment.isDeleted ? <p className="comment-deleted">삭제된 댓글입니다.</p> : <>
        <div className="comment-meta"><strong>{comment.authorName}</strong>
          <span>{comment.isGuest ? '비회원' : comment.isAuthor ? '글 작성자' : '회원'}</span><time dateTime={comment.createdAt}>{date(comment.createdAt)}</time>
          {comment.updatedAt !== comment.createdAt && <span>수정됨</span>}</div>
        {!editing && <p className="comment-content">{comment.replyToName && <span className="comment-mention">@{comment.replyToName} </span>}{comment.content}</p>}
        {editing ? comment.isGuest ? <GuestCommentForm key={`${comment.id}-${action.kind}`} postId={postId} commentId={comment.id}
          initial={comment.content} mode={action.kind === 'delete' ? 'delete' : 'edit'} login={login} onCancel={() => chooseAction(null)} onSaved={savedComment} />
          : session && <CommentForm key={comment.id} storageKey={`ggeujeok-comment-edit:${comment.id}`} initial={comment.content}
            session={session} login={login} disabled={busy || loading} editing onCancel={() => chooseAction(null)}
            onSubmit={async content => { await write(`${path}/comments/${comment.id}`, 'PUT', { content }); savedComment(); }} />
          : <div className="comment-actions">
            {data?.commentsEnabled && <button className="text-button" disabled={busy || loading} onClick={() => {
              chooseAction({ kind: 'reply', comment, rootId });
              if (expanded?.id !== rootId) setExpanded({ id: rootId, page: 1 });
            }}><Reply aria-hidden="true" />답글</button>}
            {comment.isGuest && <>
              <button className="text-button" disabled={busy || loading} onClick={() => chooseAction({ kind: 'edit', comment, rootId })}><Pencil aria-hidden="true" />비회원 수정</button>
              <button className="text-button" disabled={busy || loading} onClick={() => chooseAction({ kind: 'delete', comment, rootId })}><Trash2 aria-hidden="true" />비회원 삭제</button>
            </>}
            {comment.canEdit && <button className="text-button" disabled={busy || loading} onClick={() => chooseAction({ kind: 'edit', comment, rootId })}><Pencil aria-hidden="true" />수정</button>}
            {comment.canDelete && <button className="text-button danger" disabled={busy || loading} onClick={() => remove(comment)}><Trash2 aria-hidden="true" />삭제</button>}
          </div>}
      </>}
    </article>;
  }

  return <section id="comments" className="post-interactions" aria-labelledby="comments-heading">
    <div className="interaction-heading"><h2 id="comments-heading">댓글{data ? ` ${data.commentCount}` : ''}</h2>
      {data && (session?.user ? <button type="button" className="secondary" aria-pressed={data.liked} disabled={busy || loading} onClick={like}><Heart aria-hidden="true" fill={data.liked ? 'currentColor' : 'none'} />좋아요 {data.likeCount}</button>
        : <a className="button secondary" href={login}><Heart aria-hidden="true" fill={data.liked ? 'currentColor' : 'none'} />좋아요 {data.likeCount} · 로그인</a>)}
    </div>
    {error && <div className="notice error" role="alert"><p>{error}</p><button className="text-button" disabled={loading} onClick={() => setRetry(value => value + 1)}><RefreshCw aria-hidden="true" />다시 불러오기</button></div>}
    {linkError&&<p className="notice" role="status">{linkError}</p>}
    {loading && <p role="status" className="field-help">댓글을 불러오는 중…</p>}
    {data && !data.commentsEnabled && <p className="notice" role="status">이 글은 새 댓글과 답글을 받지 않습니다.</p>}
    {data?.commentsEnabled && !action && session?.user && <CommentForm storageKey={`ggeujeok-comment:${postId}`} session={session} login={login} disabled={busy || loading || !data || !session.user.nickname}
      onSubmit={async (content, requestId) => { await write(`${path}/comments`, 'POST', { content, requestId }); savedRoot(); }} />}
    {data?.commentsEnabled && !action && session && !session.user && <GuestCommentForm postId={postId} login={login} onSaved={savedRoot} />}
    {data && <><ul className="comment-list">{data.comments.map(comment => <li key={comment.id}>
      {renderComment(comment, comment.id)}
      {!!comment.replyCount && <button className="text-button reply-toggle" aria-expanded={expanded?.id === comment.id}
        onClick={() => setExpanded(expanded?.id === comment.id ? null : { id: comment.id, page: 1 })}>
        <ChevronDown aria-hidden="true" />답글 {comment.replyCount}개 {expanded?.id === comment.id ? '접기' : '보기'}</button>}
      {expanded?.id === comment.id && <div className="comment-replies">
        {replyError ? <p role="alert" className="field-help">{replyError} <button className="text-button" onClick={() => setRetry(value => value + 1)}>답글 다시 불러오기</button></p>
          : !replies ? <p role="status" className="field-help">답글을 불러오는 중…</p>
          : <><ul>{replies.items.map(reply => <li key={reply.id}>{renderComment(reply, comment.id)}</li>)}</ul>
            {replies.total > 20 && <nav className="pagination" aria-label="답글 페이지">
              <button className="text-button" disabled={expanded.page === 1} onClick={() => setExpanded({ id: comment.id, page: expanded.page - 1 })}><ChevronLeft aria-hidden="true" />이전 답글</button>
              <span>{expanded.page}</span><button className="text-button" disabled={expanded.page * 20 >= replies.total} onClick={() => setExpanded({ id: comment.id, page: expanded.page + 1 })}>다음 답글<ChevronRight aria-hidden="true" /></button>
            </nav>}</>}
      </div>}
      {data.commentsEnabled && action?.kind === 'reply' && action.rootId === comment.id && session && <div className="reply-composer">
        <p className="reply-context"><span>@{action.comment.authorName}</span> 님에게 답글</p>
        {session.user ? <CommentForm key={action.comment.id} storageKey={`ggeujeok-comment-reply:${action.comment.id}`}
          session={session} login={login} disabled={busy || loading || !session.user.nickname} replying onCancel={() => chooseAction(null)}
          onSubmit={async (content, requestId) => {
            await write(`${path}/comments`, 'POST', { content, requestId, parentId: comment.id, replyToId: action.comment.id }); savedReply(comment.id);
          }} />
          : <GuestCommentForm key={action.comment.id} postId={postId} parentId={comment.id} replyToId={action.comment.id} login={login}
            onCancel={() => chooseAction(null)} onSaved={() => savedReply(comment.id)} />}
      </div>}
    </li>)}</ul>
      {!data.commentCount && <p className="field-help">아직 댓글이 없습니다.</p>}
      {action?.kind === 'reply' && !data.comments.some(comment => comment.id === action.rootId) && <p className="field-help">
        답글을 작성하던 댓글이 이 페이지에 없습니다. <button className="text-button" onClick={() => chooseAction(null)}>답글 작성 닫기</button></p>}
      {(page > 1 || data.threadCount > 20) && <nav className="pagination" aria-label="댓글 페이지">
        <button className="text-button" disabled={busy || loading || page === 1} onClick={() => { chooseAction(null); setExpanded(null); setPage(page - 1); }}><ChevronLeft aria-hidden="true" />이전 댓글</button>
        <span>{page}</span><button className="text-button" disabled={busy || loading || page * 20 >= data.threadCount} onClick={() => { chooseAction(null); setExpanded(null); setPage(page + 1); }}>다음 댓글<ChevronRight aria-hidden="true" /></button>
      </nav>}
    </>}
  </section>;
}
