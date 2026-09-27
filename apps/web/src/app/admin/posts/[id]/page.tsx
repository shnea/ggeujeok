'use client';

import { Eye, Pencil, Globe, Save, Download, LockKeyhole, Trash2, Bot } from 'lucide-react';

import { use, useEffect, useMemo, useState } from 'react';
import { ShneaEditor } from '@shnea/editor/react';
import { DocumentViewer } from '@/components/document-viewer';
import { api, mutation, type Category, type Session } from '@/lib/api';
import { useDraft, type Draft } from './use-draft';
import { editorAttachments } from '@/lib/attachments';
import { CoverPicker } from './cover-picker';
import { documentImages } from '@/lib/document-images';
import { PostImage } from '@/components/post-image';
import { TagInput } from './tag-input';

export default function EditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [loaded, setLoaded] = useState<{ draft: Draft; csrf: string; categories: Category[] } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    async function load() {
      const session = await api<Session>('/api/auth/session');
      if (!session.user?.isAdmin) throw new Error('관리자 로그인이 필요합니다.');
      const [draft, categories] = await Promise.all([api<Draft>(`/api/admin/posts/${id}`), api<Category[]>('/api/public/categories')]);
      if (active) setLoaded({ draft, categories, csrf: session.csrfToken! });
    }
    load().catch(error => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [id]);
  if (error) return <section className="message-page"><h1>편집 화면을 열 수 없어요.</h1><p role="alert">{error}</p><a href="/login">로그인 화면으로</a></section>;
  if (!loaded) return <p className="loading" role="status">편집본을 불러오는 중…</p>;
  return <Editor key={id} initial={loaded.draft} csrf={loaded.csrf} categories={loaded.categories} />;
}

function Editor({ initial, csrf, categories }: { initial: Draft; csrf: string; categories: Category[] }) {
  const { draft, change, save, publish, status, error, pending, allowExit } = useDraft(initial, csrf);
  const [preview, setPreview] = useState(false);
  const [editorError, setEditorError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [coverUploading, setCoverUploading] = useState(false);
  const [aiBusy,setAiBusy]=useState(false),[aiMessage,setAiMessage]=useState('');
  const { data } = draft;
  const attachments = useMemo(() => editorAttachments(draft.id, csrf), [draft.id, csrf]);
  const blocked = pending || deleting;
  async function requestSummary(){
    setAiBusy(true);setAiMessage('');
    try{await save();const result=await api<{state:string}>(`/api/admin/ai/posts/${draft.id}/summary`,mutation('POST',csrf));
      setAiMessage(result.state==='SUCCEEDED'?'현재 공개본의 AI 요약이 있습니다. 다시 열면 확인할 수 있습니다.':'요약을 요청했습니다. 설정 → AI 도우미에서 처리 상태를 확인할 수 있습니다.');}
    catch(error){setAiMessage((error as Error).message);}finally{setAiBusy(false);}
  }
  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${data.slug || 'draft'}.json`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function remove() {
    if (!window.confirm('이 글과 편집본을 삭제할까요? 삭제한 글은 복구할 수 없습니다.')) return;
    setDeleting(true);
    try { await api(`/api/admin/posts/${draft.id}`, mutation('DELETE', csrf)); allowExit(); window.location.assign('/admin'); }
    catch (error) { setEditorError((error as Error).message); setDeleting(false); }
  }
  return <div className="editor-page"><div className="editor-actions"><a className="back-link" href="/admin">글 목록</a>
    <span className="save-status" role="status">{status}</span><button className="secondary" disabled={coverUploading} aria-pressed={preview} onClick={() => setPreview(!preview)}>{preview ? <Pencil aria-hidden="true" /> : <Eye aria-hidden="true" />}{preview ? '편집으로' : '미리보기'}</button>
    <button disabled={blocked || coverUploading} onClick={() => publish('PUBLIC')}><Globe aria-hidden="true" />{pending ? '반영 중…' : draft.status === 'PUBLIC' ? '공개본에 반영' : '공개하기'}</button></div>
    {(error || editorError) && <div className="notice error" role="alert"><p>{error || editorError}</p><div className="button-row">
      <button className="secondary" disabled={blocked} onClick={() => { setEditorError(''); void save().catch(() => {}); }}><Save aria-hidden="true" />다시 저장</button>
      <button className="secondary" onClick={download}><Download aria-hidden="true" />편집본 내려받기</button></div></div>}
    {preview ? <article className="draft-preview"><h1>{data.title}</h1><p className="article-summary">{data.summary}</p>
      {data.thumbnailId && !documentImages(data.content).some(image => image.fileId === data.thumbnailId) && <PostImage src={`/api/files/${data.thumbnailId}/content/preview`} alt={`${data.title} 대표 이미지`} className="article-cover" eager />}
      <DocumentViewer content={data.content} /></article>
      : <div className="editor-grid"><section className="writing-area" aria-label="글 편집"><label className="sr-only" htmlFor="post-title">글 제목</label>
        <input id="post-title" className="title-input" value={data.title} maxLength={200} disabled={blocked} onChange={event => change({ title: event.target.value })} placeholder="제목을 입력하세요" />
        <ShneaEditor value={data.content} documentKey={draft.id} editable={!blocked} label="글 본문" attachments={attachments}
          onChange={event => { if (event.origin === 'edit') change({ content: event.document }); }} onError={() => setEditorError('편집기를 처리하지 못했습니다. 편집본을 내려받아 보관한 뒤 다시 열어 주세요.')} />
        <p className="field-help">변경 후 3초 뒤 편집본을 저장합니다. 공개본은 ‘공개본에 반영’을 눌러야 바뀝니다.</p>
      </section><aside className="post-settings"><h2>글 설정</h2><fieldset disabled={blocked}><legend className="sr-only">글 설정</legend>
        <label htmlFor="category">카테고리</label><select id="category" value={data.categoryId || ''} onChange={event => change({ categoryId: event.target.value || null })}>
          <option value="">카테고리 선택</option>{categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
        </select><label htmlFor="post-slug">글 주소</label><input id="post-slug" value={data.slug} maxLength={120} disabled={Boolean(draft.publishedAt)} onChange={event => change({ slug: event.target.value })} />
        <p className="field-help">영문 소문자·숫자·하이픈. 첫 공개 후에는 바꿀 수 없습니다.</p>
        {draft.aiGenerated&&<p className="field-help">{draft.aiIdentity?.name||'도우미'}가 작성한 AI 초안입니다. 수정·공개 후에도 AI 작성 표시를 유지합니다.</p>}<label htmlFor="summary">요약 <span className="optional">선택</span></label><textarea id="summary" rows={5} value={data.summary} maxLength={500} onChange={event => change({ summary: event.target.value })} placeholder="이 글을 짧게 소개해 주세요" />
        <p className="field-help">직접 쓴 요약을 우선합니다. 비워 두면 AI 요약 설정에 따라 생성하며, 생성 전에는 본문 앞부분을 표시합니다.</p>
        {draft.aiSummary&&!data.summary&&<p className="field-help"><span className="ai-badge">AI 요약</span> {draft.aiSummary}</p>}{draft.status==='PUBLIC'&&!data.summary&&<button type="button" className="secondary" disabled={blocked||aiBusy} onClick={()=>void requestSummary()}><Bot aria-hidden="true" />{aiBusy?'요청 중…':'공개본 AI 요약 요청'}</button>}{aiMessage&&<p className="field-help" role="status">{aiMessage}</p>}<CoverPicker content={data.content} value={data.thumbnailId || null} attachments={attachments} disabled={blocked}
          onChange={thumbnailId => change({ thumbnailId })} onBusy={setCoverUploading} />
        <TagInput value={data.tags} disabled={blocked} onChange={tags => change({ tags })} />
        <label className="setting-toggle"><span><strong>댓글 허용</strong><small>끄면 새 댓글·답글을 받지 않습니다. 기존 댓글은 남습니다.</small></span>
          <input type="checkbox" role="switch" checked={data.commentsEnabled ?? true} onChange={event => change({ commentsEnabled: event.target.checked })} /></label>
      </fieldset><div className="settings-bottom"><p className="field-help">이미지: JPEG·PNG·WebP·GIF, 파일당 최대 20MiB.</p><button className="secondary" disabled={blocked || coverUploading} onClick={() => publish('PRIVATE')}><LockKeyhole aria-hidden="true" />비공개로 저장</button>
        <button className="text-button danger" disabled={blocked || coverUploading} onClick={remove}><Trash2 aria-hidden="true" />글 삭제</button></div></aside></div>}
  </div>;
}
