'use client';

import Script from 'next/script';
import { usePathname } from 'next/navigation';
import { publicAnalyticsPath, type SiteSettings } from '@/lib/site-config';

export function GoogleTags({ settings }: { settings: SiteSettings }) {
  const path = usePathname();
  if (!publicAnalyticsPath(path)) return null;
  const { analyticsMode, ga4MeasurementId, gtmContainerId } = settings;
  if (analyticsMode === 'ga4' && /^G-[A-Z0-9]{4,20}$/.test(ga4MeasurementId)) {
    return <>
      <Script id="google-analytics-init" strategy="afterInteractive">{`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config',${JSON.stringify(ga4MeasurementId)},{page_location:location.origin+location.pathname});`}</Script>
      <Script id="google-analytics-loader" strategy="afterInteractive" src={`https://www.googletagmanager.com/gtag/js?id=${ga4MeasurementId}`} />
    </>;
  }
  if (analyticsMode === 'gtm' && /^GTM-[A-Z0-9]{4,20}$/.test(gtmContainerId)) {
    return <Script id="google-tag-manager" strategy="afterInteractive">{`(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer',${JSON.stringify(gtmContainerId)});`}</Script>;
  }
  return null;
}
