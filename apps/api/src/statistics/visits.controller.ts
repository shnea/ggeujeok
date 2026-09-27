import { Body, Controller, Get, HttpCode, Inject, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Sessions } from '../auth/sessions.js';
import { siteOrigin } from '../config.js';
import { AdminGuard } from '../http.js';
import { Visits, visitDay } from './visits.service.js';

const cookieName = 'ggeujeok_visit';
const viewInput = z.object({ postId: z.uuid(), referrerHost: z.string().max(253).default('') }).strict();
export function visitEligible(request: Request) {
  return request.header('origin') === siteOrigin && request.header('dnt') !== '1' && request.header('sec-gpc') !== '1'
    && !/prefetch|prerender/i.test(`${request.header('purpose') || ''} ${request.header('sec-purpose') || ''}`)
    && !/bot|crawler|spider|headless|preview|slurp|facebookexternalhit/i.test(request.header('user-agent') || '');
}
export function visitorToken(request: Request, day = visitDay()) {
  const value = request.headers.cookie?.split(';').map(item => item.trim()).find(item => item.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
  return value?.startsWith(`${day}.`) && /^\d{4}-\d{2}-\d{2}\.[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}
export function safeReferrer(host: string) {
  // Domains only: no IP, credentials, paths, queries or internal referrers.
  const value = host.toLowerCase();
  return value !== new URL(siteOrigin).hostname && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/.test(value) ? value : '';
}

@Controller('api/public/statistics')
export class PublicVisitsController {
  constructor(@Inject(Visits) private readonly visits: Visits, @Inject(Sessions) private readonly sessions: Sessions) {}

  private async eligible(request: Request) { return visitEligible(request) && !(await this.sessions.read(request))?.isAdmin; }

  @Post('visitor') @HttpCode(204)
  async visitor(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    if (!await this.eligible(request) || visitorToken(request)) return;
    response.cookie(cookieName, `${visitDay()}.${randomBytes(32).toString('base64url')}`, {
      httpOnly: true, secure: true, sameSite: 'lax', path: '/api/public/statistics', maxAge: 86400000,
    });
  }

  @Post('views') @HttpCode(204)
  async record(@Req() request: Request, @Body() input: unknown) {
    if (!await this.eligible(request)) return;
    const token = visitorToken(request);
    if (!token) return; // Cookie blocked: never manufacture a visitor per request.
    const data = viewInput.parse(input);
    await this.visits.record(data.postId, createHash('sha256').update(token).digest('hex'), safeReferrer(data.referrerHost));
  }
}

@Controller('api/admin/statistics') @UseGuards(AdminGuard)
export class AdminVisitsController {
  constructor(@Inject(Visits) private readonly visits: Visits) {}
  @Get() report(@Query('days') value?: string) {
    const days = z.enum(['7', '30', '90']).default('30').parse(value);
    return this.visits.report(Number(days));
  }
}
