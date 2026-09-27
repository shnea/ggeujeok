// Called only after the Viewer mounted successfully on a visible public post.
export async function recordVisit(postId: string) {
  if (navigator.doNotTrack === '1' || (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl) return;
  let referrerHost = '';
  try {
    const referrer = new URL(document.referrer);
    if (referrer.origin !== location.origin) referrerHost = referrer.hostname;
  } catch { /* Direct visit has no referrer. */ }
  try {
    const visitor = await fetch('/api/public/statistics/visitor', { method: 'POST', cache: 'no-store' });
    if (!visitor.ok) return;
    await fetch('/api/public/statistics/views', { method: 'POST', cache: 'no-store', keepalive: true,
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ postId, referrerHost }) });
  } catch { /* Optional statistics must never interrupt reading. No retry loop. */ }
}
