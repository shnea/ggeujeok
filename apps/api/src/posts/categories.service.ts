import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Database } from '../database/database.js';
import { categoryInput } from './post-input.js';

const columns = 'id,name,slug,sort_order AS "sortOrder"';

@Injectable()
export class Categories {
  constructor(@Inject(Database) private readonly db: Database) {}

  async list() {
    return (await this.db.query(`SELECT c.id,c.name,c.slug,c.sort_order AS "sortOrder",
      (SELECT count(*)::int FROM (
        SELECT id FROM posts WHERE category_id=c.id
        UNION SELECT post_id FROM post_drafts WHERE category_id=c.id
      ) used) AS "postCount"
      FROM categories c ORDER BY c.sort_order,c.name,c.id`)).rows;
  }

  async save(id: string | null, input: unknown, actor: string) {
    const data = categoryInput.parse(input);
    try {
      return await this.db.transaction(async tx => {
        const values = [data.name, data.slug, data.sortOrder];
        const result = id
          ? await tx.query(`UPDATE categories SET name=$1,slug=$2,sort_order=$3,updated_at=now() WHERE id=$4 RETURNING ${columns}`, [...values, id])
          : await tx.query(`INSERT INTO categories(name,slug,sort_order) VALUES($1,$2,$3) RETURNING ${columns}`, values);
        if (!result.rows[0]) throw new NotFoundException('카테고리를 찾을 수 없습니다. 목록을 새로 확인해 주세요.');
        await tx.query('INSERT INTO audit_events(actor_id,action,target_id) VALUES($1,$2,$3)',
          [actor, id ? 'category.update' : 'category.create', result.rows[0].id]);
        return result.rows[0];
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw new ConflictException('이미 사용 중인 카테고리 이름 또는 주소입니다. 다른 값으로 입력해 주세요.');
      throw error;
    }
  }

  async remove(id: string, actor: string) {
    try {
      return await this.db.transaction(async tx => {
        const result = await tx.query('DELETE FROM categories WHERE id=$1 RETURNING id', [id]);
        if (!result.rowCount) throw new NotFoundException('카테고리를 찾을 수 없습니다. 목록을 새로 확인해 주세요.');
        await tx.query('INSERT INTO audit_events(actor_id,action,target_id) VALUES($1,$2,$3)', [actor, 'category.delete', id]);
        return { deleted: true };
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23503') throw new ConflictException('글 또는 편집본에서 사용 중입니다. 다른 카테고리로 옮긴 뒤 삭제해 주세요.');
      throw error;
    }
  }
}
