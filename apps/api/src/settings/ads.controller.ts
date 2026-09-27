import { Body, Controller, Delete, Get, Inject, Put, Req, UseGuards } from '@nestjs/common';
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
  @Get() async read() {
    const { provider, enabled, showPlaceholders, adsense, adfit, feed } = await this.settings.read();
    return { provider, enabled, showPlaceholders,
      adsense: enabled && provider === 'adsense' ? adsense : { clientId: '', postSlot: '', sidebarSlot: '', inlineSlot: '' },
      adfit: enabled && provider === 'adfit' ? adfit : null,
      feed: enabled && provider === 'adsense' && feed.enabled ? feed : { enabled: feed.enabled, slot: '', layoutKey: '' } };
  }
}
