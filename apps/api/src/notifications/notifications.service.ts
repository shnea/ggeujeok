import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { Database } from '../database/database.js';
import type { Session } from '../auth/sessions.js';

const pageInput = z.coerce.number().int().min(1).max(10000).default(1);
const visible = `n.recipient_id=$1 AND n.created_at > now()-interval '90 days'
  AND c.status='VISIBLE' AND (p.status='PUBLIC' OR $2)`;
const joined = 'FROM notifications n JOIN comments c ON c.id=n.comment_id JOIN posts p ON p.id=c.post_id';

@Injectable()
export class Notifications {
  constructor(@Inject(Database) private readonly db: Database) {}

  async enqueue(tx: PoolClient, commentId: string) {
    await tx.query(`INSERT INTO notification_events(comment_id,recipient_id,kind)
      SELECT c.id,recipient.id,CASE WHEN recipient.id=target.user_id THEN 'REPLY' ELSE 'COMMENT' END
      FROM comments c JOIN posts p ON p.id=c.post_id
      LEFT JOIN comments target ON target.id=COALESCE(c.reply_to_id,c.parent_id)
      CROSS JOIN LATERAL (SELECT p.author_id AS id UNION SELECT target.user_id) recipient
      WHERE c.id=$1 AND recipient.id IS NOT NULL AND recipient.id IS DISTINCT FROM c.user_id
      ON CONFLICT DO NOTHING`, [commentId]);
  }

  async removeForComment(tx: PoolClient, commentId: string) {
    // Removing the queued event first serializes deletion with a worker already delivering it.
    await tx.query('DELETE FROM notification_events WHERE comment_id=$1', [commentId]);
    await tx.query('DELETE FROM notifications WHERE comment_id=$1', [commentId]);
  }

  async processOne() {
    return this.db.transaction(async tx => {
      // Match comment/post deletion's lock order: comment first, queued delivery second.
      const pending = await tx.query(`SELECT e.comment_id,e.recipient_id,e.kind,e.attempts FROM notification_events e
        JOIN comments c ON c.id=e.comment_id
        WHERE e.processed_at IS NULL AND e.attempts<5 AND e.next_attempt_at<=now()
        ORDER BY e.next_attempt_at,e.comment_id,e.recipient_id LIMIT 1 FOR UPDATE OF c SKIP LOCKED`);
      const event = pending.rows[0];
      if (!event) return false;
      const claimed=await tx.query(`SELECT attempts FROM notification_events WHERE comment_id=$1 AND recipient_id=$2
        AND processed_at IS NULL AND attempts<5 AND next_attempt_at<=now() FOR UPDATE`,[event.comment_id,event.recipient_id]);
      if(!claimed.rowCount)return true;
      event.attempts=claimed.rows[0].attempts;
      await tx.query('SAVEPOINT delivery');
      try {
        await tx.query(`INSERT INTO notifications(comment_id,recipient_id,kind)
          SELECT id,$2,$3 FROM comments WHERE id=$1 AND status='VISIBLE'
          ON CONFLICT(comment_id,recipient_id) DO NOTHING`, [event.comment_id,event.recipient_id,event.kind]);
        await tx.query('UPDATE notification_events SET processed_at=clock_timestamp(),error_code=NULL WHERE comment_id=$1 AND recipient_id=$2', [event.comment_id,event.recipient_id]);
        await tx.query('RELEASE SAVEPOINT delivery');
      } catch (error) {
        await tx.query('ROLLBACK TO SAVEPOINT delivery');
        const code = /^[A-Z0-9_]{1,40}$/.test(String((error as {code?:string}).code)) ? (error as {code:string}).code : 'DELIVERY_FAILED';
        await tx.query(`UPDATE notification_events SET attempts=attempts+1,error_code=$3,
          next_attempt_at=clock_timestamp()+($4 * interval '1 second') WHERE comment_id=$1 AND recipient_id=$2`,
        [event.comment_id,event.recipient_id,code,Math.min(300,2 ** (event.attempts+1))]);
        console.error(JSON.stringify({level:'ERROR',event:'notification.delivery',commentId:event.comment_id,attempt:event.attempts+1,code}));
      }
      return true;
    });
  }

  async prune() {
    await this.db.transaction(async tx => {
      await tx.query("DELETE FROM notification_events WHERE processed_at IS NOT NULL AND created_at<=now()-interval '90 days'");
      await tx.query("DELETE FROM notifications WHERE created_at<=now()-interval '90 days'");
    });
  }

  async list(session: Session, input: unknown) {
    const page = pageInput.parse(input), params=[session.userId,session.isAdmin];
    const items = await this.db.query(`SELECT n.id,n.kind,n.created_at AS "createdAt",n.read_at AS "readAt",
      c.id AS "commentId",c.post_id AS "postId",left(c.content,180) AS content,
      COALESCE(c.ai_identity->>'name',c.guest_name,u.custom_nickname,u.nickname,'회원') AS "actorName",p.title,p.slug,p.status
      ${joined} LEFT JOIN users u ON u.id=c.user_id WHERE ${visible}
      ORDER BY n.created_at DESC,n.id DESC LIMIT 20 OFFSET $3`, [...params,(page-1)*20]);
    const count = await this.db.query(`SELECT count(*)::int AS total,count(*) FILTER(WHERE n.read_at IS NULL)::int AS unread ${joined} WHERE ${visible}`,params);
    return {items:items.rows,...count.rows[0],page};
  }

  async unread(session: Session) {
    return (await this.db.query(`SELECT count(*)::int AS count ${joined} WHERE ${visible} AND n.read_at IS NULL`, [session.userId,session.isAdmin])).rows[0];
  }

  async read(session: Session, id: string) {
    const result = await this.db.query(`UPDATE notifications SET read_at=COALESCE(read_at,clock_timestamp())
      WHERE id IN (SELECT n.id ${joined} WHERE ${visible} AND n.id=$3) RETURNING id`,[session.userId,session.isAdmin,id]);
    if (!result.rowCount) throw new NotFoundException('알림을 찾을 수 없습니다.');
    return {read:true};
  }

  async readAll(session: Session) {
    // One statement uses one snapshot: deliveries arriving after this request stay unread.
    const result = await this.db.query(`UPDATE notifications SET read_at=clock_timestamp()
      WHERE id IN (SELECT n.id ${joined} WHERE ${visible} AND n.read_at IS NULL)`,[session.userId,session.isAdmin]);
    return {updated:result.rowCount};
  }

  async destination(session: Session, id: string) {
    const result = await this.db.query(`SELECT c.id,p.id AS "postId",p.slug,p.status ${joined} WHERE ${visible} AND n.id=$3`,[session.userId,session.isAdmin,id]);
    const item=result.rows[0];
    if (!item) throw new NotFoundException('삭제되었거나 볼 수 없는 알림입니다.');
    return {href:item.status==='PUBLIC'?`/posts/${item.slug}#comment-${item.id}`:`/admin/comments?comment=${item.id}`};
  }
}
