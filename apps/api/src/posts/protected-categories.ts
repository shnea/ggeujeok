import { ForbiddenException } from '@nestjs/common';
import type { PoolClient } from 'pg';

export const isProtectedCategory = (slug: string) => slug === 'privacy' || slug === 'app100';

export async function hasProtectedCategory(tx: PoolClient, ...ids: (string | null)[]) {
  const {rows} = await tx.query('SELECT slug FROM categories WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE', [ids.filter(Boolean)]);
  return rows.some(row => isProtectedCategory(row.slug));
}

export async function keepProtectedCategory(tx: PoolClient, previousId: string | null, nextId: string | null) {
  if (previousId && previousId !== nextId && await hasProtectedCategory(tx,previousId)) {
    throw new ForbiddenException('보호 카테고리에 속한 글은 다른 카테고리로 옮길 수 없습니다.');
  }
}
