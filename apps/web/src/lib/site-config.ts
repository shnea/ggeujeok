export type SiteSettings = {
  name: string; description: string; imageUrl: string; operatorName: string; contactEmail: string; naverToken: string;
  searchConsoleToken: string;
  analyticsMode: 'off' | 'ga4' | 'gtm';
  ga4MeasurementId: string;
  gtmContainerId: string;
};
export const emptySiteSettings: SiteSettings = { name: '끄적', description: '끄적의 공개 게시글 목록입니다.', imageUrl: '',
  operatorName: '끄적 운영자', contactEmail: 'shnea@kakao.com', naverToken: '', searchConsoleToken: '', analyticsMode: 'off', ga4MeasurementId: '', gtmContainerId: '' };

export function publicAnalyticsPath(path: string) {
  return ['/', '/about', '/privacy', '/copyright'].includes(path) || /^\/posts\/[^/]+$/.test(path);
}
