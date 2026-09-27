import { Body, Controller, Get, Inject, Put, Req, UseGuards } from '@nestjs/common';
import { AdminGuard, type AuthRequest } from '../http.js';
import { SiteSettings } from './site.service.js';

@Controller('api/admin/settings/site')
@UseGuards(AdminGuard)
export class AdminSiteSettingsController {
  constructor(@Inject(SiteSettings) private readonly settings: SiteSettings) {}
  @Get() read() { return this.settings.read(); }
  @Put() save(@Body() value: unknown, @Req() req: AuthRequest) { return this.settings.save(value, req.session!.userId!); }
}

@Controller('api/public/settings/site')
export class PublicSiteSettingsController {
  constructor(@Inject(SiteSettings) private readonly settings: SiteSettings) {}
  @Get() async read() {
    const data = await this.settings.read();
    return { ...data, ga4MeasurementId: data.analyticsMode === 'ga4' ? data.ga4MeasurementId : '',
      gtmContainerId: data.analyticsMode === 'gtm' ? data.gtmContainerId : '' };
  }
}
