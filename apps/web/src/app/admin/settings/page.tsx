'use client';

import { useEffect, useState } from 'react';
import { Save, RotateCcw, RefreshCw, LogIn, Megaphone } from 'lucide-react';
import { adfitSizes, emptyAdfit, emptyFeed, type AdFitSettings, type AdSettingsInput } from '@/lib/ads-config';
import { api, ApiError, mutation, type Session } from '@/lib/api';
import { SiteSettingsForm } from './site-settings-form';

type Settings = AdSettingsInput & { source: 'admin' | 'environment' };
export default function AdSettingsPage() {
  const [session, setSession] = useState<Session | null>(null), [saved, setSaved] = useState<Settings | null>(null);
  const [enabled, setEnabled] = useState(false), [placeholders, setPlaceholders] = useState(false);
  const [provider, setProvider] = useState<AdSettingsInput['provider']>('adsense');
  const [adfit, setAdfit] = useState<AdFitSettings>(emptyAdfit);
  const [feed, setFeed] = useState(emptyFeed);
  const [adsense, setAdsense] = useState<AdSettingsInput['adsense']>({ clientId: '', postSlot: '', sidebarSlot: '', inlineSlot: '' });
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [denied, setDenied] = useState(false);
  const [error, setError] = useState(''), [message, setMessage] = useState(''), [revision, setRevision] = useState(0);
  function apply(value: Settings) { setSaved(value); setEnabled(value.enabled); setPlaceholders(value.showPlaceholders); setAdsense(value.adsense); setProvider(value.provider); setAdfit(value.adfit || emptyAdfit); setFeed(value.feed || emptyFeed); }
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError(''); setDenied(false);
    Promise.all([api<Session>('/api/auth/session', { signal: controller.signal }),
      api<Settings>('/api/admin/settings/ads', { signal: controller.signal })])
      .then(([session, settings]) => { if (!controller.signal.aborted) { setSession(session); apply(settings); } })
      .catch(error => { if (!controller.signal.aborted) { setError(error.message); setDenied(error instanceof ApiError && [401,403].includes(error.status)); setSaved(null); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision]);
  async function save(reset = false) {
    if (busy || !session?.csrfToken) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await api<Settings>('/api/admin/settings/ads', mutation(reset ? 'DELETE' : 'PUT', session.csrfToken,
        reset ? undefined : { provider, enabled, showPlaceholders: placeholders, adsense, adfit, feed }));
      apply(result); setMessage(reset ? '환경변수의 기본 설정으로 돌아갔습니다.' : '광고 설정을 저장했습니다. 글을 새로 열면 반영됩니다.');
    } catch (error) {
      setError((error as Error).message);
      if (error instanceof ApiError && [401,403].includes(error.status)) { setDenied(true); setSaved(null); }
    } finally { setBusy(false); }
  }
  const dirty = saved && (JSON.stringify(feed) !== JSON.stringify(saved.feed || emptyFeed) || provider !== saved.provider || JSON.stringify(adfit) !== JSON.stringify(saved.adfit || emptyAdfit) || enabled !== saved.enabled || placeholders !== saved.showPlaceholders || JSON.stringify(adsense) !== JSON.stringify(saved.adsense));
  return <section className="admin-page">
    <nav className="admin-nav" aria-label="관리 메뉴"><a href="/admin">글 관리</a><a href="/admin/categories">카테고리</a><a href="/admin/comments">댓글 관리</a><a href="/admin/settings" aria-current="page">설정</a></nav>
    <div className="page-heading"><div><h1>사이트 설정</h1><p>블로그 정보, 검색 등록, 방문 분석과 광고를 관리합니다.</p></div></div>
    {session?.user?.isAdmin && !denied && <><nav className="settings-sections" aria-label="설정 항목"><a href="#site-settings">기본 정보·검색·분석</a><a href="#ad-settings">광고</a></nav><SiteSettingsForm session={session} /></>}
    {loading ? <p role="status">설정을 불러오는 중…</p> : denied ? <div className="empty-state"><p>관리자 계정으로 로그인해 주세요.</p>
      <a className="button" href="/login?returnTo=%2Fadmin%2Fsettings"><LogIn aria-hidden="true" />로그인</a></div>
      : saved && <form id="ad-settings" className="ad-settings" onSubmit={event => { event.preventDefault(); void save(); }}>
        <h2>광고 설정</h2>
        <p className="field-help">{saved.source === 'admin' ? '관리 화면에서 저장한 설정을 사용 중입니다.' : '환경변수의 기본 설정을 사용 중입니다.'}</p>
        <label className="setting-toggle"><span><strong>실제 광고 사용</strong><small>광고 계정과 슬롯이 설정되어 있어야 송출됩니다.</small></span>
          <input type="checkbox" role="switch" checked={enabled} disabled={busy} onChange={event => { setEnabled(event.target.checked); setMessage(''); }} /></label>
        <label className="setting-toggle"><span><strong>광고가 꺼졌을 때 영역 표시</strong><small>실제 광고 요청 없이 광고가 놓일 자리를 보여줍니다.</small></span>
          <input type="checkbox" role="switch" checked={placeholders} disabled={busy} onChange={event => { setPlaceholders(event.target.checked); setMessage(''); }} /></label>
        <div className="ad-provider"><label htmlFor="ad-provider">기본 광고 서비스</label>
          <select id="ad-provider" value={provider} disabled={busy} onChange={event => { setProvider(event.target.value as Settings['provider']); setMessage(''); }}><option value="adsense">Google AdSense</option><option value="adfit">카카오 애드핏</option></select>
          <p className="field-help">선택한 서비스를 글 하단·오른쪽·긴 글 중간에 사용합니다.</p></div>
        {provider === 'adsense' && <fieldset className="ad-credentials" disabled={busy}><legend>Google AdSense</legend>
          <p className="field-help">발급받은 광고 코드에서 게시자 ID와 광고 슬롯 값을 입력하세요.</p>
          <label htmlFor="adsense-client">게시자 ID</label>
          <input id="adsense-client" value={adsense.clientId} placeholder="ca-pub-0000000000000000" required={enabled}
            pattern="ca-pub-[0-9]{16}" onChange={event => { setAdsense({ ...adsense, clientId: event.target.value }); setMessage(''); }} />
          <div className="ad-slot-fields">{([
            ['postSlot', '글 하단 슬롯'], ['sidebarSlot', 'PC 오른쪽 슬롯'], ['inlineSlot', '긴 글 중간 슬롯'],
          ] as const).map(([key, label]) => <div key={key}><label htmlFor={`adsense-${key}`}>{label}</label>
            <input id={`adsense-${key}`} value={adsense[key]} inputMode="numeric" pattern="[0-9]*" maxLength={40}
              required={enabled && key === 'postSlot'} onChange={event => { setAdsense({ ...adsense, [key]: event.target.value }); setMessage(''); }} /></div>)}</div>
          <p className="field-help">오른쪽·중간 슬롯을 비워 두면 해당 위치의 실제 광고는 표시하지 않습니다.</p>
          <label className="setting-toggle"><span><strong>글 목록 인피드 광고</strong><small>글이 4개 이상인 목록에서 세 번째 글 다음에 한 개 표시합니다. PC·모바일 모두 적용됩니다.</small></span>
            <input type="checkbox" role="switch" checked={feed.enabled} onChange={event => { setFeed({ ...feed, enabled: event.target.checked }); setMessage(''); }} /></label>
          {feed.enabled && <div className="feed-ad-fields">
            <div><label htmlFor="adsense-feed-slot">목록 인피드 슬롯</label>
              <input id="adsense-feed-slot" value={feed.slot} inputMode="numeric" pattern="[0-9]*" maxLength={40} required={enabled}
                onChange={event => { setFeed({ ...feed, slot: event.target.value }); setMessage(''); }} />
              <p className="field-help">인피드 광고 코드의 data-ad-slot 숫자</p></div>
            <div><label htmlFor="adsense-feed-layout">인피드 레이아웃 키</label>
              <input id="adsense-feed-layout" value={feed.layoutKey} maxLength={200} pattern="(?:[A-Za-z0-9_]|\+|-)+" required={enabled}
                onChange={event => { setFeed({ ...feed, layoutKey: event.target.value }); setMessage(''); }} />
              <p className="field-help">발급 코드의 data-ad-layout-key 값을 그대로 입력하세요.</p></div>
            <p className="field-help">애드센스에서 별도의 인피드 광고 단위를 만드세요. 광고 디자인은 애드센스에서 설정하며, 목록에는 ‘광고’ 표시가 함께 나옵니다.</p>
          </div>}
        </fieldset>}
        {provider === 'adfit' && <fieldset className="ad-credentials" disabled={busy}><legend>카카오 애드핏</legend>
          <p className="field-help">발급받은 광고단위 ID와 크기를 그대로 입력하세요. 다른 서비스로 바꿔도 입력값은 보관합니다.</p>
          {([['post','글 하단'],['sidebar','PC 오른쪽'],['inline','긴 글 중간']] as const).map(([key,label]) =>
            <div className="adfit-fields" key={key}><div><label htmlFor={`adfit-${key}`}>{label} 광고단위 ID</label>
              <input id={`adfit-${key}`} value={adfit[key].unitId} maxLength={128} pattern="(?:[A-Za-z0-9_]|-)+" required={enabled && key === 'post'}
                onChange={event => { setAdfit({ ...adfit, [key]: { ...adfit[key], unitId: event.target.value } }); setMessage(''); }} /></div>
              <div><label htmlFor={`adfit-size-${key}`}>광고 크기</label><select id={`adfit-size-${key}`} value={adfit[key].size}
                onChange={event => { setAdfit({ ...adfit, [key]: { ...adfit[key], size: event.target.value as typeof adfitSizes[number] } }); setMessage(''); }}>
                {adfitSizes.map(size => <option key={size} value={size}>{size.replace('x',' × ')}</option>)}</select></div></div>)}
          <p className="field-help">빈 위치는 생략합니다. 표시 영역보다 큰 광고는 요청하지 않습니다. 하단은 300 × 250, 오른쪽은 160 × 600 크기를 권장합니다.</p>
          <p className="field-help">목록 인피드 광고는 애드센스 선택 시에만 표시합니다. 기존 인피드 설정은 보관됩니다.</p>
        </fieldset>}
        <p className="ad-setting-summary" role="status"><Megaphone aria-hidden="true" />{enabled ? '실제 광고 모드 · 영역 표시 설정은 광고를 끄면 적용됩니다.' : placeholders ? '광고 자리만 표시합니다.' : '광고와 광고 자리 모두 숨깁니다.'}</p>
        <div className="button-row"><button disabled={busy || !dirty}><Save aria-hidden="true" />{busy ? '저장 중…' : '설정 저장'}</button>
          {saved.source === 'admin' && <button type="button" className="secondary" disabled={busy} onClick={() => void save(true)}><RotateCcw aria-hidden="true" />환경변수 기본값 사용</button>}</div>
        <p className="field-help">글 하단에 표시하며, 넓은 PC 화면에서는 오른쪽과 긴 글 중간에도 표시합니다.</p>
      </form>}
    {error && !denied && <div className="notice error" role="alert"><p>{error}</p>{!saved && <button className="text-button" disabled={loading} onClick={() => setRevision(value => value + 1)}><RefreshCw aria-hidden="true" />다시 불러오기</button>}</div>}
    {message && <p role="status" className="profile-feedback">{message}</p>}
  </section>;
}
