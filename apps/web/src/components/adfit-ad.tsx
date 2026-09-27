'use client';

import { useEffect, useId, useRef, useState } from 'react';

// AdFit requires the issued unit dimensions unchanged. Never scale an ad to fit.
export function AdFitAd({ unitId, width, height }: { unitId: string; width: number; height: number }) {
  const container = useRef<HTMLDivElement>(null);
  const callbackName = `ggeujeokAdfit_${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const [fits, setFits] = useState(false), [failed, setFailed] = useState(false);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const measure = () => setFits(element.getBoundingClientRect().width >= width);
    const observer = new ResizeObserver(measure); observer.observe(element); measure();
    return () => observer.disconnect();
  }, [width]);
  useEffect(() => {
    const element = container.current;
    if (!element || !fits || failed) return;
    let active = true;
    const callbacks = window as unknown as Record<string, unknown>;
    callbacks[callbackName] = () => { if (active) setFailed(true); };
    const unit = document.createElement('ins');
    unit.className = 'kakao_ad_area'; unit.style.display = 'none'; unit.style.width = '100%';
    unit.dataset.adUnit = unitId; unit.dataset.adWidth = String(width); unit.dataset.adHeight = String(height);
    unit.dataset.adOnfail = callbackName;
    const script = document.createElement('script');
    script.async = true; script.charset = 'utf-8'; script.src = 'https://t1.kakaocdn.net/kas/static/ba.min.js';
    script.onerror = () => { if (active) setFailed(true); };
    element.append(unit, script);
    return () => { active = false; delete callbacks[callbackName]; element.replaceChildren(); };
  }, [unitId, width, height, fits, failed, callbackName]);
  return <aside className={`post-ad adfit-ad${fits && !failed ? '' : ' adfit-inactive'}`} aria-label="광고">
    {fits && !failed && <p>광고</p>}<div ref={container} className="adfit-unit" />
  </aside>;
}
