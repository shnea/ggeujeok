import {createHash} from 'node:crypto';
import type {PoolClient} from 'pg';
import {normalizeTag} from './post-input.js';

export async function syncTags(tx:PoolClient,postId:string,names:string[]){
  await tx.query('DELETE FROM post_tags WHERE post_id=$1',[postId]);
  for(const name of names){
    const normalized=normalizeTag(name),slug=createHash('sha256').update(normalized).digest('hex').slice(0,16);
    const tag=(await tx.query(`INSERT INTO tags(name,normalized_name,slug) VALUES($1,$2,$3)
      ON CONFLICT(normalized_name) DO UPDATE SET normalized_name=EXCLUDED.normalized_name RETURNING id`,[name,normalized,slug])).rows[0];
    await tx.query('INSERT INTO post_tags(post_id,tag_id) VALUES($1,$2)',[postId,tag.id]);
  }
}
