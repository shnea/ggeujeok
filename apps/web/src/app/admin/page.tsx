'use client';

import { Plus, LogIn } from 'lucide-react';

import { useEffect, useState } from 'react';
import { api, mutation, type Session } from '@/lib/api';

type PostRow = { id: string; title: string; status: 'DRAFT' | 'PUBLIC' | 'PRIVATE'; updatedAt: string; draftUpdatedAt: string };
const labels = { DRAFT: '초안', PUBLIC: '공개', PRIVATE: '비공개' };
export default function AdminPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [posts, setPosts] = useState<PostRow[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    api<Session>('/api/auth/session').then(async result => {
      setSession(result);
      if (result.user?.isAdmin) setPosts(await api<PostRow[]>('/api/admin/posts'));
    }).catch(error => setError(error.message)).finally(() => setLoading(false));
  }, []);
  async function create() {
    setCreating(true); setError('');
    try { const result = await api<{ id: string }>('/api/admin/posts', mutation('POST', session!.csrfToken!)); window.location.assign(`/admin/posts/${result.id}`); }
    catch (error) { setError((error as Error).message); setCreating(false); }
  }
  if (loading) return <p className="loading" role="status">글 관리 화면을 불러오는 중…</p>;
  if (!session?.user?.isAdmin) return <section className="message-page"><h1>글 관리</h1><p>{session?.user ? '지정된 관리자만 글을 관리할 수 있습니다.' : '글을 작성하려면 관리자 계정으로 로그인해 주세요.'}</p>
    {error && <p role="alert">{error}</p>}<a className="button" href="/login"><LogIn aria-hidden="true" />로그인 화면으로</a></section>;
  return <section className="admin-page"><nav className="admin-nav" aria-label="관리 메뉴"><a href="/admin" aria-current="page">글 관리</a><a href="/admin/categories">카테고리</a><a href="/admin/comments">댓글 관리</a><a href="/admin/settings">설정</a></nav>
    <div className="page-heading"><div><h1>글 관리</h1><p>초안과 공개 글을 관리합니다.</p></div><button disabled={creating} onClick={create}><Plus aria-hidden="true" />{creating ? '만드는 중…' : '새 글 쓰기'}</button></div>
    {error && <p className="notice error" role="alert">{error}</p>}
    {!posts.length ? <div className="empty-state"><h2>아직 작성한 글이 없습니다.</h2></div>
      : <ul className="admin-posts">{posts.map(post => <li key={post.id}><a href={`/admin/posts/${post.id}`}><span className={`status ${post.status.toLowerCase()}`}>{labels[post.status]}</span><h2>{post.title}</h2>
        <time dateTime={post.draftUpdatedAt || post.updatedAt}>{new Date(post.draftUpdatedAt || post.updatedAt).toLocaleDateString('ko-KR')}</time><span className="edit-label">이어서 쓰기</span></a></li>)}</ul>}
  </section>;
}
