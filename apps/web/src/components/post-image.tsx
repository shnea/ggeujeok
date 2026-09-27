'use client';

import { useState } from 'react';

export function PostImage({ src, alt, className, eager = false, retry = false }: { src: string; alt: string; className: string; eager?: boolean; retry?: boolean }) {
  const [failed, setFailed] = useState<string | null>(null);
  if (failed === src) return retry ? <div className="image-unavailable"><p className="field-help">이미지 준비 중이거나 불러오지 못했습니다.</p>
    <button type="button" className="secondary" onClick={() => setFailed(null)}>이미지 다시 보기</button></div> : null;
  return <img src={src} alt={alt} className={className} loading={eager ? 'eager' : 'lazy'} decoding="async" onError={() => setFailed(src)} />;
}
