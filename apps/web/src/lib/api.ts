import type { EditorDocument } from '@shnea/editor';

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, cache: 'no-store' });
  if (!response.ok) {
    const problem = await response.json().catch(() => null);
    throw new ApiError(problem?.detail || '연결하지 못했습니다. 잠시 후 다시 시도해 주세요.', response.status);
  }
  return response.json();
}

export type Session = { configured: boolean; user: { id: string; name: string; nickname?: string | null; isAdmin: boolean } | null; csrfToken: string | null };
export type Category = { id: string; name: string; slug: string; sortOrder: number };
export type PublicPost = { id: string; slug: string; title: string; summary: string; publishedAt: string; updatedAt: string;
  categoryName: string; categorySlug: string; thumbnailId: string | null; tags: { name: string; slug: string }[]; content?: EditorDocument };
export type PostList = { items: PublicPost[]; total: number; page: number };
export function mutation(method: string, csrf: string, body?: unknown): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: body === undefined ? undefined : JSON.stringify(body) };
}
