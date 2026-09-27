import type { Metadata } from 'next';
import { getSiteInfo } from '@/lib/site-info';

export const metadata: Metadata = { title: '소개·문의', description: '끄적 이용 안내와 운영자 연락처', alternates: { canonical: '/about' } };
export default async function AboutPage() {
  const siteInfo = await getSiteInfo();
  return <article className="info-page"><h1>소개·문의</h1>
    <p>{siteInfo.name}은 운영자가 작성한 글을 게시하는 개인 블로그입니다. 공개된 글은 로그인 없이 읽을 수 있습니다.</p>
    <h2>글 찾아보기</h2><p><a href="/">글 목록</a>에서 카테고리와 태그를 선택하거나 검색어로 글을 찾을 수 있습니다. 화면 상단에서 밝은 테마·어두운 테마·시스템 테마를 선택할 수 있습니다.</p>
    <h2>문의</h2><p>내용 정정, 게시물 이용, 개인정보 관련 문의는 <a href={`mailto:${siteInfo.email}`}>{siteInfo.email}</a>으로 보내 주세요. 해당 글의 주소와 문의 내용을 함께 보내 주시면 확인에 도움이 됩니다.</p>
    <p>운영: {siteInfo.operator}</p>
    <h2>이용 안내</h2><p>개인정보 처리에 관한 내용은 <a href="/privacy">개인정보처리방침</a>, 글과 이미지 이용에 관한 내용은 <a href="/copyright">저작권 안내</a>에서 확인할 수 있습니다.</p>
  </article>;
}
