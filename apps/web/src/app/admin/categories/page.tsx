'use client';

import { Save, Plus, X, RefreshCw, Pencil, Trash2, LogIn } from 'lucide-react';


import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, mutation, type Category, type Session } from '@/lib/api';
import styles from './page.module.css';

type CategoryRow = Category & { postCount: number };
type Fields = { name: string; slug: string; sortOrder: string };
const empty: Fields = { name: '', slug: '', sortOrder: '0' };

export default function CategoriesPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [rows, setRows] = useState<CategoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [editing, setEditing] = useState<CategoryRow | null>(null);
  const [fields, setFields] = useState<Fields>(empty);
  const nameInput = useRef<HTMLInputElement>(null);
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      const session = await api<Session>('/api/auth/session', { signal: controller.signal });
      setSession(session);
      if (session.user?.isAdmin) setRows(await api<CategoryRow[]>('/api/admin/categories', { signal: controller.signal }));
    }
    load().catch(error => { if (!controller.signal.aborted) setError(error.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  const initial = editing ? { name: editing.name, slug: editing.slug, sortOrder: String(editing.sortOrder) } : empty;
  const dirty = fields.name !== initial.name || fields.slug !== initial.slug || fields.sortOrder !== initial.sortOrder;

  function choose(row: CategoryRow | null) {
    if (dirty && !window.confirm('입력한 변경 사항을 취소할까요?')) return;
    setEditing(row);
    setFields(row ? { name: row.name, slug: row.slug, sortOrder: String(row.sortOrder) } : empty);
    setError(''); setMessage('');
    form.current?.scrollIntoView({ block: 'center' });
    nameInput.current?.focus({ preventScroll: true });
  }

  async function refresh() {
    setPending(true); setError('');
    try { setRows(await api<CategoryRow[]>('/api/admin/categories')); }
    catch (error) { setError((error as Error).message); }
    finally { setPending(false); }
  }

  async function change(path: string, method: string, data: unknown, success: string) {
    setPending(true); setError(''); setMessage('');
    try {
      await api(path, mutation(method, session!.csrfToken!, data));
      setEditing(null); setFields(empty); setMessage(success);
      try { setRows(await api<CategoryRow[]>('/api/admin/categories')); }
      catch { setError('변경은 저장됐지만 목록을 불러오지 못했습니다. 목록 새로고침을 눌러 주세요.'); }
    } catch (error) { setError((error as Error).message); }
    finally { setPending(false); }
  }

  function save(event: FormEvent) {
    event.preventDefault();
    void change(`/api/admin/categories${editing ? `/${editing.id}` : ''}`, editing ? 'PUT' : 'POST',
      { name: fields.name, slug: fields.slug, sortOrder: Number(fields.sortOrder) }, editing ? '카테고리를 수정했습니다.' : '카테고리를 추가했습니다.');
  }

  function remove(row: CategoryRow) {
    if (dirty && !window.confirm('입력 중인 변경 사항을 취소하고 삭제를 진행할까요?')) return;
    if (!window.confirm(`‘${row.name}’ 카테고리를 삭제할까요?`)) return;
    void change(`/api/admin/categories/${row.id}`, 'DELETE', undefined, '카테고리를 삭제했습니다.');
  }

  if (loading) return <p className="loading" role="status">카테고리를 불러오는 중…</p>;
  if (!session?.user?.isAdmin) return <section className="message-page"><h1>카테고리 관리</h1>
    <p>관리자 계정으로 로그인해 주세요.</p>{error && <p role="alert">{error}</p>}<a className="button" href="/login"><LogIn aria-hidden="true" />로그인 화면으로</a></section>;

  return <section className="admin-page">
    <nav className="admin-nav" aria-label="관리 메뉴"><a href="/admin">글 관리</a><a href="/admin/categories" aria-current="page">카테고리</a><a href="/admin/statistics">방문 통계</a><a href="/admin/settings">설정</a></nav>
    <div className="page-heading"><div><h1>카테고리 관리</h1><p>글을 묶는 이름과 표시 순서를 관리합니다.</p></div></div>
    <form ref={form} className={styles.form} onSubmit={save} aria-labelledby="category-form-title">
      <h2 id="category-form-title">{editing ? '카테고리 수정' : '카테고리 추가'}</h2>
      <fieldset disabled={pending}>
        <legend className="sr-only">카테고리 정보</legend>
        <div className={styles.fields}>
          <label htmlFor="category-name">이름<input ref={nameInput} id="category-name" required maxLength={80} value={fields.name}
            onChange={event => setFields({ ...fields, name: event.target.value })} /></label>
          <div><label htmlFor="category-slug">분류 주소</label><input id="category-slug" required maxLength={120} pattern="[a-z0-9]+(-[a-z0-9]+)*" autoCapitalize="none" spellCheck={false}
            aria-describedby="category-slug-help" value={fields.slug} onChange={event => setFields({ ...fields, slug: event.target.value })} />
            <span id="category-slug-help" className={styles.help}>영문 소문자·숫자·하이픈. 변경하면 기존 분류 링크도 달라집니다.</span></div>
          <div><label htmlFor="category-order">표시 순서</label><input id="category-order" required type="number" min={0} max={10000} step={1} inputMode="numeric"
            aria-describedby="category-order-help" value={fields.sortOrder} onChange={event => setFields({ ...fields, sortOrder: event.target.value })} />
            <span id="category-order-help" className={styles.help}>작은 숫자가 먼저 표시됩니다.</span></div>
        </div>
        <div className="button-row"><button type="submit">{editing ? <Save aria-hidden="true" /> : <Plus aria-hidden="true" />}{pending ? '처리 중…' : editing ? '변경 저장' : '카테고리 추가'}</button>
          {editing && <button className="secondary" type="button" onClick={() => choose(null)}><X aria-hidden="true" />수정 취소</button>}</div>
      </fieldset>
    </form>
    <p className={styles.feedback} role="status">{message}</p>
    {error && <p className="notice error" role="alert">{error}</p>}
    <div className={styles.listHeading}><h2>카테고리 <span>{rows.length}</span></h2><button className="secondary" disabled={pending} onClick={refresh}><RefreshCw aria-hidden="true" />목록 새로고침</button></div>
    <p className={styles.help}>글이나 편집본에서 사용 중이면 삭제할 수 없습니다. 해당 글의 분류를 먼저 변경해 주세요.</p>
    {!rows.length ? <div className="empty-state"><p>카테고리를 추가하면 글을 분류해 공개할 수 있습니다.</p></div>
      : <ul className={styles.list} aria-label="카테고리 목록">{rows.map(row => <li key={row.id}>
        <div className={styles.description}><h3>{row.name}</h3><a href={`/?category=${encodeURIComponent(row.slug)}`}>/{row.slug}</a>
          <p>표시 순서 {row.sortOrder} <span aria-hidden="true">·</span> 사용 중인 글 {row.postCount}개</p></div>
        <div className={styles.actions}><button className="secondary" disabled={pending} aria-label={`${row.name} 수정`} onClick={() => choose(row)}><Pencil aria-hidden="true" />수정</button>
          <button className="secondary" disabled={pending || row.postCount > 0} aria-label={`${row.name} 삭제`} onClick={() => remove(row)}><Trash2 aria-hidden="true" />삭제</button></div>
      </li>)}</ul>}
  </section>;
}
