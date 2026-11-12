import { ConflictException, ForbiddenException, HttpException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { Database } from '../database/database.js';
import { config } from '../config.js';
import { enqueueAssistantReply } from '../ai/ai.service.js';
import type { Session } from '../auth/sessions.js';
import { Captchas } from './captcha.service.js';
import { Notifications } from '../notifications/notifications.service.js';
import { audit, type AssistantActor } from '../operations/audit.js';

const contentInput = z.object({ content: z.string().trim().min(1).max(2000) }).strict();
const createInput = contentInput.extend({ requestId: z.uuid(), parentId: z.uuid().nullable().optional(), replyToId: z.uuid().nullable().optional() });
const commentVersion = z.iso.datetime({offset:true});
const assistantCommentInput = contentInput.extend({requestId:z.uuid(),replyToId:z.uuid().optional(),expectedUpdatedAt:commentVersion.optional()});
const assistantCommentFields = `c.id,c.post_id AS "postId",c.parent_id AS "parentId",c.reply_to_id AS "replyToId",c.content,
  c.created_at AS "createdAt",c.updated_at AS "updatedAt",c.ai_identity AS "aiIdentity",c.status='DELETED' AS "isDeleted",
  CASE WHEN c.status='DELETED' THEN '삭제된 댓글' ELSE COALESCE(c.ai_identity->>'name',c.guest_name,u.custom_nickname,u.nickname,'회원') END AS "authorName"`;
const answered = `EXISTS(SELECT 1 FROM comments reply LEFT JOIN users responder ON responder.id=reply.user_id
  WHERE reply.post_id=c.post_id AND reply.status='VISIBLE' AND COALESCE(reply.reply_to_id,reply.parent_id)=c.id
  AND (reply.ai_identity IS NOT NULL OR reply.user_id=p.author_id OR (responder.issuer=$1 AND responder.subject=$2)))`;
const pageInput = z.coerce.number().int().min(1).max(10000).default(1);
const guestNicknameInput = z.string().trim().normalize('NFC').min(2).max(30).regex(/^[\p{L}\p{N} _.-]+$/u);
const passwordInput = z.string().min(8).max(128);
const derive = promisify(scrypt);
const commentFields = `c.id,c.parent_id AS "parentId",c.content,c.created_at AS "createdAt",c.updated_at AS "updatedAt",
  (SELECT a.state FROM ai_tasks a WHERE a.comment_id=c.id) AS "aiReplyState",
  c.reply_to_id AS "replyToId",
  (SELECT CASE WHEN target.status='DELETED' THEN '삭제된 댓글' ELSE COALESCE(target.ai_identity->>'name',target.guest_name,author.custom_nickname,author.nickname,'회원') END
    FROM comments target LEFT JOIN users author ON author.id=target.user_id WHERE target.id=c.reply_to_id AND target.parent_id IS NOT NULL) AS "replyToName",
  CASE WHEN c.status='DELETED' THEN '삭제된 댓글' ELSE COALESCE(c.ai_identity->>'name',c.guest_name,u.custom_nickname,u.nickname,'회원') END AS "authorName",
  c.status='DELETED' AS "isDeleted",c.status='VISIBLE' AND c.user_id IS NULL AND c.ai_identity IS NULL AS "isGuest",c.ai_identity AS "aiIdentity",
  COALESCE(c.user_id=$5,false) AS "isAuthor",c.status='VISIBLE' AND COALESCE(c.user_id=$2,false) AS "canEdit",
  c.status='VISIBLE' AND (COALESCE(c.user_id=$2,false) OR $3) AS "canDelete"`;

async function passwordHash(password: string) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${(await derive(password,salt,32) as Buffer).toString('hex')}`;
}
async function matchesPassword(password: string, encoded: string | null) {
  if (!encoded) return false;
  const [salt,hash] = encoded.split(':');
  return timingSafeEqual(await derive(password,salt,32) as Buffer, Buffer.from(hash,'hex'));
}

@Injectable()
export class Activity {
  constructor(@Inject(Database) private readonly db: Database, @Inject(Captchas) private readonly captchas: Captchas,
    @Inject(Notifications) private readonly notifications: Notifications) {}



  async adminComments(queryPage: unknown, target?: string) {
    const page = pageInput.parse(queryPage);
    const items = await this.db.query(`SELECT c.id,c.content,c.post_id AS "postId",c.created_at AS "createdAt",
      COALESCE(c.ai_identity->>'name',c.guest_name,u.custom_nickname,u.nickname,'회원') AS "authorName",c.user_id IS NULL AND c.ai_identity IS NULL AS "isGuest",c.ai_identity AS "aiIdentity",p.title,p.status,p.slug
      FROM comments c JOIN posts p ON p.id=c.post_id LEFT JOIN users u ON u.id=c.user_id WHERE c.status='VISIBLE' AND ($2::uuid IS NULL OR c.id=$2)
      ORDER BY c.created_at DESC,c.id DESC LIMIT 20 OFFSET $1`, [(page-1)*20,target ?? null]);
    return {items:items.rows,page,total:(await this.db.query("SELECT count(*)::int AS total FROM comments WHERE status='VISIBLE' AND ($1::uuid IS NULL OR id=$1)",[target ?? null])).rows[0].total};
  }

  async commentsForAssistant(postId:string,raw:unknown) {
    const {page,thread} = z.object({page:pageInput,thread:z.uuid().optional()}).parse(raw);
    const {rows} = await this.db.query(`SELECT ${assistantCommentFields} FROM comments c LEFT JOIN users u ON u.id=c.user_id
      WHERE c.post_id=$1 AND ($2::uuid IS NULL OR c.id=$2 OR c.parent_id=$2)
      AND (c.status='VISIBLE' OR ($2::uuid IS NOT NULL AND c.id=$2))
      ORDER BY c.created_at,c.id LIMIT 31 OFFSET $3`,[postId,thread??null,(page-1)*30]);
    return {items:rows.slice(0,30),nextPage:rows.length>30 ? page+1 : null};
  }

  async unansweredForAssistant(raw:unknown) {
    const {after} = z.object({after:z.uuid().optional()}).parse(raw);
    const {rows} = await this.db.query(`SELECT ${assistantCommentFields},p.title,p.slug,
      COALESCE(c.parent_id,c.id) AS "threadId" FROM comments c JOIN posts p ON p.id=c.post_id LEFT JOIN users u ON u.id=c.user_id
      WHERE p.status='PUBLIC' AND p.comments_enabled AND c.status='VISIBLE' AND c.ai_identity IS NULL
      AND c.user_id IS DISTINCT FROM p.author_id AND NOT COALESCE(u.issuer=$1 AND u.subject=$2,false)
      AND (c.assistant_reviewed_at IS NULL OR c.assistant_reviewed_at<c.updated_at) AND NOT ${answered}
      AND NOT EXISTS(SELECT 1 FROM ai_tasks a WHERE a.comment_id=c.id AND a.state IN ('PENDING','QUEUED','RUNNING')
        AND a.created_at>now()-interval '10 minutes') AND ($3::uuid IS NULL OR c.id>$3)
      ORDER BY c.id LIMIT 21`,[config.ADMIN_OIDC_ISSUER,config.ADMIN_OIDC_SUBJECT,after??null]);
    return {items:rows.slice(0,20),nextCursor:rows.length>20 ? rows[19].id : null};
  }

  async createForAssistant(postId:string,raw:unknown,actor:AssistantActor) {
    const {requestId,content,replyToId,expectedUpdatedAt} = assistantCommentInput.parse(raw);
    const digest = createHash('sha256').update(JSON.stringify(['mcp',postId,content,replyToId??null])).digest('hex');
    return this.db.transaction(async tx => {
      await this.serialize(tx,`assistant:${actor.issuerId}`);
      const {rows:[existing]} = await tx.query('SELECT request_hash FROM comments WHERE id=$1',[requestId]);
      if (existing) {
        if (existing.request_hash!==digest) throw new ConflictException('이미 사용한 댓글 등록 요청 ID입니다.');
        return {id:requestId,reused:true};
      }
      await this.publicPost(tx,postId,false,true);
      let parentId: string | null = null;
      if (replyToId) {
        const {rows:[ref]} = await tx.query('SELECT parent_id FROM comments WHERE id=$1 AND post_id=$2',[replyToId,postId]);
        if (!ref) throw new NotFoundException('답글 대상을 찾을 수 없습니다.');
        parentId = ref.parent_id ?? replyToId;
        // Use the same parent-before-target lock order as normal replies.
        if (parentId!==replyToId) await this.checkParent(tx,postId,parentId,replyToId);
        const {rows:[target]} = await tx.query(`SELECT updated_at FROM comments WHERE id=$1 AND post_id=$2 AND status='VISIBLE' FOR NO KEY UPDATE`,[replyToId,postId]);
        if (!target) throw new NotFoundException('답글 대상을 찾을 수 없습니다.');
        if (expectedUpdatedAt && target.updated_at.getTime()!==Date.parse(expectedUpdatedAt)) throw new ConflictException('댓글 내용이 바뀌었습니다. 다시 확인해 주세요.');
        const {rows:[state]} = await tx.query(`SELECT ${answered} AS answered FROM comments c JOIN posts p ON p.id=c.post_id WHERE c.id=$3`,
          [config.ADMIN_OIDC_ISSUER,config.ADMIN_OIDC_SUBJECT,replyToId]);
        if (state.answered) throw new ConflictException('운영자 또는 AI 도우미가 이미 답변했습니다.');
      }
      await this.limit(tx,actor.issuerId,'assistant_comment');
      await tx.query(`INSERT INTO comments(id,post_id,parent_id,reply_to_id,content,request_hash,ai_identity)
        VALUES($1,$2,$3,$4,$5,$6,$7)`,[requestId,postId,parentId,replyToId??null,content,digest,actor.identity]);
      await this.notifications.enqueue(tx,requestId);
      await audit(tx,actor,'comment.create',requestId);
      return {id:requestId,reused:false};
    });
  }

  async skipForAssistant(postId:string,id:string,raw:unknown,actor:AssistantActor) {
    const {expectedUpdatedAt} = z.strictObject({expectedUpdatedAt:commentVersion}).parse(raw);
    return this.db.transaction(async tx => {
      await this.publicPost(tx,postId,false,true);
      const result = await tx.query(`UPDATE comments SET assistant_reviewed_at=now() WHERE id=$1 AND post_id=$2 AND status='VISIBLE'
        AND ai_identity IS NULL AND date_trunc('milliseconds',updated_at)=$3::timestamptz`,[id,postId,expectedUpdatedAt]);
      if (!result.rowCount) throw new ConflictException('댓글이 변경되었거나 더 이상 확인할 수 없습니다.');
      await audit(tx,actor,'comment.review.skip',id);
      return {reviewed:true};
    });
  }

  async removeForAssistant(postId:string,id:string,actor:AssistantActor) {
    return this.db.transaction(async tx => {
      await this.publicPost(tx,postId,true);
      const {rows:[comment]} = await tx.query('SELECT status FROM comments WHERE id=$1 AND post_id=$2 FOR UPDATE',[id,postId]);
      if (!comment) throw new NotFoundException('댓글을 찾을 수 없습니다.');
      if (comment.status==='VISIBLE') {
        await this.eraseComment(tx,id);
        await audit(tx,actor,'comment.delete',id);
      }
      return {deleted:true};
    });
  }

  async location(slug: string, commentId: string) {
    const result=await this.db.query(`SELECT c.id,c.parent_id AS "parentId",
      (SELECT (count(*)/20+1)::int FROM comments r WHERE r.post_id=c.post_id AND r.parent_id IS NULL
        AND (r.status='VISIBLE' OR EXISTS(SELECT 1 FROM comments child WHERE child.parent_id=r.id AND child.status='VISIBLE'))
        AND (r.created_at,r.id)<(root.created_at,root.id)) AS page,
      (SELECT (count(*)/20+1)::int FROM comments r WHERE r.parent_id=c.parent_id AND r.status='VISIBLE'
        AND (r.created_at,r.id)<(c.created_at,c.id)) AS "replyPage"
      FROM comments c JOIN posts p ON p.id=c.post_id JOIN comments root ON root.id=COALESCE(c.parent_id,c.id)
      WHERE c.id=$1 AND p.slug=$2 AND p.status='PUBLIC' AND c.status='VISIBLE'`,[commentId,slug]);
    if (!result.rows[0]) throw new NotFoundException('삭제되었거나 볼 수 없는 댓글입니다.');
    return result.rows[0];
  }

  async read(slug: string, session: Session | null, queryPage: unknown) {
    const page = pageInput.parse(queryPage);
    return this.db.transaction(async tx => {
      const post = await tx.query("SELECT id,author_id,comments_enabled FROM posts WHERE slug=$1 AND status='PUBLIC' FOR SHARE", [slug]);
      if (!post.rows[0]) throw new NotFoundException('글을 찾을 수 없습니다.');
      const id = post.rows[0].id;
      const comments = await tx.query(`SELECT ${commentFields},
        (SELECT count(*)::int FROM comments r WHERE r.parent_id=c.id AND r.status='VISIBLE') AS "replyCount"
        FROM comments c LEFT JOIN users u ON u.id=c.user_id WHERE c.post_id=$1 AND c.parent_id IS NULL
        AND (c.status='VISIBLE' OR EXISTS(SELECT 1 FROM comments r WHERE r.parent_id=c.id AND r.status='VISIBLE'))
        ORDER BY c.created_at,c.id LIMIT 20 OFFSET $4`,
      [id, session?.userId ?? null, session?.isAdmin ?? false, (page - 1) * 20,post.rows[0].author_id]);
      const counts = await tx.query(`SELECT (SELECT count(*)::int FROM comments WHERE post_id=$1 AND status='VISIBLE') AS "commentCount",
        (SELECT count(*)::int FROM comments c WHERE c.post_id=$1 AND c.parent_id IS NULL
          AND (c.status='VISIBLE' OR EXISTS(SELECT 1 FROM comments r WHERE r.parent_id=c.id AND r.status='VISIBLE'))) AS "threadCount",
        (SELECT count(*)::int FROM post_likes WHERE post_id=$1) AS "likeCount",
        EXISTS(SELECT 1 FROM post_likes WHERE post_id=$1 AND user_id=$2) AS liked`, [id, session?.userId ?? null]);
      const aiPending=(await tx.query(`SELECT EXISTS(SELECT 1 FROM ai_tasks WHERE post_id=$1
        AND kind='comment' AND state IN ('PENDING','QUEUED','RUNNING') AND created_at>now()-interval '5 minutes') AS pending`,[id])).rows[0].pending;
      const aiAssistant=(await tx.query(`SELECT data->>'name' AS name,data->>'mentionKeyword' AS keyword
        FROM ai_settings WHERE singleton=true AND data->>'mentionsEnabled'='true'`)).rows[0]??null;
      return { ...counts.rows[0], comments: comments.rows, commentsEnabled: post.rows[0].comments_enabled, aiPending, aiAssistant, page };
    });
  }

  async replies(slug: string, parentId: string, session: Session | null, queryPage: unknown) {
    const page = pageInput.parse(queryPage);
    return this.db.transaction(async tx => {
      const post = await tx.query("SELECT id,author_id FROM posts WHERE slug=$1 AND status='PUBLIC' FOR SHARE", [slug]);
      if (!post.rows[0]) throw new NotFoundException('글을 찾을 수 없습니다.');
      const parent = await tx.query('SELECT id FROM comments WHERE id=$1 AND post_id=$2 AND parent_id IS NULL', [parentId,post.rows[0].id]);
      if (!parent.rowCount) throw new NotFoundException('댓글을 찾을 수 없습니다.');
      const items = await tx.query(`SELECT ${commentFields} FROM comments c LEFT JOIN users u ON u.id=c.user_id
        WHERE c.parent_id=$1 AND c.status='VISIBLE' ORDER BY c.created_at,c.id LIMIT 20 OFFSET $4`,
      [parentId,session?.userId ?? null,session?.isAdmin ?? false,(page-1)*20,post.rows[0].author_id]);
      const count = await tx.query("SELECT count(*)::int AS total FROM comments WHERE parent_id=$1 AND status='VISIBLE'", [parentId]);
      return { items:items.rows,total:count.rows[0].total,page };
    });
  }

  private async checkParent(tx: PoolClient, post: string, parentId?: string | null, replyToId?: string | null) {
    if (!parentId) {
      if (replyToId) throw new ConflictException('답글의 원댓글이 필요합니다.');
      return;
    }
    const parent = await tx.query('SELECT id,status FROM comments WHERE id=$1 AND post_id=$2 AND parent_id IS NULL FOR SHARE', [parentId,post]);
    if (!parent.rowCount) throw new NotFoundException('답글을 달 원댓글을 찾을 수 없습니다.');
    if (parent.rows[0].status === 'DELETED' && (!replyToId || replyToId === parentId)) throw new NotFoundException('삭제된 댓글에는 답글을 달 수 없습니다.');
    if (replyToId && replyToId !== parentId) {
      const target = await tx.query("SELECT id FROM comments WHERE id=$1 AND post_id=$2 AND parent_id=$3 AND status='VISIBLE' FOR SHARE", [replyToId,post,parentId]);
      if (!target.rowCount) throw new NotFoundException('답글 대상을 찾을 수 없습니다.');
    }
  }

  private async eraseComment(tx: PoolClient, id: string) {
    // Keep the thread anchor while removing the author's content and credentials.
    await tx.query(`UPDATE comments SET status='DELETED',content='삭제된 댓글입니다.',user_id=NULL,
      guest_name=NULL,guest_password=NULL,request_hash='',ai_identity=NULL,updated_at=now() WHERE id=$1`, [id]);
    await this.notifications.removeForComment(tx,id);
  }

  private async publicPost(tx: PoolClient, id: string, admin = false, creatingComment = false) {
    const post = await tx.query("SELECT id,comments_enabled FROM posts WHERE id=$1 AND (status='PUBLIC' OR $2) FOR SHARE", [id, admin]);
    if (!post.rows[0]) throw new NotFoundException('글을 찾을 수 없습니다.');
    if (creatingComment && !post.rows[0].comments_enabled) throw new ForbiddenException('이 글은 새 댓글과 답글을 받지 않습니다.');
  }

  private async limit(tx: PoolClient, user: string, action: 'comment' | 'assistant_comment' | 'like') {
    await tx.query('INSERT INTO activity_limits(user_id,action) VALUES($1,$2) ON CONFLICT DO NOTHING', [user, action]);
    const result = await tx.query('SELECT events,clock_timestamp() AS now FROM activity_limits WHERE user_id=$1 AND action=$2 FOR UPDATE', [user, action]);
    const isComment = action!=='like';
    const now = result.rows[0].now.getTime(), window = isComment ? 3600000 : 60000;
    const events = (result.rows[0].events as Date[]).map(value => value.getTime()).filter(value => value > now - window).sort((a,b) => a-b);
    const minute = events.filter(value => value > now - 60000);
    const waits: number[] = [];
    if (minute.length >= (isComment ? 5 : 60)) waits.push(minute[0] + 60000 - now);
    if (isComment && events.length >= 60) waits.push(events[0] + 3600000 - now);
    if (waits.length) {
      const retryAfterSeconds = Math.max(1, Math.ceil(Math.max(...waits) / 1000));
      throw new HttpException({ message: `${retryAfterSeconds}초 뒤 다시 시도해 주세요.`, retryAfterSeconds }, 429);
    }
    await tx.query('UPDATE activity_limits SET events=$3 WHERE user_id=$1 AND action=$2', [user, action, [...events, now].map(value => new Date(value))]);
  }

  private async serialize(tx: PoolClient, user: string) {
    // Serialize this user's writes across API processes without locking account updates.
    await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,74004))', [user]);
  }

  async create(post: string, session: Session, input: unknown) {
    if (!session.nickname) throw new ConflictException('닉네임을 불러오려면 다시 로그인해 주세요.');
    const { requestId, content, parentId, replyToId } = createInput.parse(input), user = session.userId!;
    const hash = createHash('sha256').update(JSON.stringify(parentId ? [post, content, parentId, replyToId ?? null] : [post, content])).digest('hex');
    return this.db.transaction(async tx => {
      await this.serialize(tx, user); await this.publicPost(tx, post, false, true);
      const existing = await tx.query('SELECT user_id,request_hash FROM comments WHERE id=$1', [requestId]);
      if (existing.rows[0]) {
        if (existing.rows[0].user_id !== user || existing.rows[0].request_hash !== hash) throw new ConflictException('같은 요청의 내용이 달라졌습니다. 새로 확인해 주세요.');
        return { id: requestId };
      }
      await this.checkParent(tx,post,parentId,replyToId);
      await this.limit(tx, user, 'comment');
      await tx.query('INSERT INTO comments(id,post_id,user_id,content,request_hash,parent_id,reply_to_id) VALUES($1,$2,$3,$4,$5,$6,$7)', [requestId, post, user, content, hash,parentId ?? null,replyToId ?? null]);
      await this.notifications.enqueue(tx,requestId);
      await enqueueAssistantReply(tx,post,requestId,content);
      return { id: requestId };
    });
  }

  async edit(post: string, id: string, session: Session, input: unknown) {
    const { content } = contentInput.parse(input);
    return this.db.transaction(async tx => {
      await this.publicPost(tx, post);
      const comment = await tx.query("SELECT user_id FROM comments WHERE id=$1 AND post_id=$2 AND status='VISIBLE' FOR UPDATE", [id, post]);
      if (!comment.rows[0]) throw new NotFoundException('댓글을 찾을 수 없습니다.');
      if (comment.rows[0].user_id !== session.userId) throw new ForbiddenException('본인 댓글만 수정할 수 있습니다.');
      await tx.query('UPDATE comments SET content=$2,updated_at=now() WHERE id=$1', [id, content]);
      return { id };
    });
  }

  async remove(post: string, id: string, session: Session) {
    return this.db.transaction(async tx => {
      await this.publicPost(tx, post, session.isAdmin);
      const comment = await tx.query("SELECT user_id FROM comments WHERE id=$1 AND post_id=$2 AND status='VISIBLE' FOR UPDATE", [id, post]);
      if (!comment.rows[0]) throw new NotFoundException('댓글을 찾을 수 없습니다.');
      if (comment.rows[0].user_id !== session.userId && !session.isAdmin) throw new ForbiddenException('본인 댓글만 삭제할 수 있습니다.');
      await this.eraseComment(tx,id);
      if (session.isAdmin && comment.rows[0].user_id !== session.userId) {
        await tx.query("INSERT INTO audit_events(actor_id,action,target_id) VALUES($1,'comment.delete',$2)", [session.userId, id]);
      }
      return { deleted: true };
    });
  }

  async like(post: string, session: Session, liked: boolean) {
    return this.db.transaction(async tx => {
      await this.serialize(tx, session.userId!); await this.publicPost(tx, post);
      const existing = await tx.query('SELECT 1 FROM post_likes WHERE post_id=$1 AND user_id=$2', [post, session.userId]);
      if (Boolean(existing.rowCount) !== liked) {
        await this.limit(tx, session.userId!, 'like');
        if (liked) await tx.query('INSERT INTO post_likes(post_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [post, session.userId]);
        else await tx.query('DELETE FROM post_likes WHERE post_id=$1 AND user_id=$2', [post, session.userId]);
      }
      return { liked, count: (await tx.query('SELECT count(*)::int AS count FROM post_likes WHERE post_id=$1', [post])).rows[0].count };
    });
  }

  async guestCreate(post: string, client: string, input: unknown) {
    const data = z.object({ requestId:z.uuid(), nickname:guestNicknameInput, password:passwordInput, content:contentInput.shape.content,
      parentId:z.uuid().nullable().optional(), replyToId:z.uuid().nullable().optional() }).parse(input);
    if (['관리자','운영자'].includes(data.nickname)) throw new ForbiddenException('이 닉네임은 사용할 수 없습니다.');
    const hash = createHash('sha256').update(JSON.stringify(data.parentId ? [post,data.nickname,data.content,data.parentId,data.replyToId ?? null] : [post,data.nickname,data.content])).digest('hex');
    const encoded = await passwordHash(data.password);
    return this.db.transaction(async tx => {
      await this.publicPost(tx,post,false,true);
      const existing = (await tx.query('SELECT user_id,request_hash,guest_password FROM comments WHERE id=$1',[data.requestId])).rows[0];
      if (existing) {
        if (existing.user_id || existing.request_hash !== hash || !await matchesPassword(data.password,existing.guest_password)) throw new ConflictException('같은 요청의 내용이 달라졌습니다.');
        return {id:data.requestId};
      }
      await this.checkParent(tx,post,data.parentId,data.replyToId);
      await this.captchas.limit(tx,client,'comment');
      await tx.query('INSERT INTO comments(id,post_id,guest_name,guest_password,content,request_hash,parent_id,reply_to_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[data.requestId,post,data.nickname,encoded,data.content,hash,data.parentId ?? null,data.replyToId ?? null]);
      await this.notifications.enqueue(tx,data.requestId);
      await enqueueAssistantReply(tx,post,data.requestId,data.content);
      return {id:data.requestId};
    });
  }

  async guestChange(post: string, id: string, input: unknown, remove: boolean) {
    const data = z.object({ password:passwordInput, content:remove ? z.string().optional() : contentInput.shape.content }).parse(input);
    return this.db.transaction(async tx => {
      await this.publicPost(tx,post);
      const comment = (await tx.query("SELECT guest_password FROM comments WHERE id=$1 AND post_id=$2 AND user_id IS NULL AND ai_identity IS NULL AND status='VISIBLE' FOR UPDATE",[id,post])).rows[0];
      if (!comment) throw new NotFoundException('댓글을 찾을 수 없습니다.');
      if (!await matchesPassword(data.password,comment.guest_password)) throw new ForbiddenException('댓글 비밀번호가 맞지 않습니다.');
      if (remove) await this.eraseComment(tx,id);
      else await tx.query('UPDATE comments SET content=$2,updated_at=now() WHERE id=$1',[id,data.content]);
      return remove ? {deleted:true} : {id};
    });
  }
}
