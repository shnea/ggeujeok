import type { PoolClient } from 'pg';
import { validatePost, plainText } from './post-input.js';

// Human and AI drafts share validation, content extraction and atomic creation.
export async function createDraft(tx:PoolClient,id:string,input:unknown,actor:string,aiIdentity:{name:string;imageUrl:string|null}|null=null) {
  const data=validatePost(input);
  await tx.query(`INSERT INTO posts(id,slug,title,content,content_text,summary,category_id,author_id,ai_generated,ai_identity,ads_enabled)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[id,data.slug,data.title,data.content,plainText(data.content),data.summary,data.categoryId,actor,Boolean(aiIdentity),aiIdentity,data.adsEnabled]);
  await tx.query('INSERT INTO post_drafts(post_id,data,base_version) VALUES($1,$2,1)',[id,data]);
}
