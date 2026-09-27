import type { PublicPost } from '@/lib/api';
import { serverApi, siteUrl } from '@/lib/server-api';
import { getSiteInfo } from '@/lib/site-info';
import { rss } from '@/lib/rss';

export const dynamic = 'force-dynamic';
export async function GET() {
  const siteInfo = await getSiteInfo();
  const posts = await serverApi<PublicPost[]>('/api/public/feed');
  return new Response(rss(posts, { url: siteUrl(), name: siteInfo.name, author: siteInfo.operator, description: siteInfo.description }), {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}
