'use client';
export default function ErrorPage({ reset }: { reset: () => void }) {
  return <section className="message-page"><h1>잠시 연결이 끊겼어요.</h1><p>글을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</p><button onClick={reset}>다시 불러오기</button></section>;
}
