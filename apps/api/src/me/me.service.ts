import { Inject, Injectable, ForbiddenException } from '@nestjs/common';
import { z } from 'zod';
import { Database } from '../database/database.js';
import type { Session } from '../auth/sessions.js';
const customNickname = z.string().trim().normalize('NFC').min(2, '닉네임은 2자 이상 입력해 주세요.')
  .max(30, '닉네임은 30자까지 입력할 수 있습니다.')
  .regex(/^[\p{L}\p{N} _.-]+$/u, '문자·숫자·공백·밑줄·마침표·하이픈만 사용할 수 있습니다.');
const profileColumns = `COALESCE(custom_nickname,nickname) AS nickname,
  nickname AS "defaultNickname", custom_nickname AS "customNickname"`;
const pageInput=z.coerce.number().int().min(1).max(10000).default(1);

@Injectable()
export class MyActivity {
  constructor(@Inject(Database) private readonly db: Database) {}
  async profile(session: Session) {
    const result = await this.db.query(`SELECT ${profileColumns} FROM users WHERE id=$1`, [session.userId]);
    return result.rows[0];
  }
  async updateProfile(session: Session, input: unknown) {
    const { nickname } = z.object({ nickname: customNickname.nullable() }).strict().parse(input);
    if (!session.isAdmin && nickname && ['관리자', '운영자'].includes(nickname)) {
      throw new ForbiddenException('이 닉네임은 사용할 수 없습니다.');
    }
    const result = await this.db.query(`UPDATE users SET custom_nickname=$2 WHERE id=$1 RETURNING ${profileColumns}`,
      [session.userId, nickname]);
    return result.rows[0];
  }
  async comments(session: Session, input: unknown) {
    const page=pageInput.parse(input), params=[session.userId,session.isAdmin];
    const where="c.user_id=$1 AND c.status='VISIBLE' AND (p.status='PUBLIC' OR $2)";
    const items=await this.db.query(`SELECT c.id,c.content,c.parent_id AS "parentId",c.created_at AS "createdAt",c.updated_at AS "updatedAt",
      p.id AS "postId",p.title,p.slug,p.status FROM comments c JOIN posts p ON p.id=c.post_id
      WHERE ${where} ORDER BY c.created_at DESC,c.id DESC LIMIT 20 OFFSET $3`,[...params,(page-1)*20]);
    const count=await this.db.query(`SELECT count(*)::int AS total FROM comments c JOIN posts p ON p.id=c.post_id WHERE ${where}`,params);
    return {items:items.rows,total:count.rows[0].total,page};
  }
  async likes(session: Session, input: unknown) {
    const page=pageInput.parse(input), params=[session.userId,session.isAdmin];
    const where="l.user_id=$1 AND (p.status='PUBLIC' OR $2)";
    const items=await this.db.query(`SELECT p.id AS "postId",p.title,p.slug,p.summary,p.thumbnail_id AS "thumbnailId",p.status,l.created_at AS "createdAt"
      FROM post_likes l JOIN posts p ON p.id=l.post_id WHERE ${where}
      ORDER BY l.created_at DESC,l.id DESC LIMIT 20 OFFSET $3`,[...params,(page-1)*20]);
    const count=await this.db.query(`SELECT count(*)::int AS total FROM post_likes l JOIN posts p ON p.id=l.post_id WHERE ${where}`,params);
    return {items:items.rows,total:count.rows[0].total,page};
  }
}
