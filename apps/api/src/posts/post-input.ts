import { BadRequestException } from '@nestjs/common';
import { emptyDocument, parseDocument, type EditorDocument } from '@shnea/editor';
import { z } from 'zod';

export const uuid = z.uuid();
export const slug = z.string().trim().min(1).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const postInput = z.object({
  title: z.string().trim().min(1).max(200), slug,
  summary: z.string().trim().max(500), categoryId: uuid.nullable(),
  thumbnailId: uuid.nullable().default(null),
  commentsEnabled: z.boolean().default(true),
  adsEnabled: z.boolean().default(true),
  tags: z.array(z.string().trim().min(1).max(80)).max(20), content: z.unknown(),
}).strict();
export const saveInput = z.object({ version: z.number().int().positive(), aiRevision:z.number().int().nonnegative().default(0), data: postInput }).strict();
export const publishInput = z.object({ draftVersion: z.number().int().positive(), baseVersion: z.number().int().positive(),
  status: z.enum(['PUBLIC', 'PRIVATE']) }).strict();
export const categoryInput = z.object({ name: z.string().trim().normalize('NFC').min(1).max(80), slug,
  sortOrder: z.number().int().min(0).max(10000).default(0) }).strict();
export const listInput = z.object({ page: z.coerce.number().int().min(1).max(10000).default(1),
  q: z.string().trim().max(100).default(''), category: slug.optional(), tag: z.string().max(120).optional() });
export const tagSearchInput = z.object({ q: z.string().trim().normalize('NFC').max(80).default('') });

export type PostData = Omit<z.infer<typeof postInput>, 'content'> & { content: EditorDocument };
export const initialPost = (postSlug: string): PostData => ({ title: '제목 없는 글', slug: postSlug,
  summary: '', categoryId: null, thumbnailId: null, commentsEnabled: true, adsEnabled: true, tags: [], content: emptyDocument() });

export function validatePost(input: unknown): PostData {
  const data = postInput.parse(input);
  if (Buffer.byteLength(JSON.stringify(data.content) ?? '') > 2 * 1024 * 1024) throw new BadRequestException('본문은 2MiB까지 저장할 수 있습니다.');
  if ((data.content as { version?: unknown })?.version !== 3) throw new BadRequestException('에디터 version 3 문서가 필요합니다.');
  let content: EditorDocument;
  try { content = parseDocument(data.content); } catch { throw new BadRequestException('본문 문서 형식을 확인해 주세요.'); }
  const tags = [...new Map(data.tags.map(name => [normalizeTag(name), name.trim().normalize('NFC')])).values()];
  return { ...data, tags, content };
}

export const normalizeTag = (name: string) => name.trim().normalize('NFC').toLocaleLowerCase('und');

export function plainText(document: EditorDocument) {
  function text(node: EditorDocument['content']): string {
    if (node.text) return node.text;
    const separator = ['paragraph', 'heading', 'codeBlock'].includes(node.type || '') ? '' : '\n';
    return (node.content || []).map(text).join(separator);
  }
  return text(document.content).trim();
}
