import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { Database } from '../database/database.js';

const input = z.object({
  name: z.string().trim().min(1).max(40),
  description: z.string().trim().max(200),
  imageUrl: z.string().trim().max(2000).refine(value => {
    if (!value) return true;
    try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; }
  }, '공개된 이미지의 HTTPS 주소를 입력해 주세요.'),
  operatorName: z.string().trim().min(1).max(80),
  contactEmail: z.email().max(254),
  naverToken: z.string().trim().max(256).regex(/^[A-Za-z0-9_-]*$/, '네이버 HTML 태그의 content 값만 입력해 주세요.'),
  searchConsoleToken: z.string().trim().max(256).regex(/^[A-Za-z0-9_-]*$/, '서치콘솔 HTML 태그의 content 값만 입력해 주세요.'),
  analyticsMode: z.enum(['off', 'ga4', 'gtm']),
  ga4MeasurementId: z.string().trim().regex(/^(?:G-[A-Z0-9]{4,20})?$/, 'GA4 측정 ID는 G-로 시작합니다.'),
  gtmContainerId: z.string().trim().regex(/^(?:GTM-[A-Z0-9]{4,20})?$/, '태그 관리자 컨테이너 ID는 GTM-으로 시작합니다.'),
}).strict();

@Injectable()
export class SiteSettings {
  constructor(@Inject(Database) private readonly db: Database) {}
  async read() {
    const row = (await this.db.query('SELECT * FROM site_settings WHERE singleton=true')).rows[0];
    return { name: row?.name ?? '끄적', description: row?.description ?? '끄적의 공개 게시글 목록입니다.',
      imageUrl: row?.image_url ?? '', operatorName: row?.operator_name ?? '끄적 운영자', contactEmail: row?.contact_email ?? 'shnea@kakao.com',
      naverToken: row?.naver_token ?? '', searchConsoleToken: row?.search_console_token ?? '', analyticsMode: row?.analytics_mode ?? 'off',
      ga4MeasurementId: row?.ga4_measurement_id ?? '', gtmContainerId: row?.gtm_container_id ?? '' };
  }
  async save(value: unknown, actor: string) {
    const data = input.parse(value);
    if (data.analyticsMode === 'ga4' && !data.ga4MeasurementId) throw new BadRequestException('GA4 측정 ID를 입력해 주세요.');
    if (data.analyticsMode === 'gtm' && !data.gtmContainerId) throw new BadRequestException('태그 관리자 컨테이너 ID를 입력해 주세요.');
    await this.db.transaction(async tx => {
      await tx.query(`INSERT INTO site_settings(singleton,search_console_token,analytics_mode,ga4_measurement_id,gtm_container_id)
        VALUES(true,$1,$2,$3,$4) ON CONFLICT(singleton) DO UPDATE SET
        search_console_token=EXCLUDED.search_console_token,analytics_mode=EXCLUDED.analytics_mode,
        ga4_measurement_id=EXCLUDED.ga4_measurement_id,gtm_container_id=EXCLUDED.gtm_container_id`,
      [data.searchConsoleToken, data.analyticsMode, data.ga4MeasurementId, data.gtmContainerId]);
      await tx.query(`UPDATE site_settings SET name=$1,description=$2,image_url=$3,operator_name=$4,contact_email=$5,naver_token=$6 WHERE singleton=true`,
        [data.name, data.description, data.imageUrl, data.operatorName, data.contactEmail, data.naverToken]);
      await tx.query("INSERT INTO audit_events(actor_id,action) VALUES($1,'site.update')", [actor]);
    });
    return data;
  }
}
