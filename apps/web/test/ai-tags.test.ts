import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mergeAiTags} from '../src/app/admin/posts/[id]/ai-tags';

test('background AI delivery preserves local manual tags and replaces only preceding AI tags',()=>{
  assert.deepEqual(mergeAiTags(['직접 추가','이전 AI'],['이전 AI'],['새 AI','직접 추가']),['직접 추가','새 AI']);
  assert.deepEqual(mergeAiTags(['직접 추가'],['삭제한 AI'],['삭제한 AI']),['직접 추가'],
    'an unrelated summary delivery does not undo a local tag deletion');
});
