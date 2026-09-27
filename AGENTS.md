# 작업 지침

## 먼저 읽을 것

새 대화에서는 이 파일과 [STATUS.md](STATUS.md)만 먼저 읽는다. 이후 작업에 해당하는 바로가기의 문서·절과 실제 코드만 확인한다. 이미 읽은 내용은 변경됐거나 필요한 맥락이 사라진 경우에만 다시 읽는다.

## 공통 규칙

- 목적·핵심 흐름·첫 출시 범위·제외 범위는 [REQUIREMENTS.md](REQUIREMENTS.md)를 기준으로 한다. 기능별 상세 정책은 아래 기준 문서 한 곳에서 관리하고 다른 문서에는 링크만 둔다.
- 사용자 확정과 명시적으로 위임한 선택은 확정으로, 검토 중인 안은 제안으로 표시한다. 외부 지원 여부·환경값·미정 사항을 추측해 확정하지 않는다. 문서 재배치만으로 요구사항을 바꾸지 않는다.
- 설계 요청은 설계 범위에서 진행하고 애플리케이션 구현은 진행 지시 뒤 시작한다. 이미 구현까지 요청받았다면 불필요한 승인을 반복하지 않는다. 기존 자료에서 알 수 있는 내용을 다시 묻지 않는다.
- 언어·프레임워크 이름만으로 방법론을 정하지 않는다. 프로그램의 성격·규모·기존 버전/코드·공식 관례를 확인하고 가장 단순한 구조와 선택 이유를 [구현 계획](docs/implementation-plan.md#structure)에 남긴다. 불확실한 동작은 해당 버전의 공식 문서로 확인한다.
- 기존 코드·표준 기능을 우선하고 읽기 쉬운 이름과 명확한 책임을 사용한다. 불필요한 의존성·추상화·미래 기능용 구조를 추가하지 않는다. 권한·데이터 무결성·접근성은 단순화한다는 이유로 생략하지 않는다.
- 수정 전 현재 변경 상태·실행 중 작업을 확인해 사용자 작업을 보존한다. 새 기능은 [코드 배치 기준](docs/implementation-plan.md#code-map)에 맞추고 파일은 줄 수보다 책임·변경 이유로 나눈다. 합의한 구조를 바꿀 때는 근거와 영향을 설명한다.
- 작업에 맞는 스킬과 필요한 참조만 적용한다. 같은 분석·검증을 여러 스킬로 반복하지 않는다.
- 검색은 파일명·심볼·관련 폴더부터 좁힌다. 독립적인 조회는 묶고 큰 파일 전체를 출력해 잘린 뒤 재조회하는 방식을 피한다. 기존 그래프는 필요할 때 참고하되 실제 코드가 우선이다.
- 질문·설명·단순 확인에는 불필요한 수정·테스트·커밋을 하지 않는다. 변경했을 때만 영향에 맞는 검증을 수행하고 실제 실행한 결과와 미검증 항목을 구분한다.
- 버그는 실제 흐름과 원인을 확인해 수정한다. 변경 후 구조·의존 방향·오류 처리·보안과 필요한 검증을 확인하며 근거 없이 검증을 반복하거나 범위를 넓히지 않는다.
- 문서 갱신과 커밋은 의미 있는 완료 단위로 묶는다. 커밋·push·배포는 합의한 권한과 절차를 따르며 비밀값·실행 데이터는 저장소에 넣지 않는다.
- 상태는 [STATUS.md](STATUS.md)에 현재 작업·미완료·다음 행동만 남긴다. 완료된 작업의 상세 기록은 [이력](docs/history.md)으로 옮긴다. 구현 완료와 운영 검증 완료를 구분한다.
- 실제 코드·명령이 생기고 확인됐을 때만 아래 바로가기에 추가한다. 예상 경로·실행하지 못하는 검증 명령을 현재 사용 가능한 것처럼 적지 않는다.
- 외부 전달용 연동 지침은 내부 설계와 분리한다. 사용할 기능별 접근 가능한 문서·API·예제 URL, 지원 상태·제약·필수 입력만 제공한다. 미구현 API·공개되지 않은 주소·다른 PC에서 읽을 수 없는 로컬 경로를 안내하지 않는다.
- 문서는 필요한 범위만 추가한다. 기준 정보의 복사본, 빈 목차 파일, 미리 만든 문서 계층은 두지 않는다. 한국어 설명은 의미를 보존하면서 간결하고 자연스럽게 쓴다.
- 인계·완료 보고는 변경·실행한 검증·미확인 사항·다음 행동만 짧게 전달한다. 긴 대화는 복사하지 않으며 구현 완료·로컬 검증·운영 검증을 구분한다.

## 작업별 바로가기

| 작업 | 기준 문서 |
| --- | --- |
| 서비스 범위·핵심 흐름 | [요구사항 목차](REQUIREMENTS.md) |
| 글 작성·공개·자동 저장·분류 | [콘텐츠: 게시글](docs/content.md#posts) |
| 이미지·첨부·대표 이미지 | [콘텐츠: 파일](docs/content.md#media) |
| n8n·AI 요약·자동화 API | [콘텐츠: 자동화](docs/content.md#automation) |
| 목록·검색·SEO·RSS·광고 | [콘텐츠: 공개 화면](docs/content.md#public) |
| 로그인·관리자·세션 | [사용자: 인증](docs/users.md#auth) |
| 댓글·좋아요·내 활동 | [사용자: 활동](docs/users.md#activity) |
| 앱 내 알림 | [사용자: 알림](docs/users.md#notifications) |
| 조회수·통계·감사·로그 | [운영: 관측](docs/operations.md#observability) |
| Docker·환경 파일·배포·복구 | [운영: 배포](docs/operations.md#deployment) |
| 구조·구현 순서 | [구현 계획](docs/implementation-plan.md) |
| 공통 플랫폼 연결 자료 | [플랫폼 자료 색인](docs/platform-integration.md) |

### 구현된 코드·검증 바로가기

| 작업 | 코드 | 검증 |
| --- | --- | --- |
| 인증·권한·세션 | [인증](apps/api/src/auth/), [권한·오류](apps/api/src/http.ts) | `npm test`, 아래 통합 테스트 |
| 글·편집본·공개 범위 | [글 API](apps/api/src/posts/), [관리 화면](apps/web/src/app/admin/) | 아래 통합 테스트, `npm run typecheck` |
| 카테고리 관리·삭제 보호 | [분류 API](apps/api/src/posts/categories.controller.ts), [분류 서비스](apps/api/src/posts/categories.service.ts), [관리 화면](apps/web/src/app/admin/categories/) | 아래 통합 테스트, `npm run typecheck` |
| 태그 자동완성·입력 | [관리자 검색](apps/api/src/posts/posts.controller.ts), [검색 서비스](apps/api/src/posts/posts.service.ts), [태그 입력](apps/web/src/app/admin/posts/[id]/tag-input.tsx) | 아래 통합 테스트, 실제 도메인에서 키보드·모바일 검수 |
| 닉네임·댓글/대댓글·좋아요 | [활동 API](apps/api/src/activity/), [플랫폼 닉네임](apps/api/src/auth/platform-profile.ts), [댓글 화면](apps/web/src/components/post-interactions.tsx), [회원 작성](apps/web/src/components/comment-form.tsx), [비회원 작성](apps/web/src/components/guest-comment-form.tsx), [관리](apps/web/src/app/admin/comments/) | 아래 통합 테스트([활동](apps/api/test/activity.integration.ts), [답글](apps/api/test/replies.integration.ts)), `npm run typecheck`, 실제 도메인 검수 |
| 내 활동·알림·워커 | [내 활동 API](apps/api/src/me/), [알림 처리](apps/api/src/notifications/notifications.service.ts), [워커](apps/api/src/worker.ts), [내 활동 화면](apps/web/src/app/me/) | 아래 통합 테스트([알림·권한·동시 처리](apps/api/test/notifications.integration.ts)), `npm run typecheck`, 실제 도메인 검수 |
| 공개 화면·Viewer | [웹 경로](apps/web/src/app/), [Viewer](apps/web/src/components/document-viewer.tsx) | `npm run build`, 실제 도메인에서 브라우저 검수 |
| 관련 글·SEO·RSS·사이트맵 | [공개 조회](apps/api/src/posts/posts.service.ts), [글 상세](apps/web/src/app/posts/[slug]/page.tsx), [RSS](apps/web/src/app/rss.xml/route.ts), [사이트맵](apps/web/src/app/sitemap.ts), [robots](apps/web/src/app/robots.ts) | 아래 통합 테스트, `npm run test --workspace @ggeujeok/web`, 실제 XML·초기 HTML 검수 |
| 테마·소개/정책·광고 | [테마](apps/web/src/components/theme-select.tsx), [광고](apps/web/src/components/post-ad.tsx), [사이트 정보](apps/web/src/lib/site-info.ts) | `npm run test --workspace @ggeujeok/web`, `npm run typecheck`, 실제 도메인에서 브라우저 검수 |
| 이미지 업로드·중계·참조 권한 | [파일 API](apps/api/src/files/), [첨부 어댑터](apps/web/src/lib/attachments.ts) | 아래 통합 테스트, 실제 도메인에서 업로드 검수 |
| 대표 이미지·공유 이미지 | [참조 검증](apps/api/src/files/references.ts), [대표 이미지 선택](apps/web/src/app/admin/posts/[id]/cover-picker.tsx), [공개 상세](apps/web/src/app/posts/[slug]/page.tsx) | 아래 통합 테스트, `npm run test --workspace @ggeujeok/web` |
| DB·마이그레이션 | [DB 연결](apps/api/src/database/), [마이그레이션](apps/api/migrations/) | 아래 통합 테스트 |
| AI 도우미·호출·기억·n8n | [AI 처리](apps/api/src/ai/), [설정 화면](apps/web/src/app/admin/settings/ai-settings-form.tsx), [워크플로](scripts/n8n-workflows.mjs) | `npm test`, 아래 통합 테스트, [연결 관리](docs/operations.md#deployment) |
| 환경·Docker | [실행](compose.yaml), [빌드](compose.build.yaml), [이미지](docker/) | [실행 절차](docs/operations.md#deployment) |
| 방문 통계·운영 로그·파일 정리 | [통계](apps/api/src/statistics/), [로그](apps/api/src/operations/), [정리](apps/api/src/files/cleanup.ts), [워커](apps/api/src/worker.ts) | `npm test`, 아래 통합 테스트 |
| DB 백업·격리 복원 | [백업](scripts/backup-db.sh), [복원 점검](scripts/check-db-restore.sh) | [백업 절차](docs/operations.md#deployment) |
| 개인 닉네임·광고 설정 | [내 설정 API](apps/api/src/me/), [광고 설정 API](apps/api/src/settings/), [내 설정](apps/web/src/app/me/settings/), [관리자 설정](apps/web/src/app/admin/settings/) | 아래 통합 테스트, `npm run test --workspace @ggeujeok/web`, 실제 도메인 검수 |
| 사이트 정보·검색 인증·분석 설정 | [운영 기준](docs/operations.md#site-settings), [사이트 설정 API](apps/api/src/settings/site.service.ts), [서버 설정 조회](apps/web/src/lib/site-settings.ts), [관리자 설정](apps/web/src/app/admin/settings/site-settings-form.tsx) | 아래 통합 테스트, `npm run typecheck`, 실제 도메인 검수 |
| 목록 보기·무한 스크롤 | [공개 목록](apps/web/src/app/page.tsx), [목록 컴포넌트](apps/web/src/components/post-feed.tsx) | `npm run typecheck`, `npm run build`, 실제 도메인 검수 |

통합 테스트: 개발 API 이미지 빌드 후 `docker compose -f compose.test.yaml up --abort-on-container-exit --exit-code-from test`. 정리는 `docker compose -f compose.test.yaml down`. 실제 플랫폼 인증·브라우저 검수를 대체하지 않는다.
