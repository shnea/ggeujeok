import assert from 'node:assert/strict';
import { documentImages } from '../src/lib/document-images';
import type { EditorDocument } from '@shnea/editor';

const attachment = (fileId: string, kind = 'image') => ({ type: 'attachment', attrs: { fileId, kind, name: `${fileId}.png` } });
const document: EditorDocument = { format: 'shnea-editor', version: 3, content: { type: 'doc', content: [
  attachment('', 'image'), attachment('not-image', 'file'),
  { type: 'mediaRow', content: [attachment('first'), attachment('second')] }, attachment('first'),
] } };
const before = JSON.stringify(document);
assert.deepEqual(documentImages(document).map(image => image.fileId), ['first', 'second']);
assert.equal(JSON.stringify(document), before);
