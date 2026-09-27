import { Inject, Injectable, BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { Database } from '../database/database.js';
import { config } from '../config.js';

const slot = z.string().trim().max(40).regex(/^\d*$/, '광고 슬롯은 숫자만 입력해 주세요.');
const adsenseInput = z.object({
  clientId: z.string().trim().regex(/^(?:ca-pub-\d{16})?$/, '게시자 ID는 ca-pub-와 숫자 16자리입니다.'),
  postSlot: slot, sidebarSlot: slot, inlineSlot: slot,
}).strict();
const adfitUnit = z.object({
  unitId: z.string().trim().max(128).regex(/^[A-Za-z0-9_-]*$/, '광고단위 ID 형식을 확인해 주세요.'),
  size: z.enum(['160x600','250x250','300x250','320x100','320x50','728x90']),
}).strict();
const adfitInput = z.object({ post: adfitUnit, sidebar: adfitUnit, inline: adfitUnit }).strict();
const feedInput = z.object({ enabled: z.boolean(), slot,
  layoutKey: z.string().trim().max(200).regex(/^[A-Za-z0-9_+-]*$/, '레이아웃 키는 발급 코드의 data-ad-layout-key 값을 입력해 주세요.'),
}).strict();
const input = z.object({ provider: z.enum(['adsense','adfit']), enabled: z.boolean(), showPlaceholders: z.boolean(),
  adsense: adsenseInput, adfit: adfitInput, feed: feedInput.optional() }).strict();
const emptyAdfit = { post: { unitId: '', size: '300x250' }, sidebar: { unitId: '', size: '160x600' }, inline: { unitId: '', size: '728x90' } };


@Injectable()
export class AdSettings {
  constructor(@Inject(Database) private readonly db: Database) {}
  async read() {
    const saved = (await this.db.query('SELECT * FROM ad_settings WHERE singleton=true')).rows[0];
    const defaults = { enabled: (config.ADS_ENABLED ?? config.ADSENSE_ENABLED) === 'true', showPlaceholders: (config.ADS_SHOW_PLACEHOLDERS ?? config.ADSENSE_SHOW_PLACEHOLDERS) === 'true',
      adsense: { clientId: config.ADSENSE_CLIENT_ID, postSlot: config.ADSENSE_POST_SLOT,
        sidebarSlot: config.ADSENSE_SIDEBAR_SLOT, inlineSlot: config.ADSENSE_INLINE_SLOT } };
    return { provider: saved?.provider ?? config.ADS_PROVIDER, enabled: saved?.enabled ?? defaults.enabled, showPlaceholders: saved?.show_placeholders ?? defaults.showPlaceholders,
      adsense: { clientId: saved?.adsense_client_id ?? defaults.adsense.clientId,
        postSlot: saved?.adsense_post_slot ?? defaults.adsense.postSlot, sidebarSlot: saved?.adsense_sidebar_slot ?? defaults.adsense.sidebarSlot,
        inlineSlot: saved?.adsense_inline_slot ?? defaults.adsense.inlineSlot },
      adfit: saved?.adfit ?? emptyAdfit,
      feed: { enabled: saved?.feed_enabled ?? false, slot: saved?.adsense_feed_slot ?? '', layoutKey: saved?.adsense_feed_layout_key ?? '' },
      source: saved ? 'admin' : 'environment' };
  }
  async save(value: unknown, actor: string) {
    const data = input.parse(value);
    const feed = data.feed ?? (await this.read()).feed;
    if (data.enabled && data.provider === 'adsense' && (!data.adsense.clientId || !data.adsense.postSlot)) {
      throw new BadRequestException('실제 광고를 사용하려면 게시자 ID와 글 하단 슬롯을 입력해 주세요.');
    }
    if (data.enabled && data.provider === 'adfit' && !data.adfit.post.unitId) {
      throw new BadRequestException('애드핏을 사용하려면 글 하단 광고단위 ID를 입력해 주세요.');
    }
    if (data.enabled && data.provider === 'adsense' && feed.enabled && (!feed.slot || !feed.layoutKey)) {
      throw new BadRequestException('목록 광고를 사용하려면 인피드 슬롯과 레이아웃 키를 입력해 주세요.');
    }
    await this.db.transaction(async tx => {
      await tx.query(`INSERT INTO ad_settings(singleton,provider,enabled,show_placeholders,adsense_client_id,adsense_post_slot,adsense_sidebar_slot,adsense_inline_slot,adfit)
        VALUES(true,$7,$1,$2,$3,$4,$5,$6,$8) ON CONFLICT(singleton) DO UPDATE SET
        provider=EXCLUDED.provider,enabled=EXCLUDED.enabled,show_placeholders=EXCLUDED.show_placeholders,adsense_client_id=EXCLUDED.adsense_client_id,
        adsense_post_slot=EXCLUDED.adsense_post_slot,adsense_sidebar_slot=EXCLUDED.adsense_sidebar_slot,adsense_inline_slot=EXCLUDED.adsense_inline_slot,adfit=EXCLUDED.adfit`,
        [data.enabled, data.showPlaceholders, data.adsense.clientId, data.adsense.postSlot, data.adsense.sidebarSlot, data.adsense.inlineSlot, data.provider, data.adfit]);
      await tx.query(`UPDATE ad_settings SET feed_enabled=$1,adsense_feed_slot=$2,adsense_feed_layout_key=$3 WHERE singleton=true`,
        [feed.enabled, feed.slot, feed.layoutKey]);
      await tx.query("INSERT INTO audit_events(actor_id,action) VALUES($1,'ads.update')", [actor]);
    });
    return { ...data, feed, source: 'admin' };
  }
  async reset(actor: string) {
    await this.db.transaction(async tx => {
      await tx.query('DELETE FROM ad_settings WHERE singleton=true');
      await tx.query("INSERT INTO audit_events(actor_id,action) VALUES($1,'ads.reset')", [actor]);
    });
    return this.read();
  }
}
