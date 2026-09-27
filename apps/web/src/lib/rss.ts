import type { PublicPost } from './api';

// XML 1.0 excludes control characters and unpaired surrogates, even in CDATA.
export function xml(value: string) {
  return value.replace(/[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu, '')
    .replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!);
}

export function rss(posts: PublicPost[], site: { url: string; name: string; author: string; description?: string }) {
  const items = posts.map(post => {
    const url = `${site.url}/posts/${post.slug}`;
    // RSS descriptions are HTML: escape the plain text, then the containing XML.
    return `<item><title>${xml(post.title)}</title><link>${xml(url)}</link><guid isPermaLink="true">${xml(url)}</guid>
      <description>${xml(xml(post.summary))}</description><pubDate>${new Date(post.publishedAt).toUTCString()}</pubDate>
      <category>${xml(post.categoryName)}</category><dc:creator>${xml(site.author)}</dc:creator></item>`;
  }).join('\n');
  const modified = posts.length ? new Date(Math.max(...posts.map(post => Date.parse(post.updatedAt)))).toUTCString() : null;
  return `<?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">
    <channel><title>${xml(site.name)}</title><link>${xml(site.url)}/</link><description>${xml(site.description ?? `${site.name}의 최근 공개 글`)}</description>
      <language>ko-KR</language><atom:link href="${xml(site.url)}/rss.xml" rel="self" type="application/rss+xml"/>
      ${modified ? `<lastBuildDate>${modified}</lastBuildDate>` : ''}${items}</channel></rss>`;
}
