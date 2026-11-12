import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { PoolClient } from 'pg';
import { createDraft } from './create-draft.js';
import { Database } from '../database/database.js';
import { syncImageReferences } from '../files/references.js';
import { initialPost, listInput, normalizeTag, plainText, publishInput, saveInput, tagSearchInput, validatePost, type PostData } from './post-input.js';
import { syncTags } from './tags.js';
import { audit, type AssistantActor } from '../operations/audit.js';
import { hasProtectedCategory, keepProtectedCategory } from './protected-categories.js';
import { articleDocument, assistantPostListInput, candidateCursor, createAssistantPostInput, reviewInput, updateAssistantPostInput } from './assistant-post-input.js';

// Existing posts also get the first body image without rewriting their content.
const thumbnailColumn = `COALESCE(p.thumbnail_id::text, NULLIF(jsonb_path_query_first(p.content,
  '$.content.** ? (@.type == "attachment" && @.attrs.kind == "image" && @.attrs.fileId != "").attrs.fileId') #>> '{}',''))`;
const publicColumns = `p.id, p.slug, p.title, ${thumbnailColumn} AS "thumbnailId", COALESCE(NULLIF(p.summary,''),CASE WHEN p.ai_summary_version=p.version THEN p.ai_summary END,left(p.content_text,160)) AS summary,
  p.ai_summary_identity AS "aiSummaryIdentity",p.ai_generated AS "aiGenerated",p.ai_identity AS "aiIdentity",(p.summary='' AND p.ai_summary_version=p.version AND p.ai_summary IS NOT NULL) AS "aiSummary",
  p.published_at AS "publishedAt", p.updated_at AS "updatedAt", c.name AS "categoryName", c.slug AS "categorySlug",
  COALESCE((SELECT jsonb_agg(jsonb_build_object('name',t.name,'slug',t.slug) ORDER BY t.name)
    FROM post_tags pt JOIN tags t ON t.id=pt.tag_id WHERE pt.post_id=p.id),'[]') AS tags`;

@Injectable()
export class Posts {
  constructor(@Inject(Database) private readonly db: Database) {}

  async list(query: unknown) {
    const { page, q, category, tag } = listInput.parse(query);
    const terms = q.split(/\s+/).filter(Boolean);
    const params = [terms, category ?? null, tag ?? null, q, (page - 1) * 12];
    const result = await this.db.query(`SELECT ${publicColumns}, count(*) OVER()::int AS total FROM posts p
      LEFT JOIN categories c ON c.id=p.category_id WHERE p.status='PUBLIC'
      AND ($2::text IS NULL OR c.slug=$2)
      AND ($3::text IS NULL OR EXISTS(SELECT 1 FROM post_tags pt JOIN tags t ON t.id=pt.tag_id WHERE pt.post_id=p.id AND t.slug=$3))
      AND NOT EXISTS(SELECT 1 FROM unnest($1::text[]) term WHERE strpos(lower(concat_ws(' ',p.title,p.summary,p.content_text,c.name,
        (SELECT string_agg(t.name,' ') FROM post_tags pt JOIN tags t ON t.id=pt.tag_id WHERE pt.post_id=p.id))),lower(term))=0)
      ORDER BY CASE WHEN $4<>'' AND lower(p.title)=lower($4) THEN 0 WHEN $4<>'' AND strpos(lower(p.title),lower($4))>0 THEN 1 ELSE 2 END,
      p.published_at DESC,p.id DESC LIMIT 12 OFFSET $5`, params);
    return { items: result.rows.map(({ total, ...row }) => row), total: result.rows[0]?.total ?? 0, page };
  }

  async publicPost(slug: string) {
    const result = await this.db.query(`SELECT ${publicColumns},p.content,p.ads_enabled AS "adsEnabled" FROM posts p
      LEFT JOIN categories c ON c.id=p.category_id WHERE p.slug=$1 AND p.status='PUBLIC'`, [slug]);
    if (!result.rows[0]) throw new NotFoundException('글을 찾을 수 없습니다.');
    return result.rows[0];
  }

  async categories() {
    return (await this.db.query('SELECT id,name,slug,sort_order AS "sortOrder" FROM categories ORDER BY sort_order,name,id')).rows;
  }

  async related(slug: string) {
    const current = await this.db.query("SELECT id FROM posts WHERE slug=$1 AND status='PUBLIC'", [slug]);
    if (!current.rows[0]) throw new NotFoundException('글을 찾을 수 없습니다.');
    return (await this.db.query(`WITH ranked AS (
      SELECT p.id, CASE WHEN p.category_id=source.category_id THEN 3 ELSE 0 END +
        2*(SELECT count(*)::int FROM post_tags a JOIN post_tags b ON a.tag_id=b.tag_id
          WHERE a.post_id=source.id AND b.post_id=p.id) AS score
      FROM posts p JOIN posts source ON source.id=$1 AND source.status='PUBLIC'
      WHERE p.status='PUBLIC' AND p.id<>source.id
    ) SELECT ${publicColumns} FROM ranked r JOIN posts p ON p.id=r.id
      LEFT JOIN categories c ON c.id=p.category_id WHERE r.score>0
      ORDER BY r.score DESC,p.published_at DESC,p.id DESC LIMIT 4`, [current.rows[0].id])).rows;
  }

  async neighbors(slug: string) {
    const result = await this.db.query(`SELECT
      (SELECT jsonb_build_object('slug',p.slug,'title',p.title) FROM posts p
        WHERE p.status='PUBLIC' AND (p.published_at,p.id)<(source.published_at,source.id)
        ORDER BY p.published_at DESC,p.id DESC LIMIT 1) AS previous,
      (SELECT jsonb_build_object('slug',p.slug,'title',p.title) FROM posts p
        WHERE p.status='PUBLIC' AND (p.published_at,p.id)>(source.published_at,source.id)
        ORDER BY p.published_at,p.id LIMIT 1) AS next
      FROM posts source WHERE source.slug=$1 AND source.status='PUBLIC'`, [slug]);
    if (!result.rows[0]) throw new NotFoundException('글을 찾을 수 없습니다.');
    return result.rows[0];
  }

  async feed() {
    return (await this.db.query(`SELECT ${publicColumns} FROM posts p
      LEFT JOIN categories c ON c.id=p.category_id WHERE p.status='PUBLIC'
      ORDER BY p.published_at DESC,p.id DESC LIMIT 50`)).rows;
  }

  async sitemap() {
    return (await this.db.query(`SELECT slug,updated_at AS "updatedAt" FROM posts WHERE status='PUBLIC'
      ORDER BY published_at DESC,id DESC LIMIT 50001`)).rows;
  }

  async tags(query: unknown) {
    const q = normalizeTag(tagSearchInput.parse(query).q);
    if (!q) return [];
    // Include draft-only tags; prefer the catalog's display name when both exist.
    return (await this.db.query(`WITH candidates AS (
      SELECT name,normalized_name,0 AS source FROM tags
      UNION ALL
      SELECT normalize(trim(name),NFC),lower(normalize(trim(name),NFC)),1
      FROM post_drafts d CROSS JOIN LATERAL jsonb_array_elements_text(d.data->'tags') AS tag(name)
    ), unique_tags AS (
      SELECT DISTINCT ON (normalized_name) name,normalized_name FROM candidates
      WHERE strpos(normalized_name,$1)>0 ORDER BY normalized_name,source,name
    ) SELECT name FROM unique_tags
      ORDER BY CASE WHEN normalized_name=$1 THEN 0 WHEN starts_with(normalized_name,$1) THEN 1 ELSE 2 END,
        normalized_name LIMIT 8`, [q])).rows;
  }

  async publicImage(slug: string) {
    const result = await this.db.query(`SELECT ${thumbnailColumn} AS id FROM posts p WHERE p.slug=$1 AND p.status='PUBLIC'`, [slug]);
    if (!result.rows[0]?.id) throw new NotFoundException('대표 이미지를 찾을 수 없습니다.');
    return result.rows[0].id as string;
  }

  async adminList() {
    return (await this.db.query(`SELECT p.id,COALESCE(d.data->>'title',p.title) AS title,p.slug,p.status,p.updated_at AS "updatedAt", d.updated_at AS "draftUpdatedAt"
      FROM posts p LEFT JOIN post_drafts d ON d.post_id=p.id ORDER BY p.updated_at DESC,p.id DESC LIMIT 50`)).rows;
  }

  async create(actor: string) {
    const id = randomUUID(), data = initialPost(`post-${id.slice(0, 8)}`);
    await this.db.transaction(async tx => {
      await createDraft(tx,id,data,actor);
      await audit(tx, actor, 'post.create', id);
    });
    return { id };
  }

  async listForAssistant(raw: unknown) {
    const {page,q,category,status} = assistantPostListInput.parse(raw);
    const {rows} = await this.db.query(`SELECT p.id,p.slug,CASE WHEN p.status='PUBLIC' THEN p.title ELSE d.data->>'title' END AS title,
      COALESCE(NULLIF(CASE WHEN p.status='PUBLIC' THEN p.summary ELSE d.data->>'summary' END,''),
        CASE WHEN p.status='PUBLIC' THEN CASE WHEN p.ai_summary_version=p.version THEN p.ai_summary END ELSE d.ai_summary END,
        left(p.content_text,160)) AS summary,p.status,
      p.ai_generated AS "aiGenerated",c.slug AS category,d.version,p.published_at AS "publishedAt",p.updated_at AS "updatedAt"
      FROM posts p JOIN post_drafts d ON d.post_id=p.id LEFT JOIN categories c ON c.id=CASE WHEN p.status='PUBLIC' THEN p.category_id ELSE d.category_id END
      WHERE ($1='' OR strpos(lower(concat_ws(' ',p.slug,CASE WHEN p.status='PUBLIC' THEN p.title ELSE d.data->>'title' END)),lower($1))>0)
      AND ($2::text IS NULL OR c.slug=$2) AND ($3='ALL' OR p.status=$3)
      ORDER BY COALESCE(p.published_at,p.created_at) DESC,p.id DESC LIMIT 26 OFFSET $4`,[q,category??null,status,(page-1)*25]);
    return {items:rows.slice(0,25),nextPage:rows.length>25 ? page+1 : null};
  }

  async createForAssistant(raw: unknown, actor: AssistantActor) {
    const input = createAssistantPostInput.parse(raw);
    const {requestId,markdown,category,...fields} = input;
    const digest = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    return this.db.transaction(async tx => {
      const inserted = await tx.query(`INSERT INTO assistant_post_requests(id,input_hash) VALUES($1,$2)
        ON CONFLICT DO NOTHING RETURNING id`,[requestId,digest]);
      if (!inserted.rowCount) {
        const {rows:[existing]} = await tx.query('SELECT input_hash,post_id FROM assistant_post_requests WHERE id=$1',[requestId]);
        if (existing.input_hash !== digest || !existing.post_id) throw new ConflictException('이미 사용한 글 등록 요청 ID입니다.');
        return {id:existing.post_id,reused:true};
      }
      const id = randomUUID();
      const categoryId = await this.categoryId(tx,category);
      const data = {...initialPost(fields.slug),...fields,categoryId,content:articleDocument(markdown)};
      await createDraft(tx,id,data,actor.issuerId,actor.identity);
      await syncImageReferences(tx,id,data.content,'DRAFT',null);
      await tx.query('UPDATE assistant_post_requests SET post_id=$2 WHERE id=$1',[requestId,id]);
      await audit(tx,actor,'post.create',id);
      return {id,reused:false};
    });
  }

  async updateForAssistant(id: string, raw: unknown, actor: AssistantActor) {
    const {version,changes:{markdown,category,document,...fields}} = updateAssistantPostInput.parse(raw);
    const current = await this.edit(id);
    const data: PostData = {...current.data,...fields};
    if (category) data.categoryId = await this.categoryId(this.db,category);
    if (markdown !== undefined) data.content = articleDocument(markdown);
    return this.save(id,{version,aiRevision:current.aiRevision,data:{...data,content:document===undefined ? data.content : document}},actor);
  }

  private async categoryId(query: PoolClient | Database, category: string) {
    const {rows:[row]} = await query.query('SELECT id FROM categories WHERE slug=$1 FOR SHARE',[category]);
    if (!row) throw new BadRequestException('지정한 카테고리를 찾을 수 없습니다.');
    return row.id as string;
  }

  async reviewCandidates(raw: unknown) {
    const {after} = candidateCursor.parse(raw);
    const {rows} = await this.db.query(`SELECT p.id,p.slug,p.title,d.version,p.review_source AS "sourceUrl",
      COALESCE(p.next_review_at,GREATEST(p.published_at,p.last_reviewed_at)+interval '30 days') AS "dueAt"
      FROM posts p JOIN post_drafts d ON d.post_id=p.id WHERE p.status='PUBLIC' AND ($1::uuid IS NULL OR p.id>$1)
      AND COALESCE(p.next_review_at,GREATEST(p.published_at,p.last_reviewed_at)+interval '30 days')<=now()
      ORDER BY p.id LIMIT 21`,[after??null]);
    return {items:rows.slice(0,20),nextCursor:rows.length>20 ? rows[19].id : null};
  }

  async recordReview(id: string, raw: unknown, actor: AssistantActor, complete: boolean) {
    const {version,nextReviewAt,sourceUrl} = reviewInput.parse(raw);
    if (complete && nextReviewAt && Date.parse(nextReviewAt)<=Date.now()) throw new BadRequestException('다음 점검일은 미래 시각이어야 합니다.');
    return this.db.transaction(async tx => {
      const {rows:[post]} = await tx.query(`SELECT d.version FROM posts p JOIN post_drafts d ON d.post_id=p.id
        WHERE p.id=$1 FOR UPDATE OF p,d`,[id]);
      if (!post) throw new NotFoundException('글을 찾을 수 없습니다.');
      if (post.version !== version) throw new ConflictException('편집본이 변경됐습니다. 다시 확인해 주세요.');
      const {rows:[review]} = await tx.query(`UPDATE posts SET last_reviewed_at=CASE WHEN $2 THEN now() ELSE last_reviewed_at END,
        next_review_at=COALESCE($3::timestamptz,CASE WHEN $2 THEN now()+interval '30 days' ELSE now() END),
        review_source=CASE WHEN $4 THEN $5 ELSE review_source END WHERE id=$1
        RETURNING next_review_at AS "nextReviewAt",review_source AS "sourceUrl"`,[id,complete,nextReviewAt??null,sourceUrl!==undefined,sourceUrl??null]);
      await audit(tx,actor,complete?'post.review.complete':'post.review.request',id);
      return review;
    });
  }

  async edit(id: string) {
    const result = await this.db.query(`SELECT p.id,p.status,p.published_at AS "publishedAt",p.version AS "postVersion",p.ai_generated AS "aiGenerated",p.ai_identity AS "aiIdentity",d.ai_summary AS "aiSummary",
      d.ai_tags AS "aiTags",d.ai_revision AS "aiRevision",d.data,d.version,d.base_version AS "baseVersion" FROM posts p JOIN post_drafts d ON d.post_id=p.id WHERE p.id=$1`, [id]);
    if (!result.rows[0]) throw new NotFoundException('글을 찾을 수 없습니다.');
    return result.rows[0];
  }

  async save(id: string, input: unknown, actor?: AssistantActor) {
    const { version, aiRevision, data: raw } = saveInput.parse(input);
    const data = validatePost(raw);
    return this.db.transaction(async tx => {
      const post = await tx.query('SELECT slug,published_at FROM posts WHERE id=$1 FOR UPDATE', [id]);
      if (!post.rows[0]) throw new NotFoundException();
      if (post.rows[0].published_at && post.rows[0].slug !== data.slug) throw new BadRequestException('최초 공개 후에는 주소를 바꿀 수 없습니다.');
      const draft=(await tx.query('SELECT ai_tags,ai_revision,category_id,version FROM post_drafts WHERE post_id=$1',[id])).rows[0];
      if (!draft || draft.version!==version) throw new ConflictException('다른 화면에서 편집본이 바뀌었습니다. 내용을 복사한 뒤 다시 열어 주세요.');
      await keepProtectedCategory(tx,draft.category_id,data.categoryId);
      let aiTags=draft.ai_tags as string[];
      if(aiRevision!==draft.ai_revision){
        data.tags=[...new Map([...data.tags,...aiTags].map(name=>[normalizeTag(name),name])).values()].slice(0,20);
      }else{
        const selected=new Set(data.tags.map(normalizeTag));
        aiTags=aiTags.filter(name=>selected.has(normalizeTag(name)));
      }
      const result = await tx.query(`UPDATE post_drafts SET data=$2,version=version+1,updated_at=now(),
        ai_tags=$4,ai_summary_version=CASE WHEN ai_summary IS NOT NULL THEN version+1 ELSE ai_summary_version END
        WHERE post_id=$1 AND version=$3 RETURNING version,base_version AS "baseVersion",data->'tags' AS tags,
          ai_tags AS "aiTags",ai_revision AS "aiRevision",ai_summary AS "aiSummary"`, [id, data, version,JSON.stringify(aiTags)]);
      if (!result.rows[0]) throw new ConflictException('다른 화면에서 편집본이 바뀌었습니다. 내용을 복사한 뒤 다시 열어 주세요.');
      await syncImageReferences(tx, id, data.content, 'DRAFT', data.thumbnailId);
      if (actor) await audit(tx,actor,'post.update',id);
      return result.rows[0];
    });
  }

  async publish(id: string, input: unknown, actor: string | AssistantActor) {
    const expected = publishInput.parse(input);
    return this.db.transaction(async tx => {
      const locked = await tx.query(`SELECT p.*,d.data,d.version AS draft_version,d.base_version,
        d.ai_summary AS draft_ai_summary,d.ai_summary_version AS draft_ai_summary_version,d.ai_summary_identity AS draft_ai_summary_identity,d.ai_tags AS draft_ai_tags
        FROM posts p JOIN post_drafts d ON d.post_id=p.id WHERE p.id=$1 FOR UPDATE OF p,d`, [id]);
      const post = locked.rows[0];
      if (!post) throw new NotFoundException();
      if (post.draft_version !== expected.draftVersion || post.version !== expected.baseVersion || post.base_version !== post.version) {
        throw new ConflictException('글 또는 편집본이 변경됐습니다. 새로 확인한 뒤 반영해 주세요.');
      }
      const data = validatePost(post.data), text = plainText(data.content);
      await keepProtectedCategory(tx,post.category_id,data.categoryId);
      if (post.status==='PUBLIC' && expected.status==='PRIVATE' && await hasProtectedCategory(tx,post.category_id,data.categoryId)) {
        throw new ForbiddenException('공개 중인 보호 글은 비공개로 전환할 수 없습니다.');
      }
      const images = await syncImageReferences(tx, id, data.content, 'PUBLISHED', data.thumbnailId);
      if (expected.status === 'PUBLIC' && ((!text && !images.length) || !data.categoryId)) throw new BadRequestException('공개하려면 본문과 카테고리가 필요합니다.');
      if (post.published_at && post.slug !== data.slug) throw new BadRequestException('최초 공개 후에는 주소를 바꿀 수 없습니다.');
      const result = await tx.query(`UPDATE posts SET title=$2,slug=$3,summary=$4,content=$5,content_text=$6,category_id=$7,status=$8,thumbnail_id=$9,comments_enabled=$10,ads_enabled=$11,
        published_at=CASE WHEN $8='PUBLIC' THEN COALESCE(published_at,now()) ELSE published_at END,version=version+1,updated_at=now()
        WHERE id=$1 RETURNING version`, [id, data.title, data.slug, data.summary, data.content, text, data.categoryId, expected.status, data.thumbnailId, data.commentsEnabled,data.adsEnabled]);
      const changed = !post.published_at || !isDeepStrictEqual(post.content,data.content) || post.title !== data.title;
      if (!data.summary && post.draft_ai_summary)
        await tx.query('UPDATE posts SET ai_summary=$2,ai_summary_version=version,ai_summary_identity=$3 WHERE id=$1',
          [id,post.draft_ai_summary,post.draft_ai_summary_identity]);
      else if (!changed && post.ai_summary_version === post.version) await tx.query('UPDATE posts SET ai_summary_version=version WHERE id=$1', [id]);
      await syncTags(tx,id,data.tags);
      await tx.query('UPDATE posts SET ai_tags=$2 WHERE id=$1',[id,JSON.stringify(post.draft_ai_tags)]);
      await tx.query(`UPDATE post_drafts SET base_version=$2,version=version+1,updated_at=now(),
        ai_summary_version=CASE WHEN ai_summary_version=version THEN version+1 ELSE ai_summary_version END WHERE post_id=$1`, [id, result.rows[0].version]);
      await audit(tx, actor, expected.status === 'PUBLIC' ? 'post.publish' : 'post.private', id);
      return { slug: data.slug, status: expected.status, version: post.draft_version + 1, baseVersion: result.rows[0].version };
    });
  }

  async remove(id: string, actor: string | AssistantActor) {
    return this.db.transaction(async tx => {
      const {rows:[post]} = await tx.query(`SELECT p.category_id,d.category_id AS draft_category_id FROM posts p
        LEFT JOIN post_drafts d ON d.post_id=p.id WHERE p.id=$1 FOR UPDATE OF p`,[id]);
      if (!post) throw new NotFoundException();
      if (await hasProtectedCategory(tx,post.category_id,post.draft_category_id)) throw new ForbiddenException('보호 카테고리의 글은 삭제할 수 없습니다.');
      const result = await tx.query('DELETE FROM posts WHERE id=$1 RETURNING id', [id]);
      if (!result.rowCount) throw new NotFoundException();
      await audit(tx, actor, 'post.delete', id);
      return { deleted: true };
    });
  }

}
