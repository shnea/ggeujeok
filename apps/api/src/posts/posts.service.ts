import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID, createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { PoolClient } from 'pg';
import { createDraft } from './create-draft.js';
import { Database } from '../database/database.js';
import { syncImageReferences } from '../files/references.js';
import { initialPost, listInput, normalizeTag, plainText, publishInput, saveInput, tagSearchInput, validatePost, type PostData } from './post-input.js';

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
    const result = await this.db.query(`SELECT ${publicColumns},p.content FROM posts p
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
      await this.audit(tx, actor, 'post.create', id);
    });
    return { id };
  }

  async edit(id: string) {
    const result = await this.db.query(`SELECT p.id,p.status,p.published_at AS "publishedAt",p.version AS "postVersion",p.ai_generated AS "aiGenerated",p.ai_identity AS "aiIdentity",CASE WHEN d.ai_summary_version=d.version THEN d.ai_summary END AS "aiSummary",
      d.data,d.version,d.base_version AS "baseVersion" FROM posts p JOIN post_drafts d ON d.post_id=p.id WHERE p.id=$1`, [id]);
    if (!result.rows[0]) throw new NotFoundException('글을 찾을 수 없습니다.');
    return result.rows[0];
  }

  async save(id: string, input: unknown) {
    const { version, data: raw } = saveInput.parse(input);
    const data = validatePost(raw);
    return this.db.transaction(async tx => {
      const post = await tx.query('SELECT slug,published_at FROM posts WHERE id=$1 FOR UPDATE', [id]);
      if (!post.rows[0]) throw new NotFoundException();
      if (post.rows[0].published_at && post.rows[0].slug !== data.slug) throw new BadRequestException('최초 공개 후에는 주소를 바꿀 수 없습니다.');
      const result = await tx.query(`UPDATE post_drafts SET data=$2,version=version+1,updated_at=now(),
        ai_summary_version=CASE WHEN ai_summary_version=version AND data->'content'=$2::jsonb->'content'
          AND data->>'title'=$2::jsonb->>'title' THEN version+1 ELSE ai_summary_version END
        WHERE post_id=$1 AND version=$3 RETURNING version,base_version AS "baseVersion"`, [id, data, version]);
      if (!result.rows[0]) throw new ConflictException('다른 화면에서 편집본이 바뀌었습니다. 내용을 복사한 뒤 다시 열어 주세요.');
      await syncImageReferences(tx, id, data.content, 'DRAFT', data.thumbnailId);
      return result.rows[0];
    });
  }

  async publish(id: string, input: unknown, actor: string) {
    const expected = publishInput.parse(input);
    return this.db.transaction(async tx => {
      const locked = await tx.query(`SELECT p.*,d.data,d.version AS draft_version,d.base_version,
        d.ai_summary AS draft_ai_summary,d.ai_summary_version AS draft_ai_summary_version,d.ai_summary_identity AS draft_ai_summary_identity
        FROM posts p JOIN post_drafts d ON d.post_id=p.id WHERE p.id=$1 FOR UPDATE OF p,d`, [id]);
      const post = locked.rows[0];
      if (!post) throw new NotFoundException();
      if (post.draft_version !== expected.draftVersion || post.version !== expected.baseVersion || post.base_version !== post.version) {
        throw new ConflictException('글 또는 편집본이 변경됐습니다. 새로 확인한 뒤 반영해 주세요.');
      }
      const data = validatePost(post.data), text = plainText(data.content);
      const images = await syncImageReferences(tx, id, data.content, 'PUBLISHED', data.thumbnailId);
      if (expected.status === 'PUBLIC' && ((!text && !images.length) || !data.categoryId)) throw new BadRequestException('공개하려면 본문과 카테고리가 필요합니다.');
      if (post.published_at && post.slug !== data.slug) throw new BadRequestException('최초 공개 후에는 주소를 바꿀 수 없습니다.');
      const result = await tx.query(`UPDATE posts SET title=$2,slug=$3,summary=$4,content=$5,content_text=$6,category_id=$7,status=$8,thumbnail_id=$9,comments_enabled=$10,
        published_at=CASE WHEN $8='PUBLIC' THEN COALESCE(published_at,now()) ELSE published_at END,version=version+1,updated_at=now()
        WHERE id=$1 RETURNING version`, [id, data.title, data.slug, data.summary, data.content, text, data.categoryId, expected.status, data.thumbnailId, data.commentsEnabled]);
      const changed = !post.published_at || !isDeepStrictEqual(post.content,data.content) || post.title !== data.title;
      if (!data.summary && post.draft_ai_summary && post.draft_ai_summary_version === post.draft_version)
        await tx.query('UPDATE posts SET ai_summary=$2,ai_summary_version=version,ai_summary_identity=$3 WHERE id=$1',
          [id,post.draft_ai_summary,post.draft_ai_summary_identity]);
      else if (!changed && post.ai_summary_version === post.version) await tx.query('UPDATE posts SET ai_summary_version=version WHERE id=$1', [id]);
      await this.setTags(tx, id, data);
      await tx.query(`UPDATE post_drafts SET base_version=$2,version=version+1,updated_at=now(),
        ai_summary_version=CASE WHEN ai_summary_version=version THEN version+1 ELSE ai_summary_version END WHERE post_id=$1`, [id, result.rows[0].version]);
      await this.audit(tx, actor, expected.status === 'PUBLIC' ? 'post.publish' : 'post.private', id);
      return { slug: data.slug, status: expected.status, version: post.draft_version + 1, baseVersion: result.rows[0].version };
    });
  }

  async remove(id: string, actor: string) {
    return this.db.transaction(async tx => {
      const result = await tx.query('DELETE FROM posts WHERE id=$1 RETURNING id', [id]);
      if (!result.rowCount) throw new NotFoundException();
      await this.audit(tx, actor, 'post.delete', id);
      return { deleted: true };
    });
  }

  private async setTags(tx: PoolClient, id: string, data: PostData) {
    await tx.query('DELETE FROM post_tags WHERE post_id=$1', [id]);
    for (const name of data.tags) {
      const normalized = normalizeTag(name);
      const tagSlug = createHash('sha256').update(normalized).digest('hex').slice(0, 16);
      const tag = await tx.query(`INSERT INTO tags(name,normalized_name,slug) VALUES($1,$2,$3)
        ON CONFLICT(normalized_name) DO UPDATE SET normalized_name=EXCLUDED.normalized_name RETURNING id`, [name, normalized, tagSlug]);
      await tx.query('INSERT INTO post_tags(post_id,tag_id) VALUES($1,$2)', [id, tag.rows[0].id]);
    }
  }

  private async audit(tx: PoolClient, actor: string, action: string, id: string) {
    await tx.query('INSERT INTO audit_events(actor_id,action,target_id) VALUES($1,$2,$3)', [actor, action, id]);
  }
}
