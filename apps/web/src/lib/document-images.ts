import type { EditorDocument } from '@shnea/editor';

export function documentImages(document: EditorDocument) {
  const images = new Map<string, { fileId: string; name: string }>();
  function visit(node: EditorDocument['content']) {
    const attrs = node.attrs;
    if (node.type === 'attachment' && attrs?.kind === 'image' && typeof attrs.fileId === 'string' && attrs.fileId) {
      if (!images.has(attrs.fileId)) images.set(attrs.fileId, { fileId: attrs.fileId, name: typeof attrs.name === 'string' ? attrs.name : '본문 이미지' });
    }
    node.content?.forEach(visit);
  }
  visit(document.content);
  return [...images.values()];
}
