export const adfitSizes = ['160x600','250x250','300x250','320x100','320x50','728x90'] as const;
export type AdFitUnit = { unitId: string; size: typeof adfitSizes[number] };
export type AdFitSettings = { post: AdFitUnit; sidebar: AdFitUnit; inline: AdFitUnit };
export const emptyAdfit: AdFitSettings = { post: { unitId: '', size: '300x250' }, sidebar: { unitId: '', size: '160x600' }, inline: { unitId: '', size: '728x90' } };
export type FeedAdSettings = { enabled: boolean; slot: string; layoutKey: string };
export const emptyFeed: FeedAdSettings = { enabled: false, slot: '', layoutKey: '' };
export type AdSettingsInput = { provider: 'adsense' | 'adfit'; enabled: boolean; showPlaceholders: boolean;
  feed?: FeedAdSettings;
  adfit: AdFitSettings | null; adsense: { clientId: string; postSlot: string; sidebarSlot: string; inlineSlot: string } };
export type AdPlacement = { kind: 'placeholder' } | { kind: 'adsense'; client: string; slot: string; layoutKey?: string } | { kind: 'adfit'; unitId: string; width: number; height: number };
export const hiddenAds: AdSettingsInput = { provider: 'adsense', enabled: false, showPlaceholders: false,
  adfit: null, adsense: { clientId: '', postSlot: '', sidebarSlot: '', inlineSlot: '' } };

// Page layout consumes placements; provider-specific validation stays here.
export function resolveAdSettings(settings: AdSettingsInput, adsEnabled = true) {
  if (!adsEnabled) return { enabled: false, provider: settings.provider, feed: null, post: null, sidebar: null, inline: null };
  const { clientId: client, postSlot, sidebarSlot, inlineSlot } = settings.adsense;
  const validAdFit = (unit: AdFitUnit | undefined) => Boolean(unit?.unitId && /^[A-Za-z0-9_-]{1,128}$/.test(unit.unitId) && adfitSizes.includes(unit.size));
  const enabled = settings.enabled && (settings.provider === 'adsense'
    ? /^ca-pub-\d{16}$/.test(client) && /^\d+$/.test(postSlot)
    : settings.provider === 'adfit' && validAdFit(settings.adfit?.post));
  const placeholder = !settings.enabled && settings.showPlaceholders;
  function placement(slot: string, unit: AdFitUnit | undefined): AdPlacement | null {
    if (placeholder) return { kind: 'placeholder' };
    if (!enabled) return null;
    if (settings.provider === 'adsense') return /^\d+$/.test(slot) ? { kind: 'adsense', client, slot } : null;
    if (!validAdFit(unit)) return null;
    const [width, height] = unit!.size.split('x').map(Number);
    return { kind: 'adfit', unitId: unit!.unitId, width, height };
  }
  const feed = settings.feed;
  const feedPlacement: AdPlacement | null = settings.provider !== 'adsense' || !feed?.enabled ? null
    : placeholder ? { kind: 'placeholder' }
    : enabled && /^\d+$/.test(feed.slot) && /^[A-Za-z0-9_+-]{1,200}$/.test(feed.layoutKey)
      ? { kind: 'adsense', client, slot: feed.slot, layoutKey: feed.layoutKey } : null;
  return { enabled, provider: settings.provider, feed: feedPlacement, post: placement(postSlot, settings.adfit?.post),
    sidebar: placement(sidebarSlot, settings.adfit?.sidebar), inline: placement(inlineSlot, settings.adfit?.inline) };
}
