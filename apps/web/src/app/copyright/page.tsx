import type { Metadata } from 'next';
import { getSiteInfo } from '@/lib/site-info';

export const metadata: Metadata = { title: '저작권 안내', description: '끄적 게시물과 자료의 이용 안내', alternates: { canonical: '/copyright' } };
export default async function CopyrightPage() {
  const siteInfo = await getSiteInfo();
  return <article className="info-page"><h1>저작권 안내</h1>
    <p>이 사이트에 게시된 글·이미지·코드·인용 자료의 권리는 각 권리자에게 있습니다. 별도의 출처나 라이선스가 표시된 자료는 해당 이용 조건을 확인해 주세요.</p>
    <h2>글과 이미지 이용</h2><p>별도 허락이 표시되지 않은 콘텐츠에 일괄적인 자유 이용 라이선스를 부여하지 않습니다. 법령에 따라 허용되는 이용을 제외한 전문 복제·재배포·상업적 이용은 권리자의 허락을 확인해 주세요.</p>
    <p>게시글의 주소를 링크로 소개할 수 있습니다. 내용 이용이나 권리 침해가 의심되는 자료에 관한 문의는 해당 글의 주소와 함께 <a href={`mailto:${siteInfo.email}`}>{siteInfo.email}</a>으로 보내 주세요.</p>
  </article>;
}
