import { Controller, Get, Post, Req, Res, Inject, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import * as oidc from 'openid-client';
import { config, oidcConfigured, siteOrigin } from '../config.js';
import { Database } from '../database/database.js';
import { checkCsrf } from '../http.js';
import { Sessions } from './sessions.js';
import { platformNickname, syncPlatformUser } from './platform-profile.js';

let provider: Promise<oidc.Configuration> | undefined;
function getProvider() {
  if (!oidcConfigured) throw new ServiceUnavailableException('로그인 연결 설정이 아직 준비되지 않았습니다.');
  provider ??= oidc.discovery(new URL(config.PLATFORM_OIDC_ISSUER), config.PLATFORM_OIDC_CLIENT_ID,
    undefined, oidc.None(), { execute: [oidc.enableNonRepudiationChecks], timeout: 10 })
    .catch(error => { provider = undefined; throw error; });
  return provider;
}

export function safeReturnPath(value: unknown) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/';
  try { return new URL(value, siteOrigin).origin === siteOrigin ? value : '/'; } catch { return '/'; }
}

@Controller()
export class AuthController {
  constructor(@Inject(Sessions) private readonly sessions: Sessions, @Inject(Database) private readonly db: Database) {}

  @Get('api/auth/session')
  async session(@Req() request: Request) {
    const session = await this.sessions.read(request);
    return { configured: oidcConfigured, user: session?.userId ? { id: session.userId, name: session.name, nickname: session.nickname, isAdmin: session.isAdmin } : null,
      csrfToken: session?.userId ? session.csrfToken : null };
  }

  @Get('auth/login')
  async login(@Req() request: Request, @Res() response: Response) {
    if (!oidcConfigured) return response.redirect('/login?reason=setup');
    const server = await getProvider();
    const verifier = oidc.randomPKCECodeVerifier(), state = oidc.randomState(), nonce = oidc.randomNonce();
    const target = oidc.buildAuthorizationUrl(server, { redirect_uri: config.PLATFORM_OIDC_REDIRECT_URI,
      scope: 'openid profile email', code_challenge_method: 'S256', code_challenge: await oidc.calculatePKCECodeChallenge(verifier), state, nonce });
    await this.sessions.destroy(request, response);
    await this.sessions.create(response, null, { verifier, state, nonce, returnTo: safeReturnPath(request.query.returnTo) });
    response.redirect(target.href);
  }

  @Get(['auth/callback', 'callback'])
  async callback(@Req() request: Request, @Res() response: Response) {
    const login = await this.sessions.consumeLogin(request);
    if (!login) return response.redirect('/login?reason=expired');
    try {
      const server = await getProvider();
      const callback = new URL(config.PLATFORM_OIDC_REDIRECT_URI);
      callback.search = new URL(request.originalUrl, siteOrigin).search;
      const tokens = await oidc.authorizationCodeGrant(server, callback,
        { pkceCodeVerifier: login.verifier, expectedState: login.state, expectedNonce: login.nonce, idTokenExpected: true });
      const claims = tokens.claims();
      if (!claims?.sub || claims.iss !== config.PLATFORM_OIDC_ISSUER) throw new UnauthorizedException();
      const nickname = platformNickname(claims) ?? platformNickname(
        await oidc.fetchUserInfo(server, tokens.access_token, claims.sub));
      if (!nickname) return response.redirect(`/login?reason=profile&returnTo=${encodeURIComponent(safeReturnPath(login.returnTo))}`);
      const userId = await syncPlatformUser(this.db, claims.iss, claims.sub, nickname);
      await this.sessions.create(response, userId);
      response.redirect(safeReturnPath(login.returnTo));
    } catch {
      // Provider responses and tokens must never enter application logs.
      response.redirect(`/login?reason=failed&returnTo=${encodeURIComponent(safeReturnPath(login.returnTo))}`);
    }
  }

  @Post('auth/logout')
  async logout(@Req() request: Request, @Res() response: Response) {
    const session = await this.sessions.read(request);
    if (!session?.userId) throw new UnauthorizedException();
    checkCsrf(request, session.csrfToken);
    await this.sessions.destroy(request, response);
    let redirectTo = '/';
    try {
      const server = await getProvider();
      if (server.serverMetadata().end_session_endpoint) redirectTo = oidc.buildEndSessionUrl(server, {
        client_id: config.PLATFORM_OIDC_CLIENT_ID,
        post_logout_redirect_uri: config.OIDC_POST_LOGOUT_REDIRECT_URI || `${siteOrigin}/`,
      }).href;
    } catch { /* Local logout succeeds even when the provider is unavailable. */ }
    response.json({ redirectTo });
  }
}
