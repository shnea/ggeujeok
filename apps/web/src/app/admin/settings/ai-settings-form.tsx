'use client';

import { useEffect, useState } from 'react';
import { Bot, Save, Plus, Trash2, RefreshCw, FilePenLine, ImagePlus, Clock3 } from 'lucide-react';
import { api, mutation, type Session } from '@/lib/api';

type Assistant = {
  name:string; personality:string; tone:string; images:{id:string;label:string;url:string}[]; avatarId:string|null;
  summaryEnabled:boolean; tagsEnabled:boolean; commentsEnabled:boolean; commentIntervalMinutes:number;
  rememberMembers:boolean; memoryDays:number; familiarity:'reserved'|'natural'|'friendly';
  mentionsEnabled:boolean; mentionKeyword:string;
};
type Settings={data:Assistant;revision:number;connected:boolean};
type Task={id:string;kind:string;state:string;errorCode:string|null;createdAt:string;postId:string|null;title:string|null};
const kinds:Record<string,string>={summary:'요약',tags:'태그',comment:'자동 답글',article:'글 초안'};
const states:Record<string,string>={PENDING:'접수 중',QUEUED:'대기',RUNNING:'생성 중',SUCCEEDED:'완료',SKIPPED:'건너뜀',FAILED:'확인 필요'};
const reasons:Record<string,string>={GENERATION_FAILED:'AI 생성 또는 결과 형식 확인에 실패했습니다. 설정을 확인한 뒤 재시도할 수 있습니다.',CONTEXT_CHANGED:'내용이나 설정이 바뀌어 반영하지 않았습니다.',EXECUTION_UNCONFIRMED:'플랫폼 작업 상태를 확인하지 못했습니다. 재시도하면 같은 작업 ID로 결과를 다시 조회합니다.',CONNECTION_FAILED:'연결에 실패했습니다. 재시도할 수 있습니다.'};

export function AiSettingsForm({session}:{session:Session}) {
  const [saved,setSaved]=useState<Settings|null>(null),[value,setValue]=useState<Assistant|null>(null);
  const [tasks,setTasks]=useState<Task[]>([]),[error,setError]=useState(''),[message,setMessage]=useState('');
  const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[reload,setReload]=useState(0);
  const [topic,setTopic]=useState(''),[articleId,setArticleId]=useState<string|null>(null);
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);
    Promise.all([api<Settings>('/api/admin/ai/settings',{signal:controller.signal}),api<Task[]>('/api/admin/ai/tasks',{signal:controller.signal})])
      .then(([settings,tasks])=>{if(!controller.signal.aborted){setSaved(settings);setValue(settings.data);setTasks(tasks);setError('');}})
      .catch(error=>{if(!controller.signal.aborted)setError(error.message);})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[reload]);
  async function refreshTasks(){try{setTasks(await api<Task[]>('/api/admin/ai/tasks'));}catch(error){setError((error as Error).message);}}
  function change(update:Partial<Assistant>){setValue(current=>current&&({...current,...update}));setMessage('');}
  async function save(){
    if(!saved||!value||!session.csrfToken||busy)return;
    setBusy(true);setError('');setMessage('');
    try{const result=await api<Settings>('/api/admin/ai/settings',mutation('PUT',session.csrfToken,{data:value,revision:saved.revision}));setSaved(result);setValue(result.data);setMessage('AI 도우미 설정을 저장했습니다. 다음 생성부터 적용합니다.');}
    catch(error){setError((error as Error).message);}finally{setBusy(false);}
  }
  async function article(){
    if(!session.csrfToken||busy)return;
    const requestId=articleId??crypto.randomUUID();setArticleId(requestId);setBusy(true);setError('');setMessage('');
    try{await api('/api/admin/ai/articles',mutation('POST',session.csrfToken,{topic,requestId}));setArticleId(null);setTopic('');setMessage('최신 자료를 찾아 초안을 만듭니다. 완료하면 아래 기록에서 열어 검토해 주세요.');await refreshTasks();}
    catch(error){setError((error as Error).message);}finally{setBusy(false);}
  }
  async function retry(task:Task){
    if(!session.csrfToken||busy)return;setBusy(true);setError('');
    try{await api(`/api/admin/ai/tasks/${task.id}/retry`,mutation('POST',session.csrfToken));await refreshTasks();}
    catch(error){setError((error as Error).message);}finally{setBusy(false);}
  }
  const avatar=value?.images.find(image=>image.id===value.avatarId);
  const dirty=JSON.stringify(value)!==JSON.stringify(saved?.data);
  return <section id="ai-settings" className="ai-settings-section" aria-labelledby="ai-heading">
    <div className="ai-section-heading"><div><h2 id="ai-heading"><Bot aria-hidden="true" />AI 도우미</h2><p className="field-help">이름과 관점을 정하고, 함께할 일을 선택하세요.</p></div>
      {saved&&<span className="field-help">{saved.connected?'서버 연결 설정됨':'플랫폼 AI 연결 준비 중'}</span>}</div>
    {loading&&<p role="status">도우미 설정을 불러오는 중…</p>}
    {value&&<form onSubmit={event=>{event.preventDefault();void save();}}>
      <fieldset className="ai-profile-fields" disabled={busy}><legend>도우미 프로필</legend>
        <div className="ai-profile-preview">{avatar?<img src={avatar.url} alt="" referrerPolicy="no-referrer" />:<Bot aria-hidden="true" />}
          <div><strong>{value.name||'이름을 등록해 주세요'}</strong><span className="ai-badge">AI 도우미</span><p>이름과 대표 이미지는 AI가 쓴 글·댓글에 표시합니다.</p></div></div>
        <label htmlFor="ai-name">이름</label><input id="ai-name" maxLength={40} value={value.name} onChange={e=>change({name:e.target.value})} placeholder="직접 정한 이름" required={value.summaryEnabled||value.tagsEnabled||value.commentsEnabled} />
        <label htmlFor="ai-personality">성격·관점</label><textarea id="ai-personality" rows={4} maxLength={6000} value={value.personality} onChange={e=>change({personality:e.target.value})} placeholder="어떤 것에 관심이 있고, 무엇을 중요하게 생각하나요?" />
        <label htmlFor="ai-tone">말투</label><textarea id="ai-tone" rows={3} maxLength={3000} value={value.tone} onChange={e=>change({tone:e.target.value})} placeholder="존댓말 여부, 문장 길이, 자주 쓰거나 피할 표현" />
        <p className="field-help">요약·태그·댓글·글 작성에 공통으로 반영합니다. 요약은 원문 의미를, 태그는 실제 글의 주제를 유지합니다.</p>
      </fieldset>
      <fieldset className="ai-image-fields" disabled={busy}><legend><ImagePlus aria-hidden="true" />이미지 목록</legend>
        <p className="field-help">로그인 없이 열리는 HTTPS 이미지 주소를 등록하세요. 대표 이미지는 하나를 선택합니다.</p>
        {!value.images.length&&<p className="ai-empty">등록한 이미지가 없습니다. 이미지는 나중에 추가해도 됩니다.</p>}
        {value.images.map((image,index)=><div className="ai-image-row" key={image.id}>
          <label className="ai-image-choice"><input type="radio" name="ai-avatar" checked={value.avatarId===image.id} onChange={()=>change({avatarId:image.id})} /><span>대표</span></label>
          <div><label htmlFor={`ai-image-label-${image.id}`}>이미지 {index+1} 이름</label><input id={`ai-image-label-${image.id}`} value={image.label} required maxLength={40} onChange={e=>change({images:value.images.map(item=>item.id===image.id?{...item,label:e.target.value}:item)})} />
            <label htmlFor={`ai-image-url-${image.id}`}>이미지 주소</label><input id={`ai-image-url-${image.id}`} type="url" value={image.url} required maxLength={2000} placeholder="https://…" onChange={e=>change({images:value.images.map(item=>item.id===image.id?{...item,url:e.target.value}:item)})} /></div>
          <button type="button" className="text-button danger" aria-label={`이미지 ${index+1} 삭제`} onClick={()=>change({images:value.images.filter(item=>item.id!==image.id),avatarId:value.avatarId===image.id?null:value.avatarId})}><Trash2 aria-hidden="true" /></button>
        </div>)}
        <button type="button" className="secondary" disabled={value.images.length>=12} onClick={()=>{const id=crypto.randomUUID();change({images:[...value.images,{id,label:'',url:''}],avatarId:value.avatarId??id});}}><Plus aria-hidden="true" />이미지 추가</button>
      </fieldset>
      <fieldset disabled={busy} className="ai-work-fields"><legend>도우미가 할 일</legend>
        {([['summaryEnabled','AI 요약 생성 허용','관리자가 글 수정 화면에서 요청할 때만 생성합니다. 직접 쓴 요약은 유지합니다.'],['tagsEnabled','AI 태그 생성 허용','관리자가 태그가 없는 편집본에서 요청할 때만 생성합니다.'],['commentsEnabled','자동 댓글 달기','최근 7일의 미응답 댓글에 한 번만 답합니다. 보탤 내용이 없으면 건너뜁니다.']] as const).map(([key,label,help])=><label className="setting-toggle" key={key}><span><strong>{label}</strong><small>{help}</small></span><input type="checkbox" role="switch" checked={value[key]} disabled={!saved?.connected} onChange={e=>change({[key]:e.target.checked})} /></label>)}
        <div className="ai-two-fields"><div><label htmlFor="ai-interval">댓글 확인 간격</label><select id="ai-interval" value={value.commentIntervalMinutes} onChange={e=>change({commentIntervalMinutes:Number(e.target.value)})}>{[30,60,180,360,720,1440].map(minutes=><option key={minutes} value={minutes}>{minutes<60?`${minutes}분`:`${minutes/60}시간`}</option>)}</select></div>
          <p className="field-help"><Clock3 aria-hidden="true" />한 번에 최대 3개. 끄면 대기 중인 답글도 게시하지 않습니다.</p></div>
      </fieldset>
      <fieldset disabled={busy} className="ai-memory-fields"><legend>이전 대화 기억</legend>
        <label className="setting-toggle"><span><strong>회원의 이전 댓글 참고</strong><small>닉네임을 바꿔도 같은 계정의 공개 댓글을 기억합니다.</small></span><input type="checkbox" role="switch" checked={value.rememberMembers} onChange={e=>change({rememberMembers:e.target.checked})} /></label>
        <div className="ai-two-fields"><div><label htmlFor="ai-memory-days">기억 범위</label><select id="ai-memory-days" disabled={!value.rememberMembers} value={value.memoryDays} onChange={e=>change({memoryDays:Number(e.target.value)})}>{[7,30,90].map(days=><option key={days} value={days}>최근 {days}일</option>)}</select></div>
          <div><label htmlFor="ai-familiarity">친근함</label><select id="ai-familiarity" value={value.familiarity} onChange={e=>change({familiarity:e.target.value as Assistant['familiarity']})}><option value="reserved">차분하게</option><option value="natural">자연스럽게</option><option value="friendly">친근하게</option></select></div></div>
        <p className="field-help">최근 공개 댓글 최대 8개를 참고합니다. 관련 있는 이야기만 꺼내며, 삭제한 댓글은 다음 생성에서 제외합니다. 비회원은 현재 대화만 참고합니다.</p>
      </fieldset>
      <fieldset disabled={busy}><legend>도우미 호출</legend>
        <label className="setting-toggle"><span><strong>호출·도우미 댓글의 답글에 우선 답변</strong><small>키워드로 부르거나 도우미의 댓글에 답글을 남기면 답합니다. 예약 댓글이 꺼져 있어도 동작하며, 한 번에 3개 제한과 별도로 처리합니다.</small></span><input type="checkbox" role="switch" checked={value.mentionsEnabled} disabled={!saved?.connected} onChange={e=>change({mentionsEnabled:e.target.checked})} /></label>
        <label htmlFor="ai-mention">호출 키워드</label><input id="ai-mention" value={value.mentionKeyword} maxLength={41} placeholder="@루미" required={value.mentionsEnabled} onChange={e=>change({mentionKeyword:e.target.value})} />
        <p className="field-help">댓글에 이 키워드를 쓰면 바로 생성을 요청합니다. 모델 응답 시간에 따라 잠시 기다릴 수 있습니다.</p>
      </fieldset>
      <button disabled={busy||!dirty}><Save aria-hidden="true" />{busy?'처리 중…':'도우미 설정 저장'}</button>
      <p className="field-help">변경한 설정은 다음 생성부터 적용합니다. 기존 글·댓글과 AI 작성 표시는 유지합니다.</p>
    </form>}
    {error&&<div className="notice error" role="alert"><p>{error}</p><button type="button" className="text-button" onClick={()=>{if(!dirty||window.confirm('저장하지 않은 설정을 버리고 다시 불러올까요?'))setReload(n=>n+1);}}><RefreshCw aria-hidden="true" />설정 다시 불러오기</button></div>}
    {message&&<p className="profile-feedback" role="status">{message}</p>}
    {saved&&<><form className="ai-lab" onSubmit={event=>{event.preventDefault();void article();}}><h3><FilePenLine aria-hidden="true" />글 작성 실험실</h3>
      <p className="field-help">최근 7일의 뉴스 자료에서 출처를 찾아 초안을 작성합니다. 자동 공개하지 않으며, 내용과 출처는 직접 검토해 주세요.</p>
      <label htmlFor="ai-topic">알아보고 싶은 주제</label><input id="ai-topic" value={topic} minLength={2} maxLength={200} required onChange={e=>{setTopic(e.target.value);setArticleId(null);}} placeholder="관심 있는 주제를 입력하세요" disabled={busy} />
      <button className="secondary" disabled={busy||!saved.connected||!saved.data.name||dirty}><FilePenLine aria-hidden="true" />초안 만들기</button>{dirty&&<p className="field-help">도우미 설정을 먼저 저장해 주세요.</p>}
    </form><div className="ai-task-heading"><h3>최근 작업</h3><button className="text-button" type="button" onClick={()=>void refreshTasks()}><RefreshCw aria-hidden="true" />새로고침</button></div>
      {!tasks.length?<p className="field-help">아직 실행한 작업이 없습니다.</p>:<ul className="ai-task-list">{tasks.map(task=><li key={task.id}><div><strong>{kinds[task.kind]} · {states[task.state]}</strong><p>{task.title||'게시글 작업'}</p>{task.errorCode&&<small>{reasons[task.errorCode]||'처리 상태를 확인해 주세요.'}</small>}</div>
        {task.kind==='article'&&task.state==='SUCCEEDED'&&task.postId&&<a href={`/admin/posts/${task.postId}`}>초안 열기</a>}
        {task.state==='FAILED'&&['CONNECTION_FAILED','GENERATION_FAILED','EXECUTION_UNCONFIRMED'].includes(task.errorCode||'')&&<button className="text-button" disabled={busy} onClick={()=>void retry(task)}>재시도</button>}</li>)}</ul>}</>}
  </section>;
}
