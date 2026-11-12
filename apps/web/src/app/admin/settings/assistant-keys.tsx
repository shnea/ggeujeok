'use client';

import { useEffect, useState } from 'react';
import { api, mutation } from '@/lib/api';

type Key = {id:string;name:string;canWrite:boolean;canPublish:boolean;canDelete:boolean;expiresAt:string};
const path = '/api/admin/settings/assistant-keys';
const formatDate = new Intl.DateTimeFormat('ko-KR',{dateStyle:'medium',timeZone:'Asia/Seoul'});

export function AssistantKeys({csrf}:{csrf:string}) {
  const [keys,setKeys] = useState<Key[] | null>(null);
  const [name,setName] = useState(''), [canPublish,setPublish] = useState(false), [canDelete,setDelete] = useState(false);
  const [canWrite,setWrite] = useState(true);
  const [busy,setBusy] = useState(false), [error,setError] = useState(''), [token,setToken] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    api<Key[]>(path,{signal:controller.signal}).then(setKeys).catch(error=>{
      if (!controller.signal.aborted) setError(error.message);
    });
    return () => controller.abort();
  },[csrf]);

  async function issue() {
    setBusy(true); setToken(''); setError('');
    try {
      const result = await api<{key:Key;token:string}>(path,mutation('POST',csrf,{name,canWrite,canPublish,canDelete}));
      setKeys(current=>[result.key,...(current??[])]); setToken(result.token); setName(''); setWrite(true); setPublish(false); setDelete(false);
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }

  async function revoke(key:Key) {
    if (!window.confirm(`‘${key.name}’ 키를 폐기할까요? 이 키의 연결이 끊깁니다.`)) return;
    setBusy(true); setToken(''); setError('');
    try {
      await api(`${path}/${key.id}`,mutation('DELETE',csrf));
      setKeys(current=>current?.filter(item=>item.id!==key.id)??[]);
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }

  return <section id="assistant-keys" className="ad-settings">
    <h2>AI 도우미 MCP 연결</h2>
    <p className="field-help">키는 90일 뒤 만료됩니다. 조회 외에 허용할 작업을 선택하세요.</p>
    <form onSubmit={event=>{event.preventDefault(); void issue();}}>
      <fieldset disabled={busy || keys===null}>
        <legend>연결 키 발급</legend>
        <label htmlFor="assistant-key-name">연결 이름</label>
        <input id="assistant-key-name" value={name} onChange={event=>setName(event.target.value)} maxLength={60} required placeholder="예: 블로그 정기 점검" />
        <label className="setting-toggle"><span>글·댓글·카테고리 작성 및 글·카테고리 수정 허용</span><input type="checkbox" checked={canWrite} onChange={event=>setWrite(event.target.checked)} /></label>
        <label className="setting-toggle"><span>글 공개·비공개 전환 허용</span><input type="checkbox" checked={canPublish} onChange={event=>setPublish(event.target.checked)} /></label>
        <label className="setting-toggle"><span>글·댓글·카테고리 삭제 허용</span><input type="checkbox" checked={canDelete} onChange={event=>setDelete(event.target.checked)} /></label>
        <button type="submit" disabled={!name.trim()}>키 발급</button>
      </fieldset>
    </form>
    {token && <div><label htmlFor="assistant-issued-key">발급한 키 (이 화면에서 한 번 표시)</label>
      <input id="assistant-issued-key" readOnly autoComplete="off" spellCheck={false} value={token} onFocus={event=>event.target.select()} />
      <p className="field-help">키를 MCP 실행 환경의 <code>GGEUJEOK_MCP_TOKEN</code>에 넣으세요.</p></div>}
    {keys?.length===0 && <p className="field-help">발급된 키가 없습니다.</p>}
    {keys && keys.length>0 && <ul>{keys.map(key=><li key={key.id}>
      <strong>{key.name}</strong> · 조회{key.canWrite?'·작성':''}{key.canPublish?'·공개':''}{key.canDelete?'·삭제':''} · {formatDate.format(new Date(key.expiresAt))} 만료
      {' '}<button type="button" className="text-button danger" disabled={busy} onClick={()=>void revoke(key)}>폐기</button>
    </li>)}</ul>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
