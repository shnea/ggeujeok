import { Search } from 'lucide-react';
import type { Metadata } from 'next';
import { serverApi, siteUrl } from '@/lib/server-api';
import type { Category, PostList } from '@/lib/api';
import { PostFeed } from '@/components/post-feed';
import { adSettings } from '@/lib/site-info';

type Search = { q?: string; category?: string; tag?: string; page?: string };
export async function generateMetadata({ searchParams }: { searchParams: Promise<Search> }): Promise<Metadata> {
  const search = await searchParams;
  const params = new URLSearchParams();
  for (const key of ['category', 'tag', 'q'] as const) {
    if (typeof search[key] === 'string' && search[key]!.trim()) params.set(key, search[key]!.trim());
  }
  if (typeof search.page === 'string' && /^\d+$/.test(search.page) && Number(search.page) > 1) params.set('page', String(Number(search.page)));
  const url = `${siteUrl()}/${params.size ? `?${params}` : ''}`;
  return { alternates: { canonical: url }, ...(params.has('q') ? { robots: { index: false, follow: true } } : {}) };
}
export default async function Home({ searchParams }: { searchParams: Promise<Search> }) {
  const search = await searchParams;
  const params = new URLSearchParams();
  for (const key of ['q', 'category', 'tag', 'page'] as const) if (typeof search[key] === 'string') params.set(key, search[key]!);
  const [posts, categories, ads] = await Promise.all([
    serverApi<PostList>(`/api/public/posts?${params}`), serverApi<Category[]>('/api/public/categories'),
    adSettings(),
  ]);
  return <div className="home">
    <h1 className="sr-only">글 목록</h1>
    <div className="browse-bar"><nav className="category-nav" aria-label="카테고리">
      <a aria-current={!search.category ? 'page' : undefined} href="/">모든 글</a>
      {categories.map(category => <a key={category.id} aria-current={search.category === category.slug ? 'page' : undefined}
        href={`/?category=${category.slug}`}>{category.name}</a>)}
    </nav><form className="search" action="/"><label className="sr-only" htmlFor="search">글 검색</label>
      <input id="search" name="q" type="search" maxLength={100} placeholder="기록에서 찾기" defaultValue={search.q || ''} />
      <button type="submit" aria-label="검색"><Search aria-hidden="true" /></button>
    </form></div>
    <section aria-label="게시글 목록">
      {search.q && <p className="search-result">‘{search.q}’ 검색 결과 <strong>{posts.total}</strong>개 <a href="/">검색 지우기</a></p>}
      {posts.items.length ? <PostFeed key={params.toString()} initial={posts} query={params.toString()} ad={ads.feed} />
        : <div className="empty-state"><h2>{search.q || search.category || search.tag ? '조건에 맞는 글이 없습니다.' : '아직 공개된 글이 없습니다.'}</h2>
          {search.q && <p>다른 검색어를 입력해 주세요.</p>}<a href="/">모든 글 보기</a></div>}
    </section>
  </div>;
}
