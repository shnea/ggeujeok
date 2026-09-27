import 'server-only';
import { cache } from 'react';
import { serverApi } from './server-api';
import { emptySiteSettings, type SiteSettings } from './site-config';

export const siteSettings = cache(async (): Promise<SiteSettings> => {
  try { return await serverApi<SiteSettings>('/api/public/settings/site'); }
  catch { return emptySiteSettings; }
});
