'use client';
import Script from 'next/script';
import { AdFitAd } from './adfit-ad';
import type { AdPlacement } from '@/lib/ads-config';
import { useRef, useState, useSyncExternalStore } from 'react';

const desktopQuery = '(min-width: 1280px)';
const desktopSnapshot = () => window.matchMedia(desktopQuery).matches;
const subscribe = (notify: () => void) => {
  const media = window.matchMedia(desktopQuery);
  media.addEventListener('change', notify);
  return () => media.removeEventListener('change', notify);
};

export function DesktopAd(props: AdPlacement) {
  const desktop = useSyncExternalStore(subscribe, desktopSnapshot, () => false);
  return desktop ? <PostAd {...props} /> : null;
}

export function PostAd(ad: AdPlacement) {
  if (ad.kind === 'placeholder') return <aside className="post-ad post-ad-placeholder" aria-label="광고 영역 미리보기">
    <p>광고 영역</p><div>실제 광고는 표시되지 않습니다.</div>
  </aside>;
  if (ad.kind === 'adfit') return <AdFitAd key={`${ad.unitId}:${ad.width}:${ad.height}`} {...ad} />;
  if (ad.kind === 'adsense') return <AdSenseAd key={`${ad.client}:${ad.slot}:${ad.layoutKey || ''}`} client={ad.client} slot={ad.slot} layoutKey={ad.layoutKey} />;
  return null;
}

function AdSenseAd({ client, slot, layoutKey }: { client: string; slot: string; layoutKey?: string }) {
  const requested = useRef(false);
  const [failed, setFailed] = useState(false);
  function requestAd() {
    if (requested.current) return;
    requested.current = true;
    try {
      const ads = window as typeof window & { adsbygoogle?: Record<string, never>[] };
      (ads.adsbygoogle ||= []).push({});
    } catch { setFailed(true); }
  }
  if (failed) return null;
  return <aside className="post-ad" aria-label="광고"><p>광고</p>
    <ins className="adsbygoogle" data-ad-client={client} data-ad-slot={slot}
      data-ad-format={layoutKey ? 'fluid' : 'auto'} data-ad-layout-key={layoutKey}
      data-full-width-responsive={layoutKey ? undefined : 'false'} />
    <Script id="adsense" src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${client}`}
      crossOrigin="anonymous" strategy="afterInteractive" onError={() => setFailed(true)} onLoad={requestAd} onReady={requestAd} />
  </aside>;
}
