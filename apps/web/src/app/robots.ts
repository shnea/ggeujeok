import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/server-api';

export const dynamic = 'force-dynamic';
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: '*', allow: '/', disallow: ['/api/admin/', '/api/auth/', '/auth/', '/callback'] },
    sitemap: `${siteUrl()}/sitemap.xml` };
}
