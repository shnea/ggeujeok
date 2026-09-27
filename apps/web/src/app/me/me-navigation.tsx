import { MessageCircle, Heart, Bell, Settings } from 'lucide-react';

export function MeNavigation({ current }: { current: 'comments' | 'likes' | 'notifications' | 'settings' }) {
  const links = [
    { path: 'comments', label: '내 댓글', Icon: MessageCircle },
    { path: 'likes', label: '좋아요한 글', Icon: Heart },
    { path: 'notifications', label: '알림', Icon: Bell },
    { path: 'settings', label: '내 설정', Icon: Settings },
  ];
  return <nav className="my-tabs" aria-label="내 활동 메뉴">{links.map(({ path, label, Icon }) =>
    <a key={path} href={`/me/${path}`} aria-current={current === path ? 'page' : undefined}>
      <Icon aria-hidden="true" />{label}
    </a>)}
  </nav>;
}
