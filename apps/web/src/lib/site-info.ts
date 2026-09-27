import 'server-only';
import { serverApi } from './server-api';
import { resolveAdSettings, hiddenAds, type AdSettingsInput } from './ads-config';

import { siteSettings } from './site-settings';

export async function getSiteInfo() {
  const site = await siteSettings();
  return { name: site.name, description: site.description, imageUrl: site.imageUrl, operator: site.operatorName, email: site.contactEmail, policyDate: '2026-09-28' };
}

export async function adSettings() {
  try {
    return resolveAdSettings(await serverApi<AdSettingsInput>('/api/public/settings/ads'));
  } catch {
    // Hide ads on failure; falling back could re-enable ads an administrator disabled.
    return resolveAdSettings(hiddenAds);
  }
}
