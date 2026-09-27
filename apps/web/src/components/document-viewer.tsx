'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { ShneaViewer } from '@shnea/editor/react';
import { parseDocument } from '@shnea/editor';
import { viewerAttachments } from '@/lib/attachments';
import { articleSections } from '@/lib/article-sections';
import type { AdPlacement } from '@/lib/ads-config';
import { DesktopAd } from './post-ad';
import { recordVisit } from '@/lib/record-visit';

export function DocumentViewer({ content, inlineAd, postId }: { content: unknown; inlineAd?: AdPlacement; postId?: string }) {
  const [error, setError] = useState(false);
  const surface = useRef<HTMLDivElement>(null);
  const failed = useRef(false);
  const recorded = useRef<string | null>(null);
  const sections = useMemo(() => {
    if (!inlineAd) return [content];
    try { return articleSections(parseDocument(content)); } catch { return [content]; }
  }, [content, inlineAd]);
  useEffect(() => {
    if (!postId || error) return;
    const record = () => {
      // alpha.9 mounts synchronously, but has no Viewer onReady callback.
      if (document.visibilityState !== 'visible' || failed.current || recorded.current === postId
        || surface.current?.querySelectorAll('.shnea-viewer').length !== sections.length) return;
      recorded.current = postId;
      void recordVisit(postId);
    };
    const frame = requestAnimationFrame(record);
    document.addEventListener('visibilitychange', record);
    return () => { cancelAnimationFrame(frame); document.removeEventListener('visibilitychange', record); };
  }, [postId, error, sections.length]);
  return error ? <p role="alert">본문을 표시하지 못했습니다. 새로고침 후 다시 시도해 주세요.</p>
    : <div ref={surface} className="document-surface">{sections.map((section, index) => <Fragment key={index}>
      {index > 0 && inlineAd && <DesktopAd {...inlineAd} />}
      <ShneaViewer value={section} attachments={viewerAttachments} onError={() => { failed.current = true; setError(true); }} />
    </Fragment>)}</div>;
}
