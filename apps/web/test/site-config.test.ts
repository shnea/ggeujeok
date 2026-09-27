import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicAnalyticsPath } from '../src/lib/site-config';
test('analytics runs only on public content routes, never account or editor screens', () => {
  for(const path of ['/', '/posts/hello', '/about', '/privacy', '/copyright']) assert.equal(publicAnalyticsPath(path),true,path);
  for(const path of ['/admin','/admin/posts/id','/login','/me','/me/settings','/api/auth/callback','/posts/id/edit']) assert.equal(publicAnalyticsPath(path),false,path);
});
