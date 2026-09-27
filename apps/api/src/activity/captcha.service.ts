import { BadRequestException, ForbiddenException, HttpException, Injectable, Inject } from '@nestjs/common';
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import type { PoolClient } from 'pg';
import sharp from 'sharp';
import { z } from 'zod';
import { Database } from '../database/database.js';
import { siteOrigin } from '../config.js';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const digits = ['11111/00001/00001/11111/10000/10000/11111','11111/00001/00001/11111/00001/00001/11111',
  '10001/10001/10001/11111/00001/00001/00001','11111/10000/10000/11111/00001/00001/11111',
  '11111/10000/10000/11111/10001/10001/11111','11111/00001/00010/00100/01000/01000/01000',
  '11111/10001/10001/11111/10001/10001/11111','11111/10001/10001/11111/00001/00001/11111'];

@Injectable()
export class Captchas {
  constructor(@Inject(Database) private readonly db: Database) {}
  private client(request: Request) {
    const token = request.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith('ggeujeok_guest='))?.slice(15);
    return token && /^[a-zA-Z0-9_-]{43}$/.test(token) ? token : null;
  }

  async limit(tx: PoolClient, client: string, action: 'challenge' | 'comment') {
    const column = action === 'challenge' ? 'challenge_events' : 'comment_events';
    const row = (await tx.query(`SELECT ${column} AS events,clock_timestamp() AS now FROM guest_clients WHERE token_hash=$1 FOR UPDATE`, [client])).rows[0];
    if (!row) throw new BadRequestException('보안문자를 새로 받아 주세요.');
    const now = row.now.getTime(), events = (row.events as Date[]).map(value => value.getTime()).filter(value => value > now - 3600000).sort((a,b)=>a-b);
    const minute = events.filter(value => value > now - 60000), waits: number[] = [];
    if (minute.length >= (action === 'challenge' ? 20 : 5)) waits.push(minute[0] + 60000 - now);
    if (events.length >= (action === 'challenge' ? 100 : 60)) waits.push(events[0] + 3600000 - now);
    if (waits.length) {
      const retryAfterSeconds = Math.max(1, Math.ceil(Math.max(...waits) / 1000));
      throw new HttpException({ message: `${retryAfterSeconds}초 뒤 다시 시도해 주세요.`, retryAfterSeconds }, 429);
    }
    await tx.query(`UPDATE guest_clients SET ${column}=$2,updated_at=now() WHERE token_hash=$1`, [client, [...events,now].map(value=>new Date(value))]);
  }

  async issue(request: Request, response: Response) {
    const token = this.client(request) || randomBytes(32).toString('base64url'), client = hash(token);
    const id = randomUUID(), answer = Array.from({length:6},()=>String(randomInt(2,10))).join('');
    await this.db.transaction(async tx => {
      await tx.query("DELETE FROM guest_clients WHERE updated_at<now()-interval '1 day'");
      await tx.query('INSERT INTO guest_clients(token_hash) VALUES($1) ON CONFLICT DO NOTHING', [client]);
      await this.limit(tx, client, 'challenge');
      await tx.query("DELETE FROM comment_captchas WHERE client_hash=$1 OR expires_at<now()", [client]);
      await tx.query("INSERT INTO comment_captchas(id,client_hash,answer_hash,expires_at) VALUES($1,$2,$3,now()+interval '5 minutes')", [id,client,hash(id+answer)]);
    });
    let shapes = '';
    [...answer].forEach((value,index) => {
      const cells = digits[Number(value)-2].split('/').flatMap((row,y)=>[...row].flatMap((pixel,x)=>pixel==='1' ? [`<rect x="${x*4}" y="${y*4}" width="4" height="4"/>`] : [])).join('');
      shapes += `<g transform="translate(${14+index*31} ${12+randomInt(0,6)}) rotate(${randomInt(-9,10)} 10 14)" fill="#244f40">${cells}</g>`;
    });
    for(let i=0;i<40;i++) shapes+=`<circle cx="${randomInt(210)}" cy="${randomInt(60)}" r="1" fill="#82917f"/>`;
    const image = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="210" height="60"><rect width="210" height="60" fill="#f8f7f2"/>${shapes}</svg>`)).png().toBuffer();
    response.cookie('ggeujeok_guest', token, {httpOnly:true,secure:true,sameSite:'lax',path:'/',maxAge:86400000});
    return { id, image: `data:image/png;base64,${image.toString('base64')}`, expiresIn:300 };
  }

  async consume(request: Request, input: unknown) {
    if (request.header('origin') !== siteOrigin) throw new ForbiddenException('요청 출처를 확인할 수 없습니다.');
    const { captchaId, captchaAnswer } = z.object({captchaId:z.uuid(),captchaAnswer:z.string().regex(/^[2-9]{6}$/)}).parse(input);
    const token = this.client(request);
    if (!token) throw new BadRequestException('보안문자를 새로 받아 주세요.');
    // Consume outside the comment transaction so failed passwords/answers cannot reuse a challenge.
    const result = await this.db.query('DELETE FROM comment_captchas WHERE id=$1 AND client_hash=$2 RETURNING answer_hash,expires_at', [captchaId,hash(token)]);
    const row = result.rows[0];
    if (!row || row.expires_at.getTime() <= Date.now() || !timingSafeEqual(Buffer.from(row.answer_hash,'hex'),Buffer.from(hash(captchaId+captchaAnswer),'hex'))) {
      throw new BadRequestException('보안문자가 틀렸거나 만료됐습니다. 새 보안문자로 다시 시도해 주세요.');
    }
    return hash(token);
  }
}
