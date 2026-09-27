import type { Metadata } from 'next';
import '@fontsource/noto-sans-kr/400.css';
import '@fontsource/noto-sans-kr/500.css';
import '@fontsource/noto-sans-kr/700.css';
import '@fontsource/noto-serif-kr/600.css';
import '@shnea/editor/style.css';
import './globals.css';
import { AccountMenu } from '@/components/account-menu';
import { siteUrl } from '@/lib/server-api';
import { ThemeSelect } from '@/components/theme-select';
import { GoogleTags } from '@/components/google-tags';
import { siteSettings } from '@/lib/site-settings';
import { List } from 'lucide-react';

export const dynamic = 'force-dynamic';
export async function generateMetadata(): Promise<Metadata> {
  const site = await siteSettings();
  return { metadataBase: new URL(siteUrl()), title: { default: site.name, template: `%s · ${site.name}` },
    description: site.description,
    openGraph: { title: site.name, description: site.description, type: 'website', siteName: site.name, locale: 'ko_KR', images: [site.imageUrl || '/default-og.png'] },
    robots: { index: true, follow: true } };
}
export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const site = await siteSettings();
  return <html lang="ko" suppressHydrationWarning><head>
    {site.searchConsoleToken && <meta name="google-site-verification" content={site.searchConsoleToken} />}
    {site.naverToken && <meta name="naver-site-verification" content={site.naverToken} />}
    <link rel="alternate" type="application/rss+xml" title={`${site.name} RSS`} href={`${siteUrl()}/rss.xml`} />
    <script dangerouslySetInnerHTML={{ __html: `(function(){try{var t=localStorage.getItem('ggeujeok-theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t;}catch(e){}})();` }} />
  </head><body>
    <GoogleTags settings={site} />
    <a className="skip-link" href="#main">본문으로 바로가기</a>
    <header className="site-header"><a className="wordmark" href="/" aria-label={`${site.name} 홈`}>{site.name}<span className="logo-dot" /></a>
      <nav aria-label="주 메뉴"><a href="/" className="header-action" aria-label="모든 글" title="모든 글"><List aria-hidden="true" /><span className="header-action-label">모든 글</span></a><AccountMenu /></nav><ThemeSelect />
    </header>
    <main id="main">{children}</main>
    <footer className="site-footer"><span>© {new Date().getFullYear()} {site.name}</span><nav aria-label="사이트 안내">

      <a href="/about">소개·문의</a><a href="/privacy">개인정보처리방침</a><a href="/copyright">저작권 안내</a><a href="/rss.xml">RSS</a><a href="https://main.shnea.kr/" title="SHNEA 프로젝트를 한곳에서 둘러보세요">프로젝트 허브</a><a href="/">처음으로</a>
    </nav></footer>
  </body></html>;
}
