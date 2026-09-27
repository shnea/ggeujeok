import { Body, Controller, Delete, Get, Header, Inject, NotFoundException, Put, Req, UseGuards } from '@nestjs/common';
import { AdminGuard, type AuthRequest } from '../http.js';
import { AdSettings } from './ads.service.js';

@Controller('api/admin/settings/ads')
@UseGuards(AdminGuard)
export class AdminAdSettingsController {
  constructor(@Inject(AdSettings) private readonly settings: AdSettings) {}
  @Get() read() { return this.settings.read(); }
  @Put() save(@Body() input: unknown, @Req() req: AuthRequest) { return this.settings.save(input, req.session!.userId!); }
  @Delete() reset(@Req() req: AuthRequest) { return this.settings.reset(req.session!.userId!); }
}

@Controller('api/public/settings/ads')
export class PublicAdSettingsController {
  constructor(@Inject(AdSettings) private readonly settings: AdSettings) {}
  @Get('ads.txt')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  async adsTxt() {
    const { adsense } = await this.settings.read();
    if (!/^ca-pub-\d{16}$/.test(adsense.clientId)) throw new NotFoundException('AdSense 게시자 ID가 설정되지 않았습니다.');
    // Seller authorization remains available while ad display is disabled.
    return `google.com, ${adsense.clientId.slice(3)}, DIRECT, f08c47fec0942fa0\n`;
  }
  @Get() async read() {
    const { provider, enabled, showPlaceholders, adsense, adfit, feed } = await this.settings.read();
    return { provider, enabled, showPlaceholders,
      adsense: enabled && provider === 'adsense' ? adsense : { clientId: '', postSlot: '', sidebarSlot: '', inlineSlot: '' },
      adfit: enabled && provider === 'adfit' ? adfit : null,
      feed: enabled && provider === 'adsense' && feed.enabled ? feed : { enabled: feed.enabled, slot: '', layoutKey: '' } };
  }
}
