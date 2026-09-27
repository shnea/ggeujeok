import 'reflect-metadata';
import { Controller, Get, Inject, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { json, raw } from 'express';
import { randomUUID } from 'node:crypto';
import { config, validateAuthConfig } from './config.js';
import { Database, DatabaseModule } from './database/database.js';
import { Sessions } from './auth/sessions.js';
import { AuthController } from './auth/auth.controller.js';
import { AdminGuard, UserGuard, Errors, type AuthRequest } from './http.js';
import { PostsController, AdminPostsController, AdminTagsController } from './posts/posts.controller.js';
import { Posts } from './posts/posts.service.js';
import { AdminImagesController, ImagesController } from './files/images.controller.js';
import { Images } from './files/images.service.js';
import { PlatformFiles } from './files/platform-files.js';
import { Categories } from './posts/categories.service.js';
import { CategoriesController } from './posts/categories.controller.js';
import { Activity } from './activity/activity.service.js';
import { ActivityController, PublicActivityController, GuestActivityController, AdminCommentsController } from './activity/activity.controller.js';
import { Captchas } from './activity/captcha.service.js';
import { Notifications } from './notifications/notifications.service.js';
import { MyActivity } from './me/me.service.js';
import { AdSettings } from './settings/ads.service.js';
import { SiteSettings } from './settings/site.service.js';
import { AdminSiteSettingsController, PublicSiteSettingsController } from './settings/site.controller.js';
import { AdminAdSettingsController, PublicAdSettingsController } from './settings/ads.controller.js';
import { MeController } from './me/me.controller.js';

@Controller('api')
class HealthController {
  constructor(@Inject(Database) private readonly db: Database) {}
  @Get('health') async health() { await this.db.query('SELECT 1'); return { status: 'ok' }; }
}

@Module({ imports: [DatabaseModule], controllers: [HealthController, AuthController, PostsController, AdminPostsController, AdminTagsController, AdminImagesController, ImagesController, CategoriesController, ActivityController, PublicActivityController, GuestActivityController, AdminCommentsController, MeController, AdminAdSettingsController, PublicAdSettingsController, AdminSiteSettingsController, PublicSiteSettingsController],
  providers: [Sessions, AdminGuard, UserGuard, Posts, Images, PlatformFiles, Categories, Activity, Captchas, Notifications, MyActivity, AdSettings, SiteSettings] })
class AppModule {}

validateAuthConfig();
const app = await NestFactory.create(AppModule, { bodyParser: false });
app.use((request: AuthRequest, response: import('express').Response, next: () => void) => {
  request.requestId = randomUUID();
  response.setHeader('X-Request-Id', request.requestId);
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});
app.use('/api/admin/uploads', raw({ type: 'application/octet-stream', limit: '4mb' }));
app.use(json({ limit: '2200kb' }));
app.useGlobalFilters(new Errors());
app.enableShutdownHooks();
await app.listen(config.PORT, '0.0.0.0');
