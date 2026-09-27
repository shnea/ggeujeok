'use client';

import { useEffect, useRef, useState } from 'react';
import type { AdPlacement } from '@/lib/ads-config';
import { PostAd } from './post-ad';

export function FeedAd({ ad }: { ad: AdPlacement }) {
  const container = useRef<HTMLDivElement>(null);
  const [fits, setFits] = useState(false);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    // AdSense in-feed units require at least 250px of available width.
    const observer = new ResizeObserver(([entry]) => setFits(entry.contentRect.width >= 250));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return <div className="feed-ad" ref={container}>{fits && <PostAd {...ad} />}</div>;
}
