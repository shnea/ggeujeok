import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import type { Response } from 'express';
import { Database } from '../src/database/database.js';
import { Sessions } from '../src/auth/sessions.js';
import { config } from '../src/config.js';
import { AdSettings } from '../src/settings/ads.service.js';

if (config.APP_ENV !== 'test' || config.PGDATABASE !== 'ggeujeok_test') throw Error('Settings tests require isolated DB');
const db = new Database(), origin = 'http://127.0.0.1:30106';
const server = spawn(process.execPath, ['dist/main.js'], { env: { ...process.env, PORT: '30106', ADMIN_OIDC_SUBJECT: 'settings-admin' }, stdio: 'ignore' });
after(async () => { server.kill('SIGTERM'); await db.end(); });
async function account(subject: string) {
  const user = (await db.query("INSERT INTO users(issuer,subject,display_name,nickname) VALUES($1,$2,$2,$2) RETURNING id", [config.ADMIN_OIDC_ISSUER, subject])).rows[0];
  let token = '';
  await new Sessions(db).create({ cookie: (_name: string, value: string) => { token = value; } } as Response, user.id);
  const cookie = `ggeujeok_session=${token}`;
  const session = await (await fetch(origin+'/api/auth/session', { headers: { Cookie: cookie } })).json() as any;
  return { id: user.id, headers: { Cookie: cookie, Origin: config.SITE_URL, 'X-CSRF-Token': session.csrfToken, 'Content-Type': 'application/json' } };
}

test('only admins can persist ad switches, public flags update and resetting restores env defaults', async () => {
  for (let i=0;i<50;i++) { try { if ((await fetch(origin+'/api/health')).ok) break; } catch {} await new Promise(resolve=>setTimeout(resolve,100)); }
  const admin = await account('settings-admin'), member = await account('settings-member');
  const emptyAdsense = {clientId:'',postSlot:'',sidebarSlot:'',inlineSlot:''};
  const adsense = {clientId:'ca-pub-1234567890123456',postSlot:'123',sidebarSlot:'456',inlineSlot:'789'};
  const adfit = {post:{unitId:'DAN-post',size:'300x250'},sidebar:{unitId:'DAN-side',size:'160x600'},inline:{unitId:'DAN-inline',size:'728x90'}};
  const emptyFeed = {enabled:false,slot:'',layoutKey:''};
  const base = {provider:'adsense',adsense,adfit};
  const path = '/api/admin/settings/ads';
  const send = (who: typeof admin, method: string, body?: unknown) => fetch(origin+path, { method, headers: who.headers, body: body === undefined ? undefined : JSON.stringify({...base,...body as object}) });
  const publicFlags = async () => (await fetch(origin+'/api/public/settings/ads')).json();
  const adsTxt = () => fetch(origin+'/api/public/settings/ads/ads.txt');
  try {
    assert.equal((await fetch(origin+path)).status,401);
    assert.equal((await send(member,'GET')).status,403);
    assert.equal((await send(member,'PUT',{enabled:true,showPlaceholders:true})).status,403);
    assert.equal((await fetch(origin+path,{method:'PUT',headers:{Cookie:admin.headers.Cookie}})).status,403);
    assert.equal((await send(admin,'PUT',{enabled:'false',showPlaceholders:true})).status,400);
    assert.equal((await send(admin,'PUT',{enabled:false,showPlaceholders:true,client:'extra'})).status,400);
    const initial = await (await send(admin,'GET')).json() as any;
    assert.equal(initial.source,'environment');
    assert.equal((await adsTxt()).status,404,'No seller is invented when the publisher ID is unset');
    assert.deepEqual(await publicFlags(),{provider:'adsense',enabled:false,showPlaceholders:false,adsense:emptyAdsense,adfit:null,feed:emptyFeed});
    assert.equal((await send(admin,'PUT',{enabled:false,showPlaceholders:true})).status,200);
    const seller = await adsTxt();
    assert.equal(seller.status,200);
    assert.match(seller.headers.get('content-type')!,/^text\/plain; charset=utf-8$/);
    assert.equal(seller.headers.get('cache-control'),'no-store');
    assert.equal(await seller.text(),'google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0\n');
    assert.deepEqual(await publicFlags(),{provider:'adsense',enabled:false,showPlaceholders:true,adsense:emptyAdsense,adfit:null,feed:emptyFeed});
    assert.equal((await new AdSettings(db).read()).source,'admin','Settings survive service recreation');
    assert.equal((await send(admin,'PUT',{enabled:true,showPlaceholders:true})).status,200);
    assert.deepEqual(await publicFlags(),{provider:'adsense',enabled:true,showPlaceholders:true,adsense,adfit:null,feed:emptyFeed});
    assert.equal((await send(admin,'PUT',{enabled:true,showPlaceholders:false,adsense:emptyAdsense})).status,400);
    assert.equal((await send(admin,'PUT',{provider:'unknown',enabled:false,showPlaceholders:false})).status,400);
    assert.equal((await send(admin,'PUT',{provider:'adfit',enabled:true,showPlaceholders:false})).status,200);
    assert.deepEqual(await publicFlags(),{provider:'adfit',enabled:true,showPlaceholders:false,adsense:emptyAdsense,adfit,feed:emptyFeed});
    assert.deepEqual((await (await send(admin,'GET')).json() as any).adsense,adsense,'Switch keeps inactive provider credentials');
    assert.equal((await adsTxt()).status,200,'Provider selection does not remove a registered AdSense seller');
    assert.equal((await send(admin,'PUT',{provider:'adfit',enabled:true,showPlaceholders:false,adfit:{...adfit,post:{unitId:'DAN-post',size:'123x45'}}})).status,400);
    assert.equal((await send(admin,'PUT',{provider:'adfit',enabled:true,showPlaceholders:false,adfit:{...adfit,post:{unitId:'<script>',size:'300x250'}}})).status,400);
    const feed = {enabled:true,slot:'987',layoutKey:'-ab+cd_12'};
    assert.equal((await send(admin,'PUT',{enabled:true,showPlaceholders:false,feed:{...feed,layoutKey:''}})).status,400);
    assert.equal((await send(admin,'PUT',{enabled:false,showPlaceholders:true,feed:{...feed,layoutKey:'<script>'}})).status,400);
    assert.equal((await send(admin,'PUT',{enabled:true,showPlaceholders:false,feed})).status,200);
    assert.deepEqual((await publicFlags()).feed,feed);
    assert.deepEqual((await new AdSettings(db).read()).feed,feed,'Feed credentials persist');
    assert.equal((await send(admin,'PUT',{provider:'adfit',enabled:true,showPlaceholders:false})).status,200);
    assert.deepEqual((await publicFlags()).feed,{...emptyFeed,enabled:true},'Inactive feed credentials hidden');
    assert.deepEqual((await (await send(admin,'GET')).json() as any).feed,feed,'Older clients and provider switches preserve feed settings');
    assert.equal((await send(admin,'PUT',{enabled:false,showPlaceholders:true})).status,200);
    assert.deepEqual((await publicFlags()).feed,{...emptyFeed,enabled:true},'Preview exposes no live feed credentials');
    assert.equal((await send(member,'DELETE')).status,403);
    assert.equal((await send(admin,'DELETE')).status,200);
    assert.equal((await adsTxt()).status,404,'Resetting the publisher ID updates ads.txt immediately');
    assert.deepEqual(await publicFlags(),{provider:'adsense',enabled:false,showPlaceholders:false,adsense:emptyAdsense,adfit:null,feed:emptyFeed});
    assert.equal((await (await send(admin,'GET')).json() as any).source,'environment');
    assert.equal((await db.query("SELECT count(*)::int AS count FROM audit_events WHERE actor_id=$1 AND action IN ('ads.update','ads.reset')",[admin.id])).rows[0].count,7);
  } finally {
    await db.query('DELETE FROM ad_settings');
    await db.query('DELETE FROM users WHERE id=ANY($1::uuid[])',[[admin.id,member.id]]);
  }
});

test('site settings require admin and CSRF, validate inputs and retain inactive analytics IDs', async () => {
  const admin = await account('settings-admin'), member = await account('site-member');
  const path = origin+'/api/admin/settings/site';
  const data = {name:'Test Blog',description:'Description & details',imageUrl:'https://example.com/cover.png',operatorName:'Operator',contactEmail:'owner@example.com',
    searchConsoleToken:'google_token-123',naverToken:'naver_123',analyticsMode:'ga4',ga4MeasurementId:'G-ABC1234567',gtmContainerId:'GTM-ABC1234'};
  const put = (value: unknown, headers=admin.headers) => fetch(path,{method:'PUT',headers,body:JSON.stringify(value)});
  const readPublic = async () => (await fetch(origin+'/api/public/settings/site')).json() as Promise<any>;
  try {
    assert.equal((await fetch(path)).status,401);
    assert.equal((await put(data,member.headers)).status,403);
    assert.equal((await fetch(path,{method:'PUT',headers:{Cookie:admin.headers.Cookie}})).status,403);
    for(const change of [{searchConsoleToken:'<meta>'},{naverToken:'" onclick="evil'},{ga4MeasurementId:'G-X<script>'},{gtmContainerId:'bad'},{imageUrl:'javascript:alert(1)'},{imageUrl:'https://user:password@example.com'},{name:''},{contactEmail:'invalid'},{analyticsMode:'both'},{analyticsMode:'ga4',ga4MeasurementId:''}]) {
      assert.equal((await put({...data,...change})).status,400,JSON.stringify(change));
    }
    assert.equal((await put(data)).status,200);
    assert.deepEqual(await readPublic(),{...data,gtmContainerId:''});
    assert.deepEqual(await (await fetch(path,{headers:admin.headers})).json(),data);
    assert.equal((await put({...data,analyticsMode:'gtm'})).status,200);
    assert.deepEqual(await readPublic(),{...data,analyticsMode:'gtm',ga4MeasurementId:''});
    assert.equal((await put({...data,analyticsMode:'off'})).status,200);
    assert.deepEqual(await readPublic(),{...data,analyticsMode:'off',ga4MeasurementId:'',gtmContainerId:''});
    assert.equal((await db.query("SELECT count(*)::int AS count FROM audit_events WHERE actor_id=$1 AND action='site.update'",[admin.id])).rows[0].count,3);
  } finally { await db.query('DELETE FROM site_settings');await db.query('DELETE FROM users WHERE id=ANY($1::uuid[])',[[admin.id,member.id]]); }
});
