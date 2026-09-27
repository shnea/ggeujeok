'use client';

import { useEffect, useState } from 'react';
import { Save, RefreshCw, ExternalLink } from 'lucide-react';
import { api, mutation, type Session } from '@/lib/api';
import { type SiteSettings } from '@/lib/site-config';

export function SiteSettingsForm({ session }: { session: Session }) {
  const [saved, setSaved] = useState<SiteSettings | null>(null), [value, setValue] = useState<SiteSettings | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState(''), [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setError('');
    api<SiteSettings>('/api/admin/settings/site', { signal: controller.signal })
      .then(data => { setSaved(data); setValue(data); })
      .catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [retry]);
  function change(update: Partial<SiteSettings>) { setValue(current => current && { ...current, ...update }); setMessage(''); }
  async function save() {
    if (!value || busy || !session.csrfToken) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await api<SiteSettings>('/api/admin/settings/site', mutation('PUT', session.csrfToken, value));
      setSaved(result); setValue(result); setMessage('사이트 설정을 저장했습니다. 페이지를 새로 열면 반영됩니다.');
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }
  return <section id="site-settings" className="site-settings-section" aria-labelledby="site-settings-heading">
    <h2 id="site-settings-heading">사이트 기본 정보·검색·방문 분석</h2>
    {!value && !error && <p role="status">설정을 불러오는 중…</p>}
    {value && <form className="site-settings-form" onSubmit={event => { event.preventDefault(); void save(); }}>
      <fieldset disabled={busy}><legend>사이트 기본 정보</legend>
        <label htmlFor="site-name">블로그 이름</label><input id="site-name" value={value.name} required maxLength={40} onChange={e => change({name:e.target.value})} />
        <label htmlFor="site-description">기본 설명</label><textarea id="site-description" rows={3} value={value.description} maxLength={200} onChange={e => change({description:e.target.value})} />
        <p className="field-help">검색 결과·공유·RSS에 사용합니다. 목록 위에 소개 문구로 표시하지 않습니다.</p>
        <label htmlFor="site-image">기본 공유 이미지 URL <span className="optional">선택</span></label><input id="site-image" type="url" value={value.imageUrl} maxLength={2000} onChange={e => change({imageUrl:e.target.value})} />
        <p className="field-help">로그인 없이 열리는 HTTPS 이미지 주소. 비우면 기본 이미지를 사용하며, 게시글 대표 이미지가 있으면 우선합니다.</p>
        <label htmlFor="site-operator">공개 운영자명</label><input id="site-operator" required maxLength={80} value={value.operatorName} onChange={e => change({operatorName:e.target.value})} />
        <label htmlFor="site-email">공개 문의 이메일</label><input id="site-email" type="email" required maxLength={254} value={value.contactEmail} onChange={e => change({contactEmail:e.target.value})} />
      </fieldset>
      <fieldset disabled={busy}><legend>검색 등록</legend>
        <label htmlFor="google-verification">구글 서치콘솔 인증값</label><input id="google-verification" value={value.searchConsoleToken} maxLength={256} onChange={e => change({searchConsoleToken:e.target.value})} />
        <p className="field-help">URL 접두어 속성의 HTML 태그에서 content 값만 입력하세요. 도메인 속성은 DNS 인증이 필요합니다.</p>
        <label htmlFor="naver-verification">네이버 서치어드바이저 인증값</label><input id="naver-verification" value={value.naverToken} maxLength={256} onChange={e => change({naverToken:e.target.value})} />
        <p className="field-help">HTML 태그의 content 값만 입력하세요. 저장 후 각 서비스에서 소유 확인을 완료하세요.</p>
        <div className="settings-links"><a href="https://search.google.com/search-console" target="_blank" rel="noreferrer">서치콘솔<ExternalLink aria-hidden="true" /></a><a href="https://searchadvisor.naver.com/" target="_blank" rel="noreferrer">서치어드바이저<ExternalLink aria-hidden="true" /></a></div>
        <p className="field-help">사이트맵: <a href="/sitemap.xml">/sitemap.xml</a> · RSS: <a href="/rss.xml">/rss.xml</a></p>
      </fieldset>
      <fieldset disabled={busy}><legend>방문 분석</legend>
        <label htmlFor="analytics-mode">연결 방식</label><select id="analytics-mode" value={value.analyticsMode} onChange={e => change({analyticsMode:e.target.value as SiteSettings['analyticsMode']})}>
          <option value="off">사용 안 함</option><option value="ga4">Google Analytics 4 직접 연결</option><option value="gtm">Google 태그 관리자로 연결</option></select>
        <p className="field-help">처음에는 GA4 직접 연결을 권장합니다. 두 방식은 동시에 불러오지 않으며, 전환해도 입력값은 보관합니다.</p>
        <label htmlFor="ga4-id">GA4 측정 ID</label><input id="ga4-id" value={value.ga4MeasurementId} placeholder="G-XXXXXXXXXX" pattern="G-[A-Z0-9]{4,20}" required={value.analyticsMode==='ga4'} onChange={e=>change({ga4MeasurementId:e.target.value})} />
        <label htmlFor="gtm-id">태그 관리자 컨테이너 ID</label><input id="gtm-id" value={value.gtmContainerId} placeholder="GTM-XXXXXXX" pattern="GTM-[A-Z0-9]{4,20}" required={value.analyticsMode==='gtm'} onChange={e=>change({gtmContainerId:e.target.value})} />
        <p className="field-help">태그 관리자를 선택하면 구글 태그 관리자에서 GA4 태그를 설정하고 게시해야 합니다. 관리자·로그인·내 활동 화면에는 분석 태그를 넣지 않습니다.</p>
      </fieldset>
      <button disabled={busy || JSON.stringify(value)===JSON.stringify(saved)}><Save aria-hidden="true" />{busy?'저장 중…':'사이트 설정 저장'}</button>
    </form>}
    {error && <div className="notice error" role="alert"><p>{error}</p>{!value&&<button className="text-button" onClick={()=>setRetry(n=>n+1)}><RefreshCw aria-hidden="true" />다시 불러오기</button>}</div>}
    {message && <p role="status" className="profile-feedback">{message}</p>}
  </section>;
}
