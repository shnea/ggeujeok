import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAdSettings, hiddenAds, emptyAdfit, type AdSettingsInput } from '../src/lib/ads-config';

const adsense = { clientId: 'ca-pub-1234567890123456', postSlot: '123', sidebarSlot: '456', inlineSlot: '789' };
const adfit = { post: {unitId:'DAN-post',size:'300x250' as const}, sidebar:{unitId:'DAN-side',size:'160x600' as const}, inline:{unitId:'DAN-inline',size:'728x90' as const} };

test('a post can suppress every placement, including placeholders, without overriding the site switch', () => {
  for (const provider of ['adsense', 'adfit'] as const) {
    for (const enabled of [true, false]) {
      const settings: AdSettingsInput = { ...hiddenAds, provider, enabled, showPlaceholders: true, adsense, adfit,
        feed: { enabled: true, slot: '987', layoutKey: '-ab+cd_12' } };
      assert.deepEqual(resolveAdSettings(settings, false), { enabled: false, provider, feed: null, post: null, sidebar: null, inline: null });
      assert.ok(resolveAdSettings(settings, true).post, 'Other posts retain the site setting');
    }
  }
  assert.equal(resolveAdSettings(hiddenAds, true).post, null, 'A post cannot enable globally disabled ads');
});
test('hidden and placeholder modes never return live ad units', () => {
  assert.deepEqual(resolveAdSettings(hiddenAds), {enabled:false,provider:'adsense',post:null,sidebar:null,inline:null,feed:null});
  const preview = resolveAdSettings({...hiddenAds,showPlaceholders:true});
  assert.equal(preview.enabled,false);
  for(const placement of [preview.post,preview.sidebar,preview.inline]) assert.deepEqual(placement,{kind:'placeholder'});
  assert.equal(resolveAdSettings({...hiddenAds,enabled:true,showPlaceholders:true}).post,null,'Invalid live credentials never become placeholders');
});

test('in-feed ads require opt-in and issued layout keys, and follow global/provider switches', () => {
  const feed = { enabled: true, slot: '987', layoutKey: '-ab+cd_12' };
  const settings: AdSettingsInput = { ...hiddenAds, enabled: true, adsense, feed };
  assert.deepEqual(resolveAdSettings(settings).feed, { kind: 'adsense', client: adsense.clientId, slot: '987', layoutKey: feed.layoutKey });
  assert.equal(resolveAdSettings({ ...settings, feed: { ...feed, enabled: false } }).feed, null);
  assert.equal(resolveAdSettings({ ...settings, feed: { ...feed, layoutKey: '' } }).feed, null);
  assert.equal(resolveAdSettings({ ...settings, feed: { ...feed, layoutKey: '<script>' } }).feed, null);
  assert.equal(resolveAdSettings({ ...settings, enabled: false }).feed, null);
  assert.deepEqual(resolveAdSettings({ ...settings, enabled: false, showPlaceholders: true }).feed, { kind: 'placeholder' });
  assert.equal(resolveAdSettings({ ...settings, provider: 'adfit', adfit }).feed, null);
});
test('AdSense and AdFit use only the selected service and configured positions', () => {
  const settings: AdSettingsInput = {...hiddenAds,enabled:true,adsense,adfit};
  assert.deepEqual(resolveAdSettings(settings).post,{kind:'adsense',client:adsense.clientId,slot:'123'});
  assert.deepEqual(resolveAdSettings({...settings,provider:'adfit'}).post,{kind:'adfit',unitId:'DAN-post',width:300,height:250});
  assert.deepEqual(resolveAdSettings({...settings,provider:'adfit'}).sidebar,{kind:'adfit',unitId:'DAN-side',width:160,height:600});
  assert.equal(resolveAdSettings({...settings,adsense:{...adsense,sidebarSlot:''}}).sidebar,null);
  assert.equal(resolveAdSettings({...settings,provider:'adfit',adfit:emptyAdfit}).post,null);
  const oneUnit = resolveAdSettings({...settings,provider:'adfit',adfit:{...emptyAdfit,post:adfit.post}});
  assert.ok(oneUnit.post);assert.equal(oneUnit.sidebar,null);assert.equal(oneUnit.inline,null);
  assert.equal(resolveAdSettings({...settings,provider:'unknown' as 'adfit'}).post,null);
});
