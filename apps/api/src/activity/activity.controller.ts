import { Body, Controller, Delete, Get, Inject, Param, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { Sessions } from '../auth/sessions.js';
import { AdminGuard, UserGuard, type AuthRequest } from '../http.js';
import { slug, uuid } from '../posts/post-input.js';
import { Activity } from './activity.service.js';
import { Captchas } from './captcha.service.js';

@Controller('api/guest')
export class GuestActivityController {
  constructor(@Inject(Activity) private readonly activity: Activity, @Inject(Captchas) private readonly captchas: Captchas) {}
  @Get('captcha') captcha(@Req() request: AuthRequest, @Res({passthrough:true}) response: Response) { return this.captchas.issue(request,response); }
  @Post('posts/:postId/comments') async create(@Param('postId') post: string, @Req() request: AuthRequest, @Body() input: unknown) {
    const client = await this.captchas.consume(request,input);
    return this.activity.guestCreate(uuid.parse(post),client,input);
  }
  @Put('posts/:postId/comments/:id') async edit(@Param('postId') post: string, @Param('id') id: string, @Req() request: AuthRequest, @Body() input: unknown) {
    await this.captchas.consume(request,input);
    return this.activity.guestChange(uuid.parse(post),uuid.parse(id),input,false);
  }
  @Delete('posts/:postId/comments/:id') async remove(@Param('postId') post: string, @Param('id') id: string, @Req() request: AuthRequest, @Body() input: unknown) {
    await this.captchas.consume(request,input);
    return this.activity.guestChange(uuid.parse(post),uuid.parse(id),input,true);
  }
}

@Controller('api/public/posts')
export class PublicActivityController {
  constructor(@Inject(Activity) private readonly activity: Activity, @Inject(Sessions) private readonly sessions: Sessions) {}
  @Get(':slug/interactions') async read(@Param('slug') value: string, @Query('page') page: unknown, @Req() request: AuthRequest) {
    return this.activity.read(slug.parse(value), await this.sessions.read(request), page);
  }
  @Get(':slug/comments/:id/replies') async replies(@Param('slug') value: string, @Param('id') id: string, @Query('page') page: unknown, @Req() request: AuthRequest) {
    return this.activity.replies(slug.parse(value),uuid.parse(id),await this.sessions.read(request),page);
  }
  @Get(':slug/comments/:id/location') location(@Param('slug') value:string,@Param('id') id:string) {
    return this.activity.location(slug.parse(value),uuid.parse(id));
  }
}

@Controller('api/admin/comments')
@UseGuards(AdminGuard)
export class AdminCommentsController {
  constructor(@Inject(Activity) private readonly activity: Activity) {}
  @Get() list(@Query('page') page: unknown,@Query('comment') target:unknown) { return this.activity.adminComments(page,target === undefined ? undefined : uuid.parse(target)); }
}

@Controller('api/posts/:postId')
@UseGuards(UserGuard)
export class ActivityController {
  constructor(@Inject(Activity) private readonly activity: Activity) {}
  @Post('comments') create(@Param('postId') post: string, @Req() request: AuthRequest, @Body() input: unknown) {
    return this.activity.create(uuid.parse(post), request.session!, input);
  }
  @Put('comments/:id') edit(@Param('postId') post: string, @Param('id') id: string, @Req() request: AuthRequest, @Body() input: unknown) {
    return this.activity.edit(uuid.parse(post), uuid.parse(id), request.session!, input);
  }
  @Delete('comments/:id') remove(@Param('postId') post: string, @Param('id') id: string, @Req() request: AuthRequest) {
    return this.activity.remove(uuid.parse(post), uuid.parse(id), request.session!);
  }
  @Put('like') like(@Param('postId') post: string, @Req() request: AuthRequest) { return this.activity.like(uuid.parse(post), request.session!, true); }
  @Delete('like') unlike(@Param('postId') post: string, @Req() request: AuthRequest) { return this.activity.like(uuid.parse(post), request.session!, false); }
}
