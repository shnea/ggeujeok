import { api } from './api';

export function serverApi<T>(path: string) {
  return api<T>(`${process.env.API_INTERNAL_URL || 'http://127.0.0.1:30101'}${path}`, { signal: AbortSignal.timeout(8000) });
}
export function siteUrl() { return process.env.SITE_URL || 'https://shnea.kr'; }
