'use client';

import { RefreshCw, Trash2, ChevronLeft, ChevronRight } from 'lucide-react';

import { useEffect, useState } from 'react';
import { api, mutation, type Session } from '@/lib/api';

type Comment = {id:string;postId:string;content:string;authorName:string;isGuest:boolean;createdAt:string;title:string;status:string;slug:string};
export default function CommentsPage() {
  const [session,setSession] = useState<Session|null>(null), [data,setData] = useState<{items:Comment[];total:number}|null>(null);
  const [page,setPage] = useState(1), [retry,setRetry] = useState(0), [error,setError] = useState(''), [busy,setBusy] = useState(false);
  useEffect(()=>{
    const controller = new AbortController(); setBusy(true);
    const target=new URLSearchParams(window.location.search).get('comment');
    Promise.all([api<Session>('/api/auth/session',{signal:controller.signal}),api<{items:Comment[];total:number}>(`/api/admin/comments?page=${page}${target?`&comment=${encodeURIComponent(target)}`:''}`,{signal:controller.signal})])
      .then(([session,data])=>{if(!controller.signal.aborted){setSession(session);setData(data);setError('');if(page>1 && !data.items.length)setPage(Math.max(1,Math.ceil(data.total/20)));}})
      .catch(error=>{if(!controller.signal.aborted){setData(null);setError(error.message);}}).finally(()=>{if(!controller.signal.aborted)setBusy(false);});
    return ()=>controller.abort();
  },[page,retry]);
  async function remove(comment:Comment) {
    if(!window.confirm('이 댓글을 삭제할까요? 삭제한 댓글은 복구할 수 없습니다.'))return;
    setBusy(true);
    try {await api(`/api/posts/${comment.postId}/comments/${comment.id}`,mutation('DELETE',session!.csrfToken!));setRetry(value=>value+1);}
    catch(error){setError((error as Error).message);setBusy(false);}
  }
  return <section className="admin-page"><nav className="admin-nav" aria-label="관리 메뉴"><a href="/admin">글 관리</a><a href="/admin/categories">카테고리</a><a href="/admin/comments" aria-current="page">댓글 관리</a><a href="/admin/statistics">방문 통계</a><a href="/admin/settings">설정</a></nav>
    <h1>댓글 관리</h1><p className="field-help">공개·비공개 글의 회원·비회원 댓글을 확인하고 삭제합니다. <a href="/admin/comments">전체 댓글 보기</a></p>
    {error && <div className="notice error" role="alert"><p>{error}</p><button className="text-button" disabled={busy} onClick={()=>setRetry(value=>value+1)}><RefreshCw aria-hidden="true" />다시 불러오기</button></div>}
    {busy && <p role="status">처리 중…</p>}
    {data && <><p className="field-help">댓글 {data.total}개</p><ul className="comment-list">{data.items.map(comment=><li key={comment.id}>
      <a href={comment.status==='PUBLIC'?`/posts/${comment.slug}#comment-${comment.id}`:`/admin/posts/${comment.postId}`}>{comment.title}</a>
      <div className="comment-meta"><strong>{comment.authorName}</strong><span>{comment.isGuest?'비회원':'회원'}</span><span>{comment.status==='PUBLIC'?'공개 글':'비공개 글'}</span>
        <time dateTime={comment.createdAt}>{new Date(comment.createdAt).toLocaleString('ko-KR')}</time></div>
      <p className="comment-content">{comment.content}</p><button className="text-button danger" disabled={busy} onClick={()=>remove(comment)}><Trash2 aria-hidden="true" />댓글 삭제</button></li>)}</ul>
      {!data.total && <p className="empty-state">등록된 댓글이 없습니다.</p>}
      {(page>1 || data.total>20) && <nav className="pagination" aria-label="관리 댓글 페이지"><button className="text-button" disabled={busy || page===1} onClick={()=>setPage(page-1)}><ChevronLeft aria-hidden="true" />이전</button>
        <span>{page}</span><button className="text-button" disabled={busy || page*20>=data.total} onClick={()=>setPage(page+1)}><ChevronRight aria-hidden="true" />다음</button></nav>}</>}
  </section>;
}
