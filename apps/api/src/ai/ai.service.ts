import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { Database } from '../database/database.js';
import { config } from '../config.js';
import { initialPost, normalizeTag, plainText } from '../posts/post-input.js';
import { createDraft } from '../posts/create-draft.js';
import { syncTags } from '../posts/tags.js';
import { Notifications } from '../notifications/notifications.service.js';
import { assistantInput, emptyAssistant, identity, parseResult, systemPrompt, isMention, type Assistant, type TaskKind } from './assistant.js';

export type AiTask = { id: string; kind: TaskKind; post_id: string | null; post_version: number | null;
  comment_id: string | null; actor_id: string | null; topic: string | null; profile: Assistant;
  priority: boolean; settings_revision: number; state: string; job_id: string | null; ai_job_id: string | null;
  ai_request_id: string; dispatch_id: string; execution_started_at: Date | null;
  input_snapshot: any; manual_request: boolean; input_hash: string | null; result: any };
export const inputHash = (value: unknown) => {
  const { recentResponses: _style, ...context } = value as Record<string, unknown>;
  const stable = (item: any): any => item instanceof Date ? item.toJSON() : Array.isArray(item) ? item.map(stable) : item && typeof item === 'object' ? Object.fromEntries(Object.keys(item).sort().map(key => [key, stable(item[key])])) : item;
  return createHash('sha256').update(JSON.stringify(stable(context))).digest('hex');
};
const ready = () => Boolean(config.PLATFORM_API_KEY && config.PLATFORM_PROJECT_ID && config.PLATFORM_ENVIRONMENT_ID);

export async function enqueueAssistantReply(tx:PoolClient,postId:string,commentId:string,content:string) {
  if (!ready()) return;
  const settings=(await tx.query('SELECT data,revision FROM ai_settings WHERE singleton=true')).rows[0];
  if (!settings?.data.mentionsEnabled || !settings.data.name) return;
  await tx.query(`INSERT INTO ai_tasks(kind,post_id,post_version,comment_id,profile,settings_revision,priority)
    SELECT 'comment',p.id,p.version,$2,$3,$4,true FROM posts p JOIN comments c ON c.post_id=p.id AND c.id=$2
    LEFT JOIN comments target ON target.id=COALESCE(c.reply_to_id,c.parent_id) AND target.post_id=c.post_id AND target.status='VISIBLE'
    WHERE p.id=$1 AND p.status='PUBLIC' AND p.comments_enabled AND c.status='VISIBLE' AND c.ai_identity IS NULL
      AND (target.ai_identity IS NOT NULL OR $5)
    ON CONFLICT DO NOTHING`,[postId,commentId,settings.data,settings.revision,isMention(content,settings.data.mentionKeyword)]);
}

@Injectable()
export class Ai {
  constructor(@Inject(Database) readonly db: Database) {}

  async settings() {
    const row = (await this.db.query('SELECT data,revision FROM ai_settings WHERE singleton=true')).rows[0];
    return { data: row?.data ?? emptyAssistant, revision: row?.revision ?? 0, connected: ready() };
  }

  async saveSettings(raw: unknown, actor: string) {
    const { data, revision } = z.object({ data: assistantInput, revision: z.number().int().nonnegative() }).strict().parse(raw);
    await this.db.transaction(async tx => {
      await tx.query('SELECT pg_advisory_xact_lock(73701920)');
      const row = (await tx.query('SELECT revision FROM ai_settings WHERE singleton=true FOR UPDATE')).rows[0];
      if ((row?.revision ?? 0) !== revision) throw new ConflictException('다른 화면에서 설정이 바뀌었습니다. 다시 불러와 주세요.');
      if (!ready() && (data.summaryEnabled || data.tagsEnabled || data.commentsEnabled || data.mentionsEnabled))
        throw new BadRequestException('플랫폼 AI 연결을 먼저 준비해 주세요. 도우미 정보는 기능을 끈 상태로 저장할 수 있습니다.');
      await tx.query(`INSERT INTO ai_settings(singleton,data) VALUES(true,$1)
        ON CONFLICT(singleton) DO UPDATE SET data=$1,revision=ai_settings.revision+1,next_comment_at=now()`, [data]);
      await tx.query("INSERT INTO audit_events(actor_id,action) VALUES($1,'ai.settings.update')", [actor]);
    });
    return this.settings();
  }

  async list() {
    return (await this.db.query(`SELECT a.id,a.kind,a.state,a.error_code AS "errorCode",a.created_at AS "createdAt",
      a.completed_at AS "completedAt",a.post_id AS "postId",COALESCE(a.topic,p.title) AS title
      FROM ai_tasks a LEFT JOIN posts p ON p.id=a.post_id ORDER BY a.created_at DESC LIMIT 30`)).rows;
  }

  async status(id:string) {
    const row=(await this.db.query('SELECT id,state,error_code AS "errorCode" FROM ai_tasks WHERE id=$1',[id])).rows[0];
    if(!row)throw new NotFoundException('작업을 찾을 수 없습니다.');
    return row;
  }

  async requestSummary(postId:string,actor:string) { return this.requestPostText('summary',postId,actor); }
  async requestTags(postId:string,actor:string) { return this.requestPostText('tags',postId,actor); }

  private async requestPostText(kind:'summary'|'tags',postId:string,actor:string) {
    return this.db.transaction(async tx=>{
      const post=(await tx.query(`SELECT p.id,d.data,d.version,d.ai_summary,d.ai_summary_version FROM posts p JOIN post_drafts d ON d.post_id=p.id
        WHERE p.id=$1 FOR UPDATE OF p,d`,[postId])).rows[0];
      if(!post)throw new NotFoundException('글을 찾을 수 없습니다.');
      const settings=(await tx.query('SELECT data,revision FROM ai_settings WHERE singleton=true FOR SHARE')).rows[0];
      if(!ready()||!(kind==='summary'?settings?.data.summaryEnabled:settings?.data.tagsEnabled))
        throw new BadRequestException(`설정에서 AI ${kind==='summary'?'요약':'태그'}를 먼저 켜 주세요.`);
      const text=plainText(post.data.content);
      if(!text.trim())throw new BadRequestException('본문을 먼저 작성해 주세요.');
      if(kind==='summary' && post.data.summary)throw new ConflictException('직접 작성한 요약이 있어 보존합니다.');
      const snapshot={title:post.data.title,text:text.slice(0,48000),truncated:text.length>48000};
      const active=(await tx.query(`SELECT id,state FROM ai_tasks WHERE post_id=$1 AND kind=$2 AND manual_request
        AND (state IN ('PENDING','QUEUED','RUNNING') OR
          (state='FAILED' AND execution_started_at IS NOT NULL AND execution_error IS NULL))
        ORDER BY created_at DESC LIMIT 1`,[postId,kind])).rows[0];
      if(active)return active;
      const task=(await tx.query(`INSERT INTO ai_tasks(kind,post_id,post_version,profile,settings_revision,manual_request,input_snapshot,input_hash)
        VALUES($1,$2,$3,$4,$5,true,$6,$7) RETURNING id,state`,
        [kind,postId,post.version,settings.data,settings.revision,snapshot,inputHash(snapshot)])).rows[0];
      await tx.query('INSERT INTO audit_events(actor_id,action,target_id) VALUES($1,$2,$3)',[actor,`ai.${kind}.request`,postId]);
      return task;
    });
  }

  async requestArticle(raw: unknown, actor: string) {
    const { topic, requestId } = z.object({ topic: z.string().trim().min(2).max(200), requestId: z.uuid() }).strict().parse(raw);
    const settings = await this.settings();
    if (!settings.connected || !settings.data.name) throw new BadRequestException('도우미 등록과 플랫폼 AI 연결을 먼저 완료해 주세요.');
    await this.db.transaction(async tx => {
      await tx.query('SELECT pg_advisory_xact_lock(73701921)');
      const previous = (await tx.query('SELECT topic,kind FROM ai_tasks WHERE id=$1', [requestId])).rows[0];
      if (previous) { if (previous.kind !== 'article' || previous.topic !== topic) throw new ConflictException(); return; }
      const pending = (await tx.query("SELECT 1 FROM ai_tasks WHERE kind='article' AND state IN ('PENDING','QUEUED','RUNNING') LIMIT 1")).rowCount;
      if (pending) throw new ConflictException('작성 중인 초안이 있습니다. 완료 후 다시 요청해 주세요.');
      await tx.query(`INSERT INTO ai_tasks(id,kind,topic,actor_id,profile,settings_revision) VALUES($1,'article',$2,$3,$4,$5)`,
        [requestId,topic,actor,settings.data,settings.revision]);
      await tx.query("INSERT INTO audit_events(actor_id,action,target_id) VALUES($1,'ai.article.request',$2)", [actor,requestId]);
    });
    return { id: requestId };
  }

  async retry(id: string) {
    // Unknown executions retain the AI request ID and only reconcile status. A confirmed failure gets a new ID.
    const result = await this.db.query(`UPDATE ai_tasks SET state='PENDING',job_id=NULL,dispatch_id=gen_random_uuid(),error_code=NULL,
      ai_request_id=CASE WHEN execution_error IS NOT NULL THEN gen_random_uuid() ELSE ai_request_id END,
      ai_job_id=CASE WHEN execution_error IS NOT NULL THEN NULL ELSE ai_job_id END,
      execution_started_at=CASE WHEN execution_error IS NOT NULL THEN NULL ELSE execution_started_at END,execution_error=NULL
      WHERE id=$1 AND state='FAILED' AND created_at>now()-interval '30 days' RETURNING id`, [id]);
    if (!result.rowCount) throw new ConflictException('재시도할 수 없는 작업입니다.');
    return { id };
  }

  async schedule() {
    if (!ready()) return;
    await this.db.transaction(async tx => {
      const settings = (await tx.query("SELECT * FROM ai_settings WHERE singleton=true AND next_comment_at<=now() FOR UPDATE SKIP LOCKED")).rows[0];
      if (!settings?.data.commentsEnabled || !settings.data.name) return;
      await tx.query("UPDATE ai_settings SET next_comment_at=now()+($1*interval '1 minute') WHERE singleton=true", [settings.data.commentIntervalMinutes]);
      const candidates = await tx.query(`SELECT c.id,c.post_id,p.version FROM comments c JOIN posts p ON p.id=c.post_id
        LEFT JOIN users u ON u.id=c.user_id
        WHERE c.status='VISIBLE' AND c.ai_identity IS NULL AND p.status='PUBLIC' AND p.comments_enabled
        AND c.created_at>now()-interval '7 days' AND c.user_id IS DISTINCT FROM p.author_id
        AND NOT (COALESCE(u.issuer=$1 AND u.subject=$2,false))
        AND NOT EXISTS(SELECT 1 FROM ai_tasks a WHERE a.comment_id=c.id)
        AND NOT EXISTS(SELECT 1 FROM comments r LEFT JOIN users ru ON ru.id=r.user_id
          WHERE COALESCE(r.reply_to_id,r.parent_id)=c.id AND r.status='VISIBLE'
          AND (r.ai_identity IS NOT NULL OR r.user_id=p.author_id OR (ru.issuer=$1 AND ru.subject=$2)))
        ORDER BY c.created_at,c.id LIMIT 3`, [config.ADMIN_OIDC_ISSUER,config.ADMIN_OIDC_SUBJECT]);
      for (const c of candidates.rows) await tx.query(`INSERT INTO ai_tasks(kind,post_id,post_version,comment_id,profile,settings_revision)
        VALUES('comment',$1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, [c.post_id,c.version,c.id,settings.data,settings.revision]);
    });
  }

  async task(id: string, query: Database | PoolClient = this.db): Promise<AiTask> {
    const row = (await query.query('SELECT * FROM ai_tasks WHERE id=$1', [id])).rows[0];
    if (!row) throw new NotFoundException();
    return row;
  }

  async context(task: AiTask, query: Database | PoolClient = this.db) {
    if(task.kind==='article')return {topic:task.topic};
    if(task.manual_request){
      const draft=(await query.query('SELECT data FROM post_drafts WHERE post_id=$1',[task.post_id])).rows[0];
      if(!draft)return null;
      if(task.input_snapshot)return task.input_snapshot;
      const text=plainText(draft.data.content);
      return {title:draft.data.title,text:text.slice(0,48000),truncated:text.length>48000};
    }
    const settings = (await query.query('SELECT data,revision FROM ai_settings WHERE singleton=true')).rows[0];
    if (!settings || settings.revision !== task.settings_revision) return null;
    const p = (await query.query(`SELECT p.*,d.data AS draft,d.version AS draft_version FROM posts p JOIN post_drafts d ON d.post_id=p.id WHERE p.id=$1`, [task.post_id])).rows[0];
    if (!p) return null;
    if (task.kind !== 'comment') {
      if (p.draft_version !== task.post_version) return null;
      if (task.kind === 'summary' && (!settings.data.summaryEnabled || p.draft.summary)) return null;
      if (task.kind === 'tags' && (!settings.data.tagsEnabled || p.draft.tags?.length)) return null;
      const text=plainText(p.draft.content);
      if (!text.trim()) return null;
      return { title:p.draft.title, text:text.slice(0,48000), truncated:text.length>48000 };
    }
    if (p.status !== 'PUBLIC' || p.version !== task.post_version) return null;
    const article = { title: p.title, text: p.content_text.slice(0, 48000), truncated: p.content_text.length>48000 };
    if (!(task.priority ? settings.data.mentionsEnabled : settings.data.commentsEnabled) || !p.comments_enabled) return null;
    const c = (await query.query(`SELECT c.*,COALESCE(c.guest_name,u.custom_nickname,u.nickname,'회원') AS name,
      target.ai_identity IS NOT NULL AS replies_to_assistant
      FROM comments c LEFT JOIN users u ON u.id=c.user_id
      LEFT JOIN comments target ON target.id=COALESCE(c.reply_to_id,c.parent_id) AND target.post_id=c.post_id AND target.status='VISIBLE'
      WHERE c.id=$1 AND c.status='VISIBLE' AND c.ai_identity IS NULL`, [task.comment_id])).rows[0];
    if (!c || (!task.priority && c.user_id === p.author_id)) return null;
    if (task.priority && !c.replies_to_assistant && !isMention(c.content, settings.data.mentionKeyword)) return null;
    const answered = await query.query(`SELECT 1 FROM comments r LEFT JOIN users u ON u.id=r.user_id
      WHERE COALESCE(r.reply_to_id,r.parent_id)=$1 AND r.status='VISIBLE'
      AND (r.ai_identity IS NOT NULL OR r.user_id=$2 OR (u.issuer=$3 AND u.subject=$4)) LIMIT 1`,
      [c.id,p.author_id,config.ADMIN_OIDC_ISSUER,config.ADMIN_OIDC_SUBJECT]);
    if (answered.rowCount) return null;
    const root = c.parent_id ?? c.id;
    const thread = (await query.query(`SELECT c.content,c.created_at AS date,COALESCE(c.ai_identity->>'name',c.guest_name,u.custom_nickname,u.nickname,'회원') AS name,
      c.ai_identity IS NOT NULL AS "isAi" FROM comments c LEFT JOIN users u ON u.id=c.user_id
      WHERE (c.id=$1 OR c.parent_id=$1) AND c.status='VISIBLE' AND c.id<>$2
      ORDER BY c.created_at DESC,c.id DESC LIMIT 8`, [root,c.id])).rows.reverse();
    // Identity comes from the authenticated account, never from a nickname or model-provided user ID.
    const memory = !c.user_id || !settings.data.rememberMembers ? [] : (await query.query(`SELECT p.title,c.content,c.created_at AS date,
      (SELECT jsonb_agg(jsonb_build_object('content',r.content,'date',r.created_at)) FROM comments r
        WHERE COALESCE(r.reply_to_id,r.parent_id)=c.id AND r.status='VISIBLE' AND r.ai_identity IS NOT NULL) AS replies
      FROM comments c JOIN posts p ON p.id=c.post_id WHERE c.user_id=$1 AND c.status='VISIBLE' AND p.status='PUBLIC'
      AND c.id<>$2 AND c.created_at>now()-($3*interval '1 day')
      ORDER BY c.created_at DESC,c.id DESC LIMIT 8`, [c.user_id,c.id,settings.data.memoryDays])).rows;
    const recentResponses = (await query.query(`SELECT c.content FROM comments c JOIN posts p ON p.id=c.post_id
      WHERE c.ai_identity IS NOT NULL AND c.status='VISIBLE' AND p.status='PUBLIC'
      ORDER BY c.created_at DESC,c.id DESC LIMIT 6`)).rows.map(row => row.content);
    return { article, recentResponses, directMention: task.priority, target: { name:c.name, content:c.content, date:c.created_at }, thread, memory };
  }

  async claim(id: string, raw: unknown) {
    const { hash } = z.object({ hash:z.string().regex(/^[a-f0-9]{64}$/) }).strict().parse(raw);
    return this.db.transaction(async tx => {
      await tx.query('SELECT id FROM ai_tasks WHERE id=$1 FOR UPDATE', [id]);
      const task = await this.task(id, tx);
      if (task.input_hash !== hash || !['RUNNING','SUCCEEDED','SKIPPED'].includes(task.state)) throw new ConflictException('요청 상태가 변경되었습니다.');
      if (task.result) return { cached:true, result:task.result };
      const row = await tx.query('UPDATE ai_tasks SET execution_started_at=now() WHERE id=$1 AND execution_started_at IS NULL RETURNING id', [id]);
      if (!row.rowCount) throw new ConflictException('이미 실행 중이거나 결과 확인이 필요한 요청입니다.');
      return { cached:false };
    });
  }

  async cacheResult(id: string, raw: unknown, requestId?:string) {
    const { hash, result } = z.object({hash:z.string().regex(/^[a-f0-9]{64}$/),result:z.unknown()}).strict().parse(raw);
    const task = await this.task(id), data = parseResult(task.kind, result);
    const updated = await this.db.query(`UPDATE ai_tasks SET result=$3 WHERE id=$1 AND input_hash=$2
      AND execution_started_at IS NOT NULL AND result IS NULL AND ($4::uuid IS NULL OR ai_request_id=$4)
      RETURNING id`, [id,hash,data,requestId??null]);
    if (!updated.rowCount) {
      const current = await this.task(id);
      if ((requestId&&current.ai_request_id!==requestId) || current.input_hash !== hash || inputHash(current.result ?? {}) !== inputHash(data)) throw new ConflictException();
    }
    return data;
  }

  async cacheFailure(id:string,raw:unknown) {
    const {hash}=z.object({hash:z.string().regex(/^[a-f0-9]{64}$/)}).strict().parse(raw);
    const updated=await this.db.query(`UPDATE ai_tasks SET execution_error='GENERATION_FAILED'
      WHERE id=$1 AND input_hash=$2 AND execution_started_at IS NOT NULL AND result IS NULL RETURNING id`,[id,hash]);
    if(!updated.rowCount)throw new ConflictException();
    return {error:'GENERATION_FAILED'};
  }

  async apply(id: string, assertLease: () => void) {
    return this.db.transaction(async tx => {
      const initial = await this.task(id, tx);
      // Same order as publication and deletion: post, draft, comment, task.
      if (initial.post_id) await tx.query('SELECT id FROM posts WHERE id=$1 FOR UPDATE', [initial.post_id]);
      if (initial.post_id) await tx.query('SELECT post_id FROM post_drafts WHERE post_id=$1 FOR UPDATE', [initial.post_id]);
      if (initial.comment_id) await tx.query('SELECT id FROM comments WHERE id=$1 FOR UPDATE', [initial.comment_id]);
      await tx.query('SELECT id FROM ai_tasks WHERE id=$1 FOR UPDATE', [id]);
      const task = await this.task(id, tx);
      if (['SUCCEEDED','SKIPPED'].includes(task.state)) return;
      await tx.query('SELECT singleton FROM ai_settings WHERE singleton=true FOR SHARE');
      const context = task.manual_request ? null : await this.context(task, tx);
      if (!task.manual_request && (!context || inputHash(context) !== task.input_hash)) {
        await tx.query("UPDATE ai_tasks SET state='SKIPPED',completed_at=now(),error_code='CONTEXT_CHANGED' WHERE id=$1", [id]);
        assertLease(); return;
      }
      const result = parseResult(task.kind, task.result) as any;
      let skipped = false;
      if (task.kind === 'summary') {
        await tx.query('UPDATE post_drafts SET ai_summary=$2,ai_summary_version=version,ai_summary_identity=$3,ai_revision=ai_revision+1 WHERE post_id=$1',
          [task.post_id,result.summary,identity(task.profile)]);
        await tx.query('UPDATE posts SET ai_summary=$2,ai_summary_version=version,ai_summary_identity=$3,updated_at=now() WHERE id=$1',
          [task.post_id,result.summary,identity(task.profile)]);
      }
      if (task.kind === 'tags') {
        const tags=[...new Map((result.tags as string[]).map(name=>[normalizeTag(name),name.trim().normalize('NFC')])).values()];
        const draft=(await tx.query('SELECT data,ai_tags FROM post_drafts WHERE post_id=$1',[task.post_id])).rows[0];
        const previous=new Set((draft.ai_tags as string[]).map(normalizeTag));
        const manual=(draft.data.tags as string[]).filter(name=>!previous.has(normalizeTag(name)));
        const merged=[...new Map([...manual,...tags].map(name=>[normalizeTag(name),name])).values()].slice(0,20);
        await tx.query(`UPDATE post_drafts SET data=jsonb_set(data,'{tags}',$2),ai_tags=$3,ai_revision=ai_revision+1,updated_at=now()
          WHERE post_id=$1`, [task.post_id,JSON.stringify(merged),JSON.stringify(tags)]);
        const published=(await tx.query(`SELECT p.ai_tags,COALESCE((SELECT jsonb_agg(t.name) FROM post_tags pt
          JOIN tags t ON t.id=pt.tag_id WHERE pt.post_id=p.id),'[]') AS tags FROM posts p WHERE p.id=$1`,[task.post_id])).rows[0];
        const previousPublished=new Set((published.ai_tags as string[]).map(normalizeTag));
        const manualPublished=(published.tags as string[]).filter(name=>!previousPublished.has(normalizeTag(name)));
        const publicTags=[...new Map([...manualPublished,...tags].map(name=>[normalizeTag(name),name])).values()].slice(0,20);
        await syncTags(tx,task.post_id!,publicTags);
        await tx.query('UPDATE posts SET ai_tags=$2,updated_at=now() WHERE id=$1',[task.post_id,JSON.stringify(tags)]);
      }
      if (task.kind === 'comment') {
        if (!result.comment) skipped = true;
        else {
          const c = (await tx.query('SELECT parent_id FROM comments WHERE id=$1', [task.comment_id])).rows[0];
          const commentId = randomUUID();
          await tx.query(`INSERT INTO comments(id,post_id,parent_id,reply_to_id,content,request_hash,ai_identity)
            VALUES($1,$2,$3,$4,$5,$6,$7)`, [commentId,task.post_id,c.parent_id ?? task.comment_id,task.comment_id,result.comment,id,identity(task.profile)]);
          await new Notifications(this.db).enqueue(tx, commentId);
        }
      }
      if (task.kind === 'article') {
        if (result.skip) skipped = true;
        else {
          const postId = randomUUID(), data = initialPost(`ai-${postId.slice(0,8)}`);
          data.title = result.title;
          const category=(await tx.query("SELECT id FROM categories WHERE slug='lumi-view' FOR SHARE")).rows[0];
          if (!category) throw new ConflictException('루미의 시선 카테고리가 필요합니다.');
          data.categoryId=category.id;
          data.content.content.content = [...result.paragraphs, '출처', ...result.sources.map((s:any) => `${s.title}\n${s.url}`)]
            .map((text:string) => ({type:'paragraph',content:[{type:'text',text}]}));
          await createDraft(tx,postId,data,task.actor_id!,identity(task.profile));
          await tx.query('UPDATE ai_tasks SET post_id=$2 WHERE id=$1', [id,postId]);
        }
      }
      await tx.query('UPDATE ai_tasks SET state=$2,completed_at=now(),error_code=NULL WHERE id=$1', [id,skipped?'SKIPPED':'SUCCEEDED']);
      await tx.query("INSERT INTO audit_events(action,target_id) VALUES('ai.result.apply',$1)", [id]);
      assertLease();
    });
  }

  prompt(task: AiTask) { return systemPrompt(task.profile, task.kind); }
}
