import type { MetadataRoute } from 'next';
import { serverApi, siteUrl } from '@/lib/server-api';

export const dynamic = 'force-dynamic';
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const posts = await serverApi<{ slug: string; updatedAt: string }[]>('/api/public/sitemap');
  // Split into sitemap files before the standard 50,000 URL limit is reached.
  if (posts.length > 49996) throw new Error('Sitemap needs pagination: more than 50,000 URLs');
  return [
    ...['', '/about', '/privacy', '/copyright'].map(path => ({ url: `${siteUrl()}${path || '/'}` })),
    ...posts.map(post => ({ url: `${siteUrl()}/posts/${post.slug}`, lastModified: post.updatedAt })),
  ];
}
