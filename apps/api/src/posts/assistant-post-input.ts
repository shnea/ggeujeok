import { BadRequestException } from '@nestjs/common';
import { fromMarkdown } from '@shnea/editor';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { postInput, slug, uuid } from './post-input.js';

const markdown = z.string().trim().min(1).max(200_000);
const fields = z.strictObject({title:postInput.shape.title.optional(),slug:slug.optional(),summary:postInput.shape.summary.optional(),
  tags:postInput.shape.tags.optional(),adsEnabled:z.boolean().optional(),commentsEnabled:z.boolean().optional()});
export const createAssistantPostInput = fields.extend({requestId:z.string().regex(/^[A-Za-z0-9_-]{1,100}$/).default(randomUUID),
  title:postInput.shape.title, slug, markdown, category:slug.default('lumi-view')});
export const updateAssistantPostInput = z.strictObject({version:z.number().int().positive(),changes:fields.extend({markdown:markdown.optional(),
  category:slug.optional(),document:z.unknown().optional()}).refine(value => Object.keys(value).length>0 && !(value.markdown && value.document!==undefined),
  '바꿀 항목을 입력하고 본문은 Markdown과 문서 중 하나만 지정해 주세요.')});
export const assistantPostListInput = z.object({page:z.coerce.number().int().min(1).max(10_000).default(1),q:z.string().trim().max(100).default(''),
  category:slug.optional(),status:z.enum(['DRAFT','PUBLIC','PRIVATE','ALL']).default('PUBLIC')});
export const candidateCursor = z.object({after:uuid.optional()});
export const reviewInput = z.strictObject({version:z.number().int().positive(),nextReviewAt:z.iso.datetime({offset:true}).optional(),
  sourceUrl:z.url({protocol:/^https$/}).max(2000).refine(value=>!new URL(value).username && !new URL(value).password).nullable().optional()});

export function articleDocument(markdown: string) {
  try { return fromMarkdown(markdown); }
  catch { throw new BadRequestException('Markdown 본문을 변환할 수 없습니다.'); }
}
