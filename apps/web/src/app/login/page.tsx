import { ArrowLeft, ArrowRight, LogIn, MessageCircle, Bell, Heart } from 'lucide-react';
import type { Metadata } from 'next';
import { serverApi } from '@/lib/server-api';
import type { Session } from '@/lib/api';

export const metadata: Metadata = { title: '로그인', robots: { index: false } };
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ reason?: string; returnTo?: string }> }) {
  const session = await serverApi<Session>('/api/auth/session');
  const { reason, returnTo } = await searchParams;
  const target = typeof returnTo === 'string' && /^(?:\/posts\/[a-z0-9]+(?:-[a-z0-9]+)*#comments|\/me(?:\/(?:comments|likes|notifications|settings))?|\/admin\/settings)$/.test(returnTo) ? returnTo : '/';
  return <section className="login-page" aria-labelledby="login-heading">
    <a className="login-back" href="/"><ArrowLeft aria-hidden="true" />글 목록으로</a>
    <div className="login-panel">
      <div className="login-intro"><h1 id="login-heading">끄적</h1>
        <p>글을 읽고,<br />댓글로 이야기를 나누세요.</p>
        <ul className="login-features">
          <li><MessageCircle aria-hidden="true" />내 닉네임으로 댓글과 답글</li>
          <li><Heart aria-hidden="true" />좋아요한 글 모아보기</li>
          <li><Bell aria-hidden="true" />내 댓글에 달린 답글 알림</li>
        </ul>
      </div>
      <div className="login-connect">
        <LogIn className="login-symbol" aria-hidden="true" />
        <h2>로그인하고 이어가기</h2>
        <p>작성한 댓글과 좋아요한 글을<br />한곳에서 확인하세요.</p>
        {!session.configured ? <p role="status" className="notice">로그인 연결을 준비하고 있어요. 설정이 완료되면 이곳에서 로그인할 수 있습니다.</p>
          : <>{reason && <p role="alert" className="notice">{reason === 'expired' ? '로그인 요청이 만료됐습니다. 다시 시작해 주세요.' : reason === 'profile' ? '계정에 닉네임을 설정한 뒤 다시 로그인해 주세요.' : '로그인을 완료하지 못했습니다. 다시 시도해 주세요.'}</p>}
            <a className="button login-action" href={`/auth/login?returnTo=${encodeURIComponent(target)}`}>로그인<ArrowRight aria-hidden="true" /></a></>}
        <p className="login-profile-note">댓글에 표시할 닉네임은 내 설정에서 바꿀 수 있습니다.</p>
      </div>
    </div>
    <p className="login-policy"><a href="/privacy">개인정보처리방침</a><span aria-hidden="true">·</span><a href="/about">문의하기</a></p>
  </section>;
}
