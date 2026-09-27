import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rss, xml } from '../src/lib/rss';
import type { PublicPost } from '../src/lib/api';

test('RSS preserves plain text safely, valid XML characters, stable URLs and dates', () => {
  const post: PublicPost = { id: 'fixture', slug: 'test-post', title: '한글 & <제목> 😀\u0001\ud800',
    summary: '<img src=x onerror=alert(1)> & 요약 ]]> ', publishedAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-27T01:00:00Z',
    categoryName: '분류 & 자료', categorySlug: 'notes', thumbnailId: null, tags: [] };
  const result = rss([post], { url: 'https://shnea.kr', name: '끄적', author: '끄적 운영자' });
  assert.ok(result.includes('<title>한글 &amp; &lt;제목&gt; 😀</title>'));
  assert.ok(result.includes('&amp;lt;img src=x onerror=alert(1)&amp;gt;'));
  assert.ok(!result.includes('<img'));
  assert.ok(result.includes('<pubDate>Tue, 01 Sep 2026 00:00:00 GMT</pubDate>'));
  assert.ok(result.includes('<lastBuildDate>Sun, 27 Sep 2026 01:00:00 GMT</lastBuildDate>'));
  assert.ok(result.includes('<guid isPermaLink="true">https://shnea.kr/posts/test-post</guid>'));
  assert.ok(result.includes('<dc:creator>끄적 운영자</dc:creator>'));
  assert.equal(xml('"\'\u0000\t\n'), '&quot;&apos;\t\n');
  assert.ok(!rss([], { url: 'https://shnea.kr', name: '끄적', author: '끄적 운영자' }).includes('<item>'));
});
