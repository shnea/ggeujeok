'use client';

import { RefreshCw, CheckCheck, Check, LogIn, Pencil, Trash2, HeartOff, ChevronLeft, ChevronRight } from 'lucide-react';


import { useEffect, useState } from 'react';
import { api, ApiError, mutation, type Session } from '@/lib/api';
import { CommentForm } from '@/components/comment-form';
import { MeNavigation } from './me-navigation';
import { PostImage } from '@/components/post-image';

type Kind='comments'|'likes'|'notifications';
type Item={id:string;postId:string;title:string;slug:string;status:string;createdAt:string;updatedAt?:string;
  content?:string;parentId?:string|null;summary?:string;thumbnailId?:string|null;kind?:'COMMENT'|'REPLY';
  commentId?:string;actorName?:string;readAt?:string|null};
type List={items:Item[];total:number;page:number;unread?:number};
const titles:Record<Kind,string>={comments:'내 댓글',likes:'좋아요한 글',notifications:'알림'};
const date=(value:string)=>new Intl.DateTimeFormat('ko-KR',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value));
const notifyHeader=()=>window.dispatchEvent(new Event('ggeujeok:notifications-changed'));

export function ActivityView({kind}:{kind:Kind}) {
  const [session,setSession]=useState<Session|null>(null),[data,setData]=useState<List|null>(null);
  const [page,setPage]=useState(1),[revision,setRevision]=useState(0),[editing,setEditing]=useState<string|null>(null);
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[loginRequired,setLoginRequired]=useState(false);
  const login=`/login?returnTo=${encodeURIComponent(`/me/${kind}`)}`;
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setError('');
    Promise.all([api<Session>('/api/auth/session',{signal:controller.signal}),api<List>(`/api/me/${kind}?page=${page}`,{signal:controller.signal})])
      .then(([session,list])=>{
        if(controller.signal.aborted)return;
        setSession(session);setData(list);setLoginRequired(false);
        if(page>1&&!list.items.length)setPage(Math.max(1,Math.ceil(list.total/20)));
        if(kind==='notifications')notifyHeader();
      }).catch(error=>{if(!controller.signal.aborted){setData(null);setError(error.message);setLoginRequired(error instanceof ApiError&&error.status===401);}})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return ()=>controller.abort();
  },[kind,page,revision]);

  async function change(path:string,method:string,body?:unknown) {
    setBusy(true);setError('');
    try {return await api(path,mutation(method,session!.csrfToken!,body));}
    catch(error){setError((error as Error).message);if(error instanceof ApiError&&error.status===401)setLoginRequired(true);throw error;}
    finally{setBusy(false);}
  }
  function refresh(){setEditing(null);setRevision(value=>value+1);}
  function href(item:Item) {
    if(item.status!=='PUBLIC')return kind==='likes'?`/admin/posts/${item.postId}`:`/admin/comments?comment=${item.commentId||item.id}`;
    return `/posts/${item.slug}${kind==='likes'?'':`#comment-${item.commentId||item.id}`}`;
  }
  async function mark(item?:Item) {
    try {await change(item?`/api/me/notifications/${item.id}/read`:'/api/me/notifications/read-all','POST');refresh();notifyHeader();}catch{/* Shared error is visible above the list. */}
  }
  async function openNotification(item:Item) {
    setBusy(true);setError('');
    try {
      const destination=await api<{href:string}>(`/api/me/notifications/${item.id}/destination`);
      await api(`/api/me/notifications/${item.id}/read`,mutation('POST',session!.csrfToken!));
      notifyHeader();window.location.assign(destination.href);
    }catch(error){setError((error as Error).message);setBusy(false);}
  }
  async function remove(item:Item) {
    if(kind==='comments'&&!window.confirm('댓글을 삭제할까요? 달린 답글은 남습니다.'))return;
    try {await change(kind==='comments'?`/api/posts/${item.postId}/comments/${item.id}`:`/api/posts/${item.postId}/like`,'DELETE');refresh();}
    catch{/* Shared error is visible above the list. */}
  }

  return <>
    <MeNavigation current={kind} />
    <div className="my-list-heading"><h2>{titles[kind]}{data&&<span className="my-total">{data.total}</span>}</h2>
      <div className="button-row"><button className="text-button" disabled={loading||busy} onClick={refresh}><RefreshCw aria-hidden="true" />새로고침</button>
        {kind==='notifications'&&data&&<button className="secondary" disabled={loading||busy||!data.unread} onClick={()=>void mark()}><CheckCheck aria-hidden="true" />모두 읽음</button>}</div>
    </div>
    {kind==='notifications'&&data&&<p className="field-help">읽지 않은 알림 {data.unread}개 · 최근 90일</p>}
    {loginRequired?<div className="empty-state"><p>로그인하면 내 활동을 확인할 수 있습니다.</p><a className="button" href={login}><LogIn aria-hidden="true" />로그인</a></div>
      :error&&<div className="notice error" role="alert"><p>{error}</p><button className="text-button" disabled={loading||busy} onClick={refresh}><RefreshCw aria-hidden="true" />다시 불러오기</button></div>}
    {loading&&<p role="status" className="field-help">불러오는 중…</p>}
    {data&&!loginRequired&&<>
      <ul className="my-list">{data.items.map(item=><li key={kind==='likes'?item.postId:item.id} className={kind==='notifications'&&!item.readAt?'is-unread':undefined}>
        <div className="my-item-main">
          <div className="my-item-meta"><span>{kind==='comments'?item.parentId?'답글':'댓글':kind==='notifications'?item.kind==='REPLY'?'내 댓글에 답글':'내 글에 댓글':'좋아요한 글'}</span>
            {item.status!=='PUBLIC'&&<span>비공개 · 관리자 열람</span>}
            <time dateTime={item.createdAt}>{date(item.createdAt)}</time>
            {kind==='notifications'&&<span className={!item.readAt?'unread-label':undefined}>{item.readAt?'읽음':'읽지 않음'}</span>}
          </div>
          <h3><a href={href(item)} onClick={kind==='notifications'?event=>{if(event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;event.preventDefault();if(!busy)void openNotification(item);}:undefined}>{item.title}</a></h3>
          {editing===item.id&&session?<CommentForm storageKey={`ggeujeok-comment-edit:${item.id}`} initial={item.content} session={session} login={login} disabled={busy} editing
            onCancel={()=>setEditing(null)} onSubmit={async content=>{await change(`/api/posts/${item.postId}/comments/${item.id}`,'PUT',{content});refresh();}} />
            :<p className="my-item-excerpt">{kind==='notifications'&&<strong>{item.actorName} · </strong>}{kind==='likes'?item.summary:item.content}</p>}
          <div className="comment-actions">
            {kind==='comments'&&editing!==item.id&&<>{item.status==='PUBLIC'&&<button className="text-button" disabled={busy||loading} onClick={()=>setEditing(item.id)}><Pencil aria-hidden="true" />수정</button>}
              <button className="text-button danger" disabled={busy||loading} onClick={()=>void remove(item)}><Trash2 aria-hidden="true" />삭제</button>
              <a className="text-button" href={href(item)}>원문 보기</a></>}
            {kind==='likes'&&item.status==='PUBLIC'&&<button className="text-button" disabled={busy||loading} onClick={()=>void remove(item)}><HeartOff aria-hidden="true" />좋아요 취소</button>}
            {kind==='notifications'&&!item.readAt&&<button className="text-button" disabled={busy||loading} onClick={()=>void mark(item)}><Check aria-hidden="true" />읽음으로 표시</button>}
          </div>
        </div>
        {kind==='likes'&&item.thumbnailId&&item.status==='PUBLIC'&&<a className="my-cover" href={href(item)} tabIndex={-1} aria-hidden="true"><PostImage src={`/api/public/posts/${item.slug}/image`} alt="" className="my-cover-image" /></a>}
      </li>)}</ul>
      {!data.total&&<div className="empty-state"><p>{kind==='comments'?'아직 작성한 댓글이 없습니다.':kind==='likes'?'아직 좋아요한 글이 없습니다.':'새로운 알림이 없습니다.'}</p><a href="/">글 보러 가기</a></div>}
      {(page>1||data.total>20)&&<nav className="pagination" aria-label={`${titles[kind]} 페이지`}><button className="text-button" disabled={loading||busy||page===1} onClick={()=>{setEditing(null);setPage(page-1);}}><ChevronLeft aria-hidden="true" />이전</button>
        <span>{page}</span><button className="text-button" disabled={loading||busy||page*20>=data.total} onClick={()=>{setEditing(null);setPage(page+1);}}><ChevronRight aria-hidden="true" />다음</button></nav>}
    </>}
  </>;
}
