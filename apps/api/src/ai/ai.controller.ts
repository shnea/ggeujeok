import { Body, Controller, Get, Inject, Param, Post, Put, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { AdminGuard, type AuthRequest } from '../http.js';
import { config } from '../config.js';
import { Ai } from './ai.service.js';

@Controller('api/admin/ai')
@UseGuards(AdminGuard)
export class AdminAiController {
  constructor(@Inject(Ai) private readonly ai: Ai) {}
  @Get('settings') settings() { return this.ai.settings(); }
  @Put('settings') save(@Body() input:unknown,@Req() request:AuthRequest) { return this.ai.saveSettings(input,request.session!.userId!); }
  @Get('tasks') tasks() { return this.ai.list(); }
  @Get('tasks/:id') status(@Param('id') id:string) { return this.ai.status(z.uuid().parse(id)); }
  @Post('articles') article(@Body() input:unknown,@Req() request:AuthRequest) { return this.ai.requestArticle(input,request.session!.userId!); }
  @Post('posts/:id/summary') summary(@Param('id') id:string,@Req() request:AuthRequest) { return this.ai.requestSummary(z.uuid().parse(id),request.session!.userId!); }
  @Post('posts/:id/tags') tags(@Param('id') id:string,@Req() request:AuthRequest) { return this.ai.requestTags(z.uuid().parse(id),request.session!.userId!); }
  @Post('tasks/:id/retry') retry(@Param('id') id:string) { return this.ai.retry(z.uuid().parse(id)); }
}

// This token has ONLY request-cache access. It cannot publish a post or insert a comment.
@Controller('api/automation/ai/tasks')
export class AiCacheController {
  constructor(@Inject(Ai) private readonly ai: Ai) {}
  private authenticate(request:AuthRequest) {
    const expected=config.AI_CALLBACK_TOKEN, supplied=request.header('authorization') ?? '';
    const hash=(value:string)=>createHash('sha256').update(value).digest();
    if (!expected || !timingSafeEqual(hash(supplied),hash(`Bearer ${expected}`))) throw new UnauthorizedException();
  }
  @Post(':id/claim') claim(@Param('id') id:string,@Body() input:unknown,@Req() request:AuthRequest) {
    this.authenticate(request); return this.ai.claim(z.uuid().parse(id),input);
  }
  @Put(':id/result') result(@Param('id') id:string,@Body() input:unknown,@Req() request:AuthRequest) {
    this.authenticate(request); return this.ai.cacheResult(z.uuid().parse(id),input);
  }
  @Post(':id/failure') failure(@Param('id') id:string,@Body() input:unknown,@Req() request:AuthRequest) {
    this.authenticate(request); return this.ai.cacheFailure(z.uuid().parse(id),input);
  }
}
