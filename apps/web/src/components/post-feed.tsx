'use client';

import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { ListOrdered, Infinity as InfinityIcon, RefreshCw, ChevronDown } from 'lucide-react';
import { api, type PostList } from '@/lib/api';
import type { AdPlacement } from '@/lib/ads-config';
import { PostImage } from './post-image';
import { FeedAd } from './feed-ad';

type Mode = 'pages' | 'infinite';
const preferenceKey = 'ggeujeok-list-mode';

export function PostFeed({ initial, query, ad }: { initial: PostList; query: string; ad: AdPlacement | null }) {
  const [mode, setMode] = useState<Mode>('pages');
  const [items, setItems] = useState(initial.items), [page, setPage] = useState(initial.page);
  const [hasMore, setHasMore] = useState(initial.page * 12 < initial.total);
  const [loading, setLoading] = useState(false), [error, setError] = useState('');
  const flight = useRef<AbortController | null>(null), sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    try { if (localStorage.getItem(preferenceKey) === 'infinite') setMode('infinite'); } catch { /* Browsing works without storage. */ }
    return () => { flight.current?.abort(); flight.current = null; };
  }, []);

  function selectMode(next: Mode) {
    if (next === mode) return;
    flight.current?.abort(); flight.current = null;
    setLoading(false); setError(''); setMode(next);
    // Switching back to pages restores the page identified by the address bar.
    setItems(initial.items); setPage(initial.page); setHasMore(initial.page * 12 < initial.total);
    try { localStorage.setItem(preferenceKey, next); } catch { /* Keep the selection for this page. */ }
  }
  const loadMore = useCallback(async () => {
    if (flight.current || !hasMore) return;
    const controller = new AbortController(); flight.current = controller; setLoading(true); setError('');
    const params = new URLSearchParams(query); params.set('page', String(page + 1));
    try {
      const result = await api<PostList>(`/api/public/posts?${params}`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setItems(current => [...new Map([...current, ...result.items].map(post => [post.id, post])).values()]);
      setPage(result.page); setHasMore(result.items.length > 0 && result.page * 12 < result.total);
    } catch (error) { if (!controller.signal.aborted) setError((error as Error).message); }
    finally { if (flight.current === controller) { flight.current = null; setLoading(false); } }
  }, [hasMore, page, query]);
  useEffect(() => {
    if (mode !== 'infinite' || !hasMore || loading || error || !sentinel.current || !('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) void loadMore(); }, { rootMargin: '300px' });
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [mode, hasMore, loading, error, loadMore]);
  const visible = mode === 'pages' ? initial.items : items;
  const pageHref = (number: number) => { const params = new URLSearchParams(query); params.set('page', String(number)); return `/?${params}`; };

  return <>
    <div className="feed-toolbar"><div className="feed-mode" role="group" aria-label="글 목록 보기 방식">
      <button className="text-button" aria-pressed={mode === 'pages'} onClick={() => selectMode('pages')}><ListOrdered aria-hidden="true" />페이지</button>
      <button className="text-button" aria-pressed={mode === 'infinite'} onClick={() => selectMode('infinite')}><InfinityIcon aria-hidden="true" />무한 스크롤</button>
    </div></div>
    <div className="post-list">{visible.map((post, index) => <Fragment key={post.id}><article className={`post-row${post.thumbnailId ? ' has-cover' : ''}`}>
      <div className="post-copy"><div className="post-meta"><span>{post.categoryName}</span>{post.aiGenerated&&<span className="ai-badge">AI 작성</span>}<time dateTime={post.publishedAt}>{new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeZone: 'Asia/Seoul' }).format(new Date(post.publishedAt))}</time></div>
        <h2><a href={`/posts/${post.slug}`}>{post.title}</a></h2><p>{post.aiSummary&&<span className="ai-badge">AI 요약</span>} {post.summary}</p>
        {post.tags.length > 0 && <ul className="tags">{post.tags.map(tag => <li key={tag.slug}><a href={`/?tag=${tag.slug}`}>#{tag.name}</a></li>)}</ul>}</div>
      {post.thumbnailId && <a className="post-cover-link" href={`/posts/${post.slug}`} aria-label={`${post.title} 읽기`}><PostImage src={`/api/public/posts/${post.slug}/image`} alt="" className="post-cover" /></a>}
    </article>{index === 2 && visible.length >= 4 && ad && <FeedAd ad={ad} />}</Fragment>)}</div>
    {mode === 'pages' ? (initial.page > 1 || initial.total > 12) && <nav className="pagination" aria-label="페이지 이동">
      {initial.page > 1 && <a href={pageHref(initial.page - 1)}>이전</a>}<span>{initial.page}</span>
      {initial.page * 12 < initial.total && <a href={pageHref(initial.page + 1)}>다음</a>}
    </nav> : <div ref={sentinel} className="feed-load-more">
      <p role="status">{loading ? '다음 글을 불러오는 중…' : error ? '' : hasMore ? `${visible.length}개의 글을 보고 있습니다.` : '마지막 글까지 모두 보았습니다.'}</p>
      {error && <p role="alert" className="error">{error}</p>}
      {hasMore && <button className="secondary" disabled={loading} onClick={() => void loadMore()}>{error ? <RefreshCw aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}{error ? '다시 불러오기' : '더 불러오기'}</button>}
      {initial.page > 1 && <a href={pageHref(1)}>첫 페이지부터 보기</a>}
    </div>}
  </>;
}
