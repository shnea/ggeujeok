import { ArgumentsHost, Catch, HttpException, type ExceptionFilter, type ExecutionContext, Injectable, UnauthorizedException, ForbiddenException, Inject, type CanActivate } from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { ZodError } from 'zod';
import { siteOrigin } from './config.js';
import { Sessions, type Session } from './auth/sessions.js';
import { logs } from './operations/logs.js';

export type AuthRequest = Request & { session?: Session; requestId: string };

@Injectable()
export class UserGuard implements CanActivate {
  constructor(@Inject(Sessions) private readonly sessions: Sessions) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    const session = await this.sessions.read(request);
    if (!session?.userId) throw new UnauthorizedException('로그인이 필요합니다.');
    request.session = session;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) checkCsrf(request, session.csrfToken);
    return true;
  }
}

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(@Inject(Sessions) private readonly sessions: Sessions) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    const session = await this.sessions.read(request);
    if (!session?.userId) throw new UnauthorizedException('로그인이 필요합니다.');
    if (!session.isAdmin) throw new ForbiddenException('관리자만 사용할 수 있습니다.');
    request.session = session;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) checkCsrf(request, session.csrfToken);
    return true;
  }
}

export function checkCsrf(request: Request, expected: string) {
  const supplied = request.header('x-csrf-token') || '';
  const a = Buffer.from(supplied), b = Buffer.from(expected);
  if (request.header('origin') !== siteOrigin || a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new ForbiddenException('요청을 확인할 수 없습니다. 새로고침 후 다시 시도해 주세요.');
  }
}

@Catch()
export class Errors implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const request = host.switchToHttp().getRequest<AuthRequest>();
    const response = host.switchToHttp().getResponse<Response>();
    let status = 500, code = 'INTERNAL_ERROR', detail = '처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';
    if (error instanceof ZodError) {
      status = 400; code = 'INVALID_INPUT'; detail = error.issues.map(i => `${i.path.join('.') || '입력'}: ${i.message}`).join(' · ');
    } else if (error instanceof HttpException) {
      status = error.getStatus(); code = `HTTP_${status}`; detail = error.message;
    } else if ((error as { type?: string })?.type === 'entity.too.large') {
      status = 413; code = 'BODY_TOO_LARGE'; detail = '요청 크기가 너무 큽니다. 본문은 2MiB까지 저장할 수 있습니다.';
    } else if ((error as { type?: string })?.type === 'entity.parse.failed') {
      status = 400; code = 'INVALID_JSON'; detail = '올바른 JSON 요청이 필요합니다.';
    } else if ((error as { code?: string })?.code === '23505') {
      status = 409; code = 'DUPLICATE'; detail = '이미 사용 중인 값입니다. 다른 값으로 입력해 주세요.';
    } else if ((error as { code?: string })?.code === '23503') {
      status = 409; code = 'REFERENCED'; detail = '연결된 항목을 확인한 뒤 다시 시도해 주세요.';
    }
    const requestId = request.requestId || randomUUID();
    if (status >= 500) logs.write('request.failed', { requestId, status, component: 'api' });
    const retryAfter = error instanceof HttpException && status === 429
      ? (error.getResponse() as { retryAfterSeconds?: number }).retryAfterSeconds : undefined;
    if (retryAfter) response.setHeader('Retry-After', String(retryAfter));
    response.status(status).type('application/problem+json').json({ status, code, detail, requestId,
      ...(retryAfter ? { retryAfterSeconds: retryAfter } : {}) });
  }
}
