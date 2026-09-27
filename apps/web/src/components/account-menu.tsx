'use client';

import { UserRound, Bell, FilePenLine, Settings, LogOut, LogIn } from 'lucide-react';


import { useEffect, useState } from 'react';
import { api, mutation, type Session } from '@/lib/api';

export function AccountMenu() {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState('');
  const [unread,setUnread] = useState<number|null>(null);
  useEffect(()=>{
    if(!session?.user){setUnread(null);return;}
    let active=true;
    const refresh=()=>{api<{count:number}>('/api/me/notifications/unread-count').then(result=>{if(active)setUnread(result.count);}).catch(()=>{if(active)setUnread(null);});};
    refresh();window.addEventListener('ggeujeok:notifications-changed',refresh);
    return ()=>{active=false;window.removeEventListener('ggeujeok:notifications-changed',refresh);};
  },[session?.user?.id]);
  useEffect(() => {
    api<Session>('/api/auth/session').then(result => {
      setSession(result);

    }).catch(() => {});
  }, []);
  async function logout() {
    try {
      const result = await api<{ redirectTo: string }>('/auth/logout', mutation('POST', session!.csrfToken!));
      window.location.assign(result.redirectTo);
    } catch { setError('로그아웃하지 못했습니다. 다시 시도해 주세요.'); }
  }
  return <div className="account-menu">
    {session?.user ? <><a href="/me" className="header-action" aria-label="내 활동" title="내 활동"><UserRound aria-hidden="true" /><span className="header-action-label">내 활동</span></a><a href="/me/notifications" className="header-action" title="알림" aria-label={unread?`알림, 읽지 않은 알림 ${unread}개`:'알림'}><Bell aria-hidden="true" /><span className="header-action-label">알림</span>{Boolean(unread)&&<span className="notification-count" aria-hidden="true">{unread!>99?'99+':unread}</span>}</a>
      <a href="/me/settings" className="header-action" aria-label="내 설정" title="내 설정"><Settings aria-hidden="true" /><span className="header-action-label">내 설정</span></a>
      {session.user.isAdmin && <a href="/admin" className="header-action" aria-label="글 관리" title="글 관리"><FilePenLine aria-hidden="true" /><span className="header-action-label">글 관리</span></a>}<button className="text-button header-action" aria-label="로그아웃" title="로그아웃" onClick={logout}><LogOut aria-hidden="true" /><span className="header-action-label">로그아웃</span></button></>
      : <a href="/login" className="header-action" aria-label="로그인" title="로그인"><LogIn aria-hidden="true" /><span className="header-action-label">로그인</span></a>}
    {error && <span role="alert">{error}</span>}
  </div>;
}
