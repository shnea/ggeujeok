import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import type { Sessions } from '../src/auth/sessions.js';
import type { Visits } from '../src/statistics/visits.service.js';
import { PublicVisitsController, safeReferrer, visitEligible, visitorToken } from '../src/statistics/visits.controller.js';
import { visitDay } from '../src/statistics/visits.service.js';
import { siteOrigin } from '../src/config.js';

const request = (headers: Record<string, string> = {}) => {
  const all = { origin: siteOrigin, 'user-agent': 'Mozilla/5.0', ...headers };
  return { headers: all, header: (name: string) => all[name as keyof typeof all] } as Request;
};
test('statistics exclude bots, prefetch, cross-origin, privacy opt-outs and raw referrer details', () => {
  assert.equal(visitEligible(request()), true);
  for (const headers of [{ origin: 'https://other.example' }, { 'user-agent': 'Googlebot' }, { purpose: 'prefetch' }, { 'sec-purpose': 'prefetch;prerender' }, { dnt: '1' }, { 'sec-gpc': '1' }]) {
    assert.equal(visitEligible(request(headers)), false);
  }
  for (const host of ['127.0.0.1', 'https://example.com/?secret=x', 'u:p@example.com', new URL(siteOrigin).hostname, '::1']) assert.equal(safeReferrer(host), '');
  assert.equal(safeReferrer('Search.Example.com'), 'search.example.com');
  assert.equal(visitorToken(request({ cookie: `ggeujeok_visit=2000-01-01.${'a'.repeat(43)}` })), null);
});
test('statistics require a returned cookie and exclude administrator before issuing or recording', async () => {
  let admin = false, writes = 0, issued = 0;
  const visits = { record: async () => { writes++; } } as unknown as Visits;
  const sessions = { read: async () => ({ isAdmin: admin }) } as unknown as Sessions;
  const controller = new PublicVisitsController(visits, sessions);
  const response = { cookie: (_name: string, _value: string, options: Record<string, unknown>) => {
    issued++; assert.equal(options.httpOnly, true); assert.equal(options.secure, true); assert.equal(options.maxAge, 86400000);
  } } as Response;
  const input = { postId: 'b00d0344-ab54-4562-93e2-252610af9451', referrerHost: 'example.com' };
  await controller.visitor(request(), response); assert.equal(issued, 1);
  await controller.record(request(), input); assert.equal(writes, 0);
  const cookie = `ggeujeok_visit=${visitDay()}.${'a'.repeat(43)}`;
  await controller.record(request({ cookie }), input); assert.equal(writes, 1);
  admin = true;
  await controller.visitor(request(), response); assert.equal(issued, 1);
  await controller.record(request({ cookie }), input); assert.equal(writes, 1);
});
