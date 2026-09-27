import type { EditorDocument } from '@shnea/editor';

function textLength(node: EditorDocument['content']): number {
  return (node.text?.length || 0) + (node.content || []).reduce((sum, child) => sum + textLength(child), 0);
}

// Split only between whole top-level blocks. Lists, tables and media stay intact.
export function articleSections(document: EditorDocument): EditorDocument[] {
  const blocks = document.content.content || [];
  const total = blocks.reduce((sum, block) => sum + textLength(block), 0);
  const sections: EditorDocument[] = [];
  let start = 0, sectionLength = 0, consumed = 0;
  blocks.forEach((block, index) => {
    const length = textLength(block);
    sectionLength += length; consumed += length;
    const next = blocks[index + 1];
    if (sections.length < 2 && sectionLength >= 3000 && index - start >= 5 && total - consumed >= 1200
      && block.type === 'paragraph' && next && !['horizontalRule', 'mediaRow', 'attachment'].includes(next.type || '')) {
      sections.push({ ...document, content: { ...document.content, content: blocks.slice(start, index + 1) } });
      start = index + 1; sectionLength = 0;
    }
  });
  sections.push({ ...document, content: { ...document.content, content: blocks.slice(start) } });
  return sections;
}
