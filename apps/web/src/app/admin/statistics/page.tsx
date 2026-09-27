'use client';

import { useEffect, useState } from 'react';
import { ChartNoAxesCombined, RefreshCw, LogIn } from 'lucide-react';
import { api, type Session } from '@/lib/api';

type Report = {
  totalViews: number;
  daily: { day: string; views: number; visitors: number }[];
  popular: { id: string; title: string; slug: string; status: string; views: number }[];
  referrers: { host: string; views: number }[];
  recent: { visitedAt: string; title: string; id: string; referrerHost: string }[];
};
const number = (value: number) => value.toLocaleString('ko-KR');
const time = (value: string) => new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export default function StatisticsPage() {
  const [days, setDays] = useState('30');
  const [revision, setRevision] = useState(0);
  const [session, setSession] = useState<Session | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    api<Session>('/api/auth/session', { signal: controller.signal }).then(async user => {
      if (controller.signal.aborted) return;
      setSession(user);
      if (user.user?.isAdmin) {
        const data = await api<Report>(`/api/admin/statistics?days=${days}`, { signal: controller.signal });
        if (!controller.signal.aborted) setReport(data);
      }
    }).catch(error => { if (!controller.signal.aborted) setError(error.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [days, revision]);
  if (!session?.user?.isAdmin) return <section className="message-page"><h1>방문 통계</h1>
    {loading ? <p role="status">접근 권한을 확인하는 중…</p> : <><p>{error || '관리자 계정으로 로그인해 주세요.'}</p><a className="button" href="/login"><LogIn aria-hidden="true" />로그인</a></>}
  </section>;
  const today = report?.daily.at(-1);
  const periodViews = report?.daily.reduce((sum, day) => sum + day.views, 0) || 0;
  const peak = Math.max(1, ...report?.daily.map(day => day.views) || []);
  return <section className="admin-page statistics-page">
    <nav className="admin-nav" aria-label="관리 메뉴"><a href="/admin">글 관리</a><a href="/admin/categories">카테고리</a><a href="/admin/comments">댓글 관리</a><a href="/admin/statistics" aria-current="page">방문 통계</a><a href="/admin/settings">설정</a></nav>
    <div className="page-heading"><div><h1><ChartNoAxesCombined aria-hidden="true" />방문 통계</h1><p>글을 읽은 방문 흐름을 확인합니다.</p></div>
      <button type="button" className="secondary" disabled={loading} onClick={() => setRevision(value => value + 1)}><RefreshCw aria-hidden="true" />새로고침</button></div>
    <div className="statistics-controls"><label htmlFor="statistics-days">조회 기간</label><select id="statistics-days" value={days} onChange={event => setDays(event.target.value)}>
      <option value="7">최근 7일</option><option value="30">최근 30일</option><option value="90">최근 90일</option></select><span>한국 시간 기준</span></div>
    {error && <p className="notice error" role="alert">{error} 새로고침으로 다시 확인해 주세요.</p>}
    {loading ? <p role="status" className="loading">통계를 불러오는 중…</p> : report && !error && <>
      <dl className="statistics-summary"><div><dt>오늘 조회</dt><dd>{number(today?.views || 0)}</dd></div><div><dt>오늘 추정 방문자</dt><dd>{number(today?.visitors || 0)}</dd></div>
        <div><dt>선택 기간 조회</dt><dd>{number(periodViews)}</dd></div><div><dt>전체 누적 조회</dt><dd>{number(report.totalViews)}</dd></div></dl>
      {!periodViews && <p className="notice">아직 집계된 방문이 없습니다. 기능 적용 이후 공개 글을 읽은 방문부터 표시합니다.</p>}
      <section className="statistics-section"><h2>일별 방문</h2><p>같은 날 같은 브라우저는 방문자 한 명으로 추정합니다.</p>
        <div className="statistics-table-wrap" tabIndex={0} role="region" aria-label="일별 방문 표" ><table className="statistics-table"><caption className="sr-only">최근 {days}일의 조회수와 추정 방문자</caption>
          <thead><tr><th scope="col">날짜</th><th scope="col">조회수</th><th scope="col">추정 방문자</th></tr></thead><tbody>
            {[...report.daily].reverse().map(day => <tr key={day.day}><th scope="row"><time dateTime={day.day}>{day.day.slice(5).replace('-', '. ')}</time></th>
              <td><span className="statistics-bar" aria-hidden="true" style={{ width: `${day.views / peak * 100}%` }} /><span>{number(day.views)}</span></td><td>{number(day.visitors)}</td></tr>)}
          </tbody></table></div></section>
      <div className="statistics-columns"><section className="statistics-section"><h2>많이 읽은 글</h2>{report.popular.length ? <ol className="statistics-ranking">
        {report.popular.map(post => <li key={post.id}><a href={`/admin/posts/${post.id}`}>{post.title}</a><span>{number(post.views)}회</span></li>)}</ol> : <p>집계된 글이 없습니다.</p>}</section>
        <section className="statistics-section"><h2>유입 경로</h2>{report.referrers.length ? <ul className="statistics-ranking">
          {report.referrers.map(item => <li key={item.host}><span>{item.host || '직접·내부 이동 / 알 수 없음'}</span><span>{number(item.views)}회</span></li>)}</ul> : <p>집계된 유입이 없습니다.</p>}</section></div>
      <section className="statistics-section"><h2>최근 방문</h2><p>기간 선택과 별개로 최근 30일 내 마지막 20건을 표시합니다.</p>
        {report.recent.length ? <ul className="statistics-recent">{report.recent.map((visit, index) => <li key={`${visit.visitedAt}-${index}`}>
          <time dateTime={visit.visitedAt}>{time(visit.visitedAt)}</time><a href={`/admin/posts/${visit.id}`}>{visit.title}</a><span>{visit.referrerHost || '직접·내부 / 알 수 없음'}</span></li>)}</ul> : <p>집계된 방문이 없습니다.</p>}</section>
    </>}
    <p className="statistics-note">관리자·알려진 봇·같은 글의 30분 내 반복 조회는 제외합니다. 쿠키 차단이나 추적 거부, 여러 기기 사용으로 실제 인원과 차이가 날 수 있습니다. 일별 방문자 수를 더해 기간 전체 인원으로 계산하지 않습니다. 삭제한 글은 글별 통계와 전체 누적에서 제외되며, 익명 일별 집계에는 남습니다.</p>
  </section>;
}
