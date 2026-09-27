'use client';

import { Fragment, useMemo, useState } from 'react';
import { ShneaViewer } from '@shnea/editor/react';
import { parseDocument } from '@shnea/editor';
import { viewerAttachments } from '@/lib/attachments';
import { articleSections } from '@/lib/article-sections';
import type { AdPlacement } from '@/lib/ads-config';
import { DesktopAd } from './post-ad';

export function DocumentViewer({ content, inlineAd }: { content: unknown; inlineAd?: AdPlacement }) {
  const [error, setError] = useState(false);
  const sections = useMemo(() => {
    if (!inlineAd) return [content];
    try { return articleSections(parseDocument(content)); } catch { return [content]; }
  }, [content, inlineAd]);
  return error ? <p role="alert">본문을 표시하지 못했습니다. 새로고침 후 다시 시도해 주세요.</p>
    : <div className="document-surface">{sections.map((section, index) => <Fragment key={index}>
      {index > 0 && inlineAd && <DesktopAd {...inlineAd} />}
      <ShneaViewer value={section} attachments={viewerAttachments} onError={() => setError(true)} />
    </Fragment>)}</div>;
}
