import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import { Database } from '../database/database.js';
import { config, siteOrigin } from '../config.js';

const cookieName = 'ggeujeok_session';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export const newSecret = () => randomBytes(32).toString('base64url');
export type Session = { userId: string | null; name: string | null; nickname?: string | null; isAdmin: boolean; csrfToken: string; data: Record<string, string> };

@Injectable()
export class Sessions {
  constructor(@Inject(Database) private readonly db: Database) {}

  token(request: Request) {
    const value = request.headers.cookie?.split(';').map(c => c.trim()).find(c => c.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
    return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
  }

  async read(request: Request): Promise<Session | null> {
    const token = this.token(request);
    if (!token) return null;
    const result = await this.db.query(`SELECT s.*, u.issuer, u.subject, u.display_name,COALESCE(u.custom_nickname,u.nickname) AS nickname FROM sessions s
      LEFT JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()
      AND s.created_at>now()-interval '7 days' AND s.last_seen_at>now()-interval '24 hours'`, [hash(token)]);
    const row = result.rows[0];
    if (!row) return null;
    await this.db.query("UPDATE sessions SET last_seen_at=now() WHERE token_hash=$1 AND last_seen_at<now()-interval '5 minutes'", [hash(token)]);
    return { userId: row.user_id, name: row.display_name, nickname: row.nickname, csrfToken: row.csrf_token, data: row.data,
      isAdmin: Boolean(config.ADMIN_OIDC_ISSUER && config.ADMIN_OIDC_SUBJECT && row.issuer === config.ADMIN_OIDC_ISSUER && row.subject === config.ADMIN_OIDC_SUBJECT) };
  }

  async create(response: Response, userId: string | null, data: Record<string, string> = {}) {
    const token = newSecret(), seconds = userId ? 7 * 86400 : 600;
    await this.db.query('INSERT INTO sessions(token_hash,user_id,csrf_token,data,expires_at) VALUES($1,$2,$3,$4,now()+$5*interval \'1 second\')',
      [hash(token), userId, newSecret(), data, seconds]);
    response.cookie(cookieName, token, { httpOnly: true, secure: siteOrigin.startsWith('https://'), sameSite: 'lax', path: '/', maxAge: seconds * 1000 });
  }

  async destroy(request: Request, response: Response) {
    const token = this.token(request);
    if (token) await this.db.query('DELETE FROM sessions WHERE token_hash=$1', [hash(token)]);
    response.clearCookie(cookieName, { path: '/', httpOnly: true, secure: siteOrigin.startsWith('https://'), sameSite: 'lax' });
  }

  // Consume the temporary login session once, before exchanging the authorization code.
  async consumeLogin(request: Request) {
    const token = this.token(request);
    if (!token) return null;
    const result = await this.db.query("DELETE FROM sessions WHERE token_hash=$1 AND user_id IS NULL AND expires_at>now() RETURNING data", [hash(token)]);
    return result.rows[0]?.data as Record<string, string> | undefined;
  }
}
