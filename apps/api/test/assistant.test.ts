import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assistantInput, emptyAssistant, isMention, parseResult, systemPrompt } from '../src/ai/assistant.js';
import { inputHash } from '../src/ai/ai.service.js';

test('configured mention matches a complete keyword, not a nickname substring or email',()=>{
  for(const text of ['@루미 안녕','궁금해. @루미!','(@루미) 이건?'])assert.equal(isMention(text,'@루미'),true);
  for(const text of ['루미 안녕','@루미봇 안녕','abc@루미','@',''])assert.equal(isMention(text,'@루미'),false);
  assert.equal(isMention('@other hi','@other'),true);
  assert.throws(()=>assistantInput.parse({...emptyAssistant,mentionsEnabled:true}));
});
test('cache hashes survive JSONB key ordering and ignore only style examples',()=>{
  assert.equal(inputHash({article:{title:'a',text:'b'},date:new Date('2026-01-01')}),inputHash({date:'2026-01-01T00:00:00.000Z',article:{text:'b',title:'a'}}));
  assert.equal(inputHash({memory:[],recentResponses:['a']}),inputHash({recentResponses:['b'],memory:[]}));
  assert.notEqual(inputHash({memory:['a']}),inputHash({memory:['b']}));
});
test('AI results are bounded and prompts keep character, facts and disclosure separate',()=>{
  assert.throws(()=>parseResult('summary',{summary:'x'.repeat(501)}));
  assert.throws(()=>parseResult('tags',{tags:['x'],publish:true}));
  assert.deepEqual(parseResult('comment',{comment:null}),{comment:null});
  const prompt=systemPrompt({...emptyAssistant,name:'루미',personality:'작은 요정',tone:'짧은 반말'},'comment');
  assert.ok(prompt.includes('작은 요정')&&prompt.includes('짧은 반말')&&prompt.includes('recentResponses')&&prompt.includes('AI 캐릭터'));
});
