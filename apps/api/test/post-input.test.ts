import { platformNickname } from '../src/auth/platform-profile.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyDocument } from '@shnea/editor';
import { initialPost, plainText, validatePost } from '../src/posts/post-input.js';
import { safeReturnPath } from '../src/auth/auth.controller.js';

test('validates editor v3 and extracts Korean block text without merging paragraphs', () => {
  const data = initialPost('test');
  data.content.content = { type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text: '한글 ' }, { type: 'text', text: '문장', marks: [{ type: 'bold' }] }] },
    { type: 'paragraph', content: [{ type: 'text', text: '다음 문단' }] },
  ] };
  assert.equal(plainText(validatePost(data).content), '한글 문장\n다음 문단');
});

test('normalizes duplicate tags and rejects invalid slugs, oversized content and legacy documents', () => {
  const data = { ...initialPost('test'), tags: [' React ', 'react', '한글'] };
  assert.equal(validatePost(data).tags.length, 2);
  assert.throws(() => validatePost({ ...data, slug: '../admin' }));
  assert.throws(() => validatePost({ ...data, content: { ...emptyDocument(), version: 2 } }));
  assert.throws(() => validatePost({ ...data, content: { ...emptyDocument(), huge: 'x'.repeat(2 * 1024 * 1024) } }));
  assert.equal(validatePost({ ...data, adsEnabled: undefined }).adsEnabled, true, 'Older inputs retain the default');
  assert.equal(validatePost({ ...data, adsEnabled: false }).adsEnabled, false);
  assert.throws(() => validatePost({ ...data, adsEnabled: 'false' }));
});

test('return paths cannot send an authenticated browser to another origin', () => {
  for (const path of ['//evil.example', '/\\evil.example', 'https://evil.example', '/\n/evil.example', null]) assert.equal(safeReturnPath(path), '/');
  assert.equal(safeReturnPath('/posts/my-post?from=login'), '/posts/my-post?from=login');
});

test('only the platform given_name supplies the public nickname', () => {
  assert.equal(platformNickname({ given_name: '  플랫폼 닉네임  ' }), '플랫폼 닉네임');
  assert.equal(platformNickname({ given_name: '가' }), '가');
  assert.equal(platformNickname({ given_name: '   ' }), null);
  assert.equal(platformNickname({ given_name: 123 }), null);
  assert.equal(platformNickname({ name: 'PRIVATE NAME', email: 'private@example.com' } as {}), null);
});
