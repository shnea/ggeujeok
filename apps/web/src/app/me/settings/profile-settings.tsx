'use client';

import { useEffect, useState } from 'react';
import { Save, RotateCcw, LogIn, RefreshCw, UserRound } from 'lucide-react';
import { api, ApiError, mutation, type Session } from '@/lib/api';
import { MeNavigation } from '../me-navigation';

type Profile = { nickname: string | null; defaultNickname: string | null; customNickname: string | null };
const login = '/login?returnTo=%2Fme%2Fsettings';

export function ProfileSettings() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [nickname, setNickname] = useState('');
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [message, setMessage] = useState('');
  const [loginRequired, setLoginRequired] = useState(false), [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(''); setMessage('');
    Promise.all([api<Session>('/api/auth/session', { signal: controller.signal }),
      api<Profile>('/api/me/profile', { signal: controller.signal })])
      .then(([session, profile]) => {
        if (controller.signal.aborted) return;
        setSession(session); setProfile(profile); setNickname(profile.nickname || ''); setLoginRequired(false);
      }).catch(error => {
        if (controller.signal.aborted) return;
        setProfile(null); setError(error.message); setLoginRequired(error instanceof ApiError && error.status === 401);
      }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision]);

  async function save(value: string | null) {
    if (busy || !session?.csrfToken) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await api<Profile>('/api/me/profile', mutation('PUT', session.csrfToken, { nickname: value }));
      setProfile(result); setNickname(result.nickname || '');
      setMessage(value === null ? '기본 닉네임으로 돌아갔습니다.' : '닉네임을 저장했습니다. 기존 댓글과 답글에도 적용됩니다.');
    } catch (error) {
      setError((error as Error).message);
      if (error instanceof ApiError && error.status === 401) { setLoginRequired(true); setProfile(null); }
    } finally { setBusy(false); }
  }

  return <>
    <MeNavigation current="settings" />
    <div className="my-list-heading"><h2>내 설정</h2></div>
    {loading ? <p role="status" className="field-help">설정을 불러오는 중…</p>
      : loginRequired ? <div className="empty-state"><p>로그인하면 닉네임을 설정할 수 있습니다.</p>
        <a className="button" href={login}><LogIn aria-hidden="true" />로그인</a></div>
      : profile && <form className="profile-settings" onSubmit={event => { event.preventDefault(); void save(nickname); }}>
        <div className="profile-current"><UserRound aria-hidden="true" /><div><span>댓글에 표시되는 이름</span>
          <strong>{profile.nickname || '닉네임 없음'}</strong></div></div>
        <label htmlFor="profile-nickname">끄적에서 사용할 닉네임</label>
        <p id="nickname-description" className="field-help">여기서 바꾼 이름은 끄적에서만 사용합니다. 기존 댓글과 답글에도 적용됩니다.</p>
        <input id="profile-nickname" autoComplete="nickname" value={nickname} disabled={busy} required
          aria-describedby="nickname-description nickname-rules" onChange={event => { setNickname(event.target.value); setMessage(''); setError(''); }} />
        <p id="nickname-rules" className="field-help">2~30자 · 문자, 숫자, 공백, 밑줄(_), 마침표(.), 하이픈(-)</p>
        <div className="button-row"><button disabled={busy || !nickname.trim() || nickname === profile.nickname}><Save aria-hidden="true" />{busy ? '저장 중…' : '닉네임 저장'}</button></div>
        <div className="profile-default"><div><span>기본 닉네임</span><strong>{profile.defaultNickname || '다시 로그인해 주세요.'}</strong>
          <p className="field-help">로그인 계정의 닉네임입니다. 직접 바꾸지 않으면 이 이름을 사용합니다.</p></div>
          {profile.customNickname !== null && <button type="button" className="secondary" disabled={busy || !profile.defaultNickname}
            onClick={() => void save(null)}><RotateCcw aria-hidden="true" />기본 닉네임 사용</button>}
          {!profile.defaultNickname && <a href={login}>다시 로그인</a>}
        </div>
      </form>}
    {error && !loginRequired && <div className="notice error" role="alert"><p>{error}</p>
      {!profile && <button className="text-button" disabled={loading} onClick={() => setRevision(value => value + 1)}><RefreshCw aria-hidden="true" />다시 불러오기</button>}</div>}
    {message && <p role="status" className="profile-feedback">{message}</p>}
  </>;
}
