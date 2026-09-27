import { z } from 'zod';

const environment = z.object({
  APP_ENV: z.enum(['development', 'test', 'production']).default('development'),
  SITE_URL: z.url().default('https://shnea.kr'),
  PORT: z.coerce.number().int().min(1).max(65535).default(30101),
  DATABASE_URL: z.string().optional(),
  PGHOST: z.string().default('127.0.0.1'),
  PGPORT: z.coerce.number().default(5432),
  PGDATABASE: z.string().default('ggeujeok'),
  PGUSER: z.string().default('ggeujeok'),
  PGPASSWORD: z.string().default(''),
  PLATFORM_OIDC_ISSUER: z.string().default(''),
  PLATFORM_OIDC_CLIENT_ID: z.string().default('app'),
  PLATFORM_OIDC_REDIRECT_URI: z.string().default(''),
  OIDC_POST_LOGOUT_REDIRECT_URI: z.string().default(''),
  ADMIN_OIDC_ISSUER: z.string().default(''),
  ADMIN_OIDC_SUBJECT: z.string().default(''),
  PLATFORM_URL: z.string().default('https://platform.shnea.kr'),
  PLATFORM_API_KEY: z.string().default(''),
  PLATFORM_PROJECT_ID: z.string().default(''),
  PLATFORM_ENVIRONMENT_ID: z.string().default(''),
  PLATFORM_WORKER_API_KEY: z.string().default(''),
  N8N_WEBHOOK_BASE_URL: z.string().default(''),
  N8N_WEBHOOK_TOKEN: z.string().default(''),
  AI_CALLBACK_TOKEN: z.string().default(''),
  ADS_PROVIDER: z.enum(['adsense','adfit']).default('adsense'),
  ADS_ENABLED: z.enum(['true','false']).optional(),
  ADS_SHOW_PLACEHOLDERS: z.enum(['true','false']).optional(),
  ADSENSE_CLIENT_ID: z.string().default(''),
  ADSENSE_POST_SLOT: z.string().default(''),
  ADSENSE_SIDEBAR_SLOT: z.string().default(''),
  ADSENSE_INLINE_SLOT: z.string().default(''),
  ADSENSE_ENABLED: z.enum(['true', 'false']).default('false'),
  ADSENSE_SHOW_PLACEHOLDERS: z.enum(['true', 'false']).default('false'),
  UPLOAD_DIRECTORY: z.string().default('/app/uploads'),
});

// Fail without printing environment values (which may include credentials).
const parsed = environment.safeParse(process.env);
if (!parsed.success) throw new Error(`환경 설정을 확인하세요: ${parsed.error.issues.map(i => i.path.join('.')).join(', ')}`);
export const config = parsed.data;
export const siteOrigin = new URL(config.SITE_URL).origin;
if (config.APP_ENV === 'production' && !siteOrigin.startsWith('https://')) {
  throw new Error('운영 SITE_URL은 HTTPS 주소여야 합니다.');
}
export const oidcConfigured = Boolean(config.PLATFORM_OIDC_ISSUER && config.PLATFORM_OIDC_REDIRECT_URI);
export function validateAuthConfig() {
  if (!oidcConfigured) return;
  const issuer = new URL(config.PLATFORM_OIDC_ISSUER);
  const callback = new URL(config.PLATFORM_OIDC_REDIRECT_URI);
  if (issuer.protocol !== 'https:' || callback.origin !== siteOrigin || !['/callback', '/auth/callback'].includes(callback.pathname) || callback.search || callback.hash) {
    throw new Error('OIDC issuer는 HTTPS, 콜백은 SITE_URL의 /callback 또는 /auth/callback이어야 합니다.');
  }
  if (config.OIDC_POST_LOGOUT_REDIRECT_URI && new URL(config.OIDC_POST_LOGOUT_REDIRECT_URI).origin !== siteOrigin) {
    throw new Error('로그아웃 복귀 주소는 SITE_URL과 같은 출처여야 합니다.');
  }
}
