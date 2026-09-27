import { cache } from 'react';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { ApiError, type PublicPost } from '@/lib/api';
import { serverApi, siteUrl } from '@/lib/server-api';
import { DocumentViewer } from '@/components/document-viewer';
import { DesktopAd, PostAd } from '@/components/post-ad';
import { adSettings, getSiteInfo } from '@/lib/site-info';
import { documentImages } from '@/lib/document-images';
import { PostImage } from '@/components/post-image';
import { PostInteractions } from '@/components/post-interactions';

const getPost = cache(async (slug: string) => {
  try { return await serverApi<PublicPost>(`/api/public/posts/${encodeURIComponent(slug)}`); }
  catch (error) { if (error instanceof ApiError && (error.status === 404 || error.status === 400)) notFound(); throw error; }
});
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const siteInfo = await getSiteInfo();
  const post = await getPost((await params).slug);
  const url = `${siteUrl()}/posts/${post.slug}`;
  const image = post.thumbnailId ? `${siteUrl()}/api/public/posts/${post.slug}/image` : siteInfo.imageUrl || `${siteUrl()}/default-og.png`;
  return { title: post.title, description: post.summary, alternates: { canonical: url },
    authors: [{ name: siteInfo.operator }],
    twitter: { card: 'summary_large_image', title: post.title, description: post.summary, images: [image] },
    openGraph: { title: post.title, description: post.summary, url, type: 'article', publishedTime: post.publishedAt, modifiedTime: post.updatedAt,
      siteName: siteInfo.name, locale: 'ko_KR', authors: [siteInfo.operator],
      images: [{ url: image, alt: post.thumbnailId ? `${post.title} 대표 이미지` : siteInfo.name }] } };
}
export default async function PostPage({ params }: { params: Promise<{ slug: string }> }) {
  const siteInfo = await getSiteInfo();
  const post = await getPost((await params).slug);
  const [related, neighbors, ads] = await Promise.all([
    serverApi<PublicPost[]>(`/api/public/posts/${post.slug}/related`),
    serverApi<{ previous: { slug: string; title: string } | null; next: { slug: string; title: string } | null }>(`/api/public/posts/${post.slug}/neighbors`),
    adSettings(),
  ]);
  const structured = { '@context': 'https://schema.org', '@type': 'BlogPosting', headline: post.title,
    description: post.summary, datePublished: post.publishedAt, dateModified: post.updatedAt,
    author: { '@type': 'Person', name: siteInfo.operator, url: `${siteUrl()}/about` }, mainEntityOfPage: `${siteUrl()}/posts/${post.slug}`,
    ...(post.thumbnailId ? { image: `${siteUrl()}/api/public/posts/${post.slug}/image` } : {}) };
  return <div className={`post-layout${ads.sidebar ? ' has-sidebar' : ''}`}><article className="article-page"><a className="back-link" href="/">모든 기록으로</a>
    <header className="article-header"><h1>{post.title}</h1><p className="article-summary">{post.summary}</p>
      <div className="post-meta"><a href={`/?category=${post.categorySlug}`}>{post.categoryName}</a>
        <time dateTime={post.publishedAt}>{new Intl.DateTimeFormat('ko-KR', { dateStyle: 'long', timeZone: 'Asia/Seoul' }).format(new Date(post.publishedAt))}</time></div>
    </header>{post.thumbnailId && !documentImages(post.content!).some(image => image.fileId === post.thumbnailId) &&
      <PostImage src={`/api/public/posts/${post.slug}/image`} alt={`${post.title} 대표 이미지`} className="article-cover" eager />}
    <div className="article-body"><DocumentViewer content={post.content} inlineAd={ads.inline ?? undefined} /></div>
    <ul className="tags">{post.tags.map(tag => <li key={tag.slug}><a href={`/?tag=${tag.slug}`}>#{tag.name}</a></li>)}</ul>
    {ads.post && <PostAd {...ads.post} />}
    {(neighbors.previous || neighbors.next) && <nav className="post-neighbors" aria-label="이전 다음 글">
      {neighbors.previous && <a href={`/posts/${neighbors.previous.slug}`}><span>이전 글</span>{neighbors.previous.title}</a>}
      {neighbors.next && <a href={`/posts/${neighbors.next.slug}`}><span>다음 글</span>{neighbors.next.title}</a>}
    </nav>}
    <PostInteractions postId={post.id} slug={post.slug} />
    {related.length > 0 && <section className="related-posts" aria-labelledby="related-heading"><h2 id="related-heading">관련 글</h2>
      <ul>{related.map(item => <li key={item.id}><a href={`/posts/${item.slug}`}>{item.title}</a>
        <div className="post-meta"><span>{item.categoryName}</span><time dateTime={item.publishedAt}>
          {new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeZone: 'Asia/Seoul' }).format(new Date(item.publishedAt))}
        </time></div></li>)}</ul>
    </section>}
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structured).replace(/</g, '\\u003c') }} />
  </article>{ads.sidebar && <div className="post-sidebar"><DesktopAd {...ads.sidebar} /></div>}</div>;
}
