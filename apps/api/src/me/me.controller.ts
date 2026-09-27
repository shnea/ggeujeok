import { Controller, Get, Post, Put, Body, Param, Query, Req, Inject, UseGuards } from '@nestjs/common';
import { UserGuard, type AuthRequest } from '../http.js';
import { uuid } from '../posts/post-input.js';
import { Notifications } from '../notifications/notifications.service.js';
import { MyActivity } from './me.service.js';

@Controller('api/me')
@UseGuards(UserGuard)
export class MeController {
  constructor(@Inject(MyActivity) private readonly activity:MyActivity,@Inject(Notifications) private readonly notifications:Notifications) {}
  @Get('profile') profile(@Req() req:AuthRequest) {return this.activity.profile(req.session!);}
  @Put('profile') updateProfile(@Req() req:AuthRequest,@Body() input:unknown) {return this.activity.updateProfile(req.session!,input);}
  @Get('comments') comments(@Req() req:AuthRequest,@Query('page') page:unknown) {return this.activity.comments(req.session!,page);}
  @Get('likes') likes(@Req() req:AuthRequest,@Query('page') page:unknown) {return this.activity.likes(req.session!,page);}
  @Get('notifications') list(@Req() req:AuthRequest,@Query('page') page:unknown) {return this.notifications.list(req.session!,page);}
  @Get('notifications/unread-count') unread(@Req() req:AuthRequest) {return this.notifications.unread(req.session!);}
  @Post('notifications/read-all') readAll(@Req() req:AuthRequest) {return this.notifications.readAll(req.session!);}
  @Post('notifications/:id/read') read(@Req() req:AuthRequest,@Param('id') id:string) {return this.notifications.read(req.session!,uuid.parse(id));}
  @Get('notifications/:id/destination') destination(@Req() req:AuthRequest,@Param('id') id:string) {return this.notifications.destination(req.session!,uuid.parse(id));}
}
