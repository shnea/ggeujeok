# 플랫폼 연결 자료 색인

SHNEA Platform에서 끄적이 소비할 외부 계약의 진입점이다. 내부 구현 정책은 [콘텐츠](content.md), [사용자](users.md), [운영](operations.md)을 따른다. 아래 문서를 모두 읽지 말고 사용하는 기능의 자료만 연다.

문서/API 명세 접근은 2026-09-27 공개 HTTP GET으로 확인했다. 이후 변경 가능성은 작업 시 해당 원본에서 확인한다. 실제 연결·패키지·기능별 검증 결과는 [현재 상태](../STATUS.md)와 [이력](history.md)을 따른다.

## 기능별 접근 자료

| 사용할 기능 | 문서·API·예제 URL | 확인한 제공 범위·제약 |
| --- | --- | --- |
| 전체 진입점 | [연결 지침](https://platform.shnea.kr/integrations/SERVICE_INTEGRATION.md) | 필요한 기능의 자료로 이동 |
| 로그인·환경 | [로그인 계약](https://platform.shnea.kr/integrations/auth.md), [환경 API 명세](https://platform.shnea.kr/integrations/project.openapi.json) | 환경별 OIDC와 서버 context 제공. 호스트 Bearer audience는 자동 구성되지 않음 |
| 파일 | [파일 API 명세](https://platform.shnea.kr/integrations/file.openapi.json), [서버 예제](https://platform.shnea.kr/examples/file-client.py) | 생성·조각 업로드·재개·보기·공개 범위·보존·삭제. 타 도메인 iframe/HLS·CORS 제한 |
| Editor/Viewer | [연동 계약](https://platform.shnea.kr/integrations/editor.md), [패키지](https://platform.shnea.kr/integrations/shnea-editor-0.1.0-alpha.11.tgz), [체크섬](https://platform.shnea.kr/integrations/checksums.json), [브라우저 예제](https://platform.shnea.kr/examples/editor/) | 현재 alpha.11·문서 version 3. 이미지 티켓·플랫폼 원점 연결 지원. 공개 npm 발행 아님. 본문 SSR 미지원은 사용자 확인 |
| 외부 Job | [계약](https://platform.shnea.kr/integrations/jobs.md), [API 명세](https://platform.shnea.kr/integrations/jobs.openapi.json), [워커 예제](https://platform.shnea.kr/examples/jobs-client.py) | 플랫폼 큐·상태, 호스트 실행. 최소 한 번 실행·lease·중복 처리 계약 준수 |
| AI 작업 | [계약](https://platform.shnea.kr/integrations/ai.md), [API 명세](https://platform.shnea.kr/integrations/ai.openapi.json), [서버 예제](https://platform.shnea.kr/examples/ai-client.py) | 환경별 서버 키로 `blog.summary`·`blog.tags`·`comment.generate`·`article.draft`를 접수·조회. 호스트가 결과 구조·반영 조건을 검증 |
| 공통 로그 | [계약](https://platform.shnea.kr/integrations/logs.md), [API 명세](https://platform.shnea.kr/integrations/logs.openapi.json), [전송 예제](https://platform.shnea.kr/examples/logs-client.py) | 외부 수집·조회 제공. 환경별 한도·보존·유실 가능성 고려 |
| 일반 알림·외부 웹훅 | [제공 상태](https://platform.shnea.kr/integrations/SERVICE_INTEGRATION.md) | 확인 시점 미제공. 임의 API 경로를 만들지 않음 |

예제·패키지 URL은 플랫폼 진입점에 게시된 주소다. 모든 파일을 내려받거나 실행해 검증했다는 뜻은 아니다. 계약과 명세가 충돌하면 운영자에게 확인하며 내부 DB·서비스 포트·관리자 API를 외부 계약으로 사용하지 않는다.

<a id="inputs"></a>
## 필수 입력과 책임

- 공통: 사용할 기능, 호스트 주소·스택, DEV/PROD 프로젝트 ID·환경 ID·종류, 키 권한·만료·비밀값 주입 여부. `integration/context` 결과와 지정 환경을 대조한다.
- 로그인: 정확한 issuer, client 정보, 등록된 콜백·로그아웃 복귀 URL, 관리자로 지정할 사용자 식별값. realm을 이름에서 추정하지 않는다.
- 현재 입력한 콜백은 `https://shnea.kr/callback`, 로그아웃 복귀는 `https://shnea.kr/`다. 실제 로그인 검수는 [현재 상태](../STATUS.md)를 따른다. 같은 도메인을 쓰더라도 환경별 OIDC 설정·키·DB를 분리한다.
- 파일: 프로젝트 파일 사용 설정, 필요한 read/write/delete 권한, 실제 보존 정책, 첨부 중계·원본 백업 범위. 사용하지 않는 공유 권한은 발급하지 않는다.
- Job/로그: 접수·조회·실행·전송 역할별 최소 키 권한. 기존 키에 새 권한이 자동으로 생긴다고 가정하지 않는다.
- 키 원문은 문서·대화로 받지 않고 [환경 파일 정책](operations.md#deployment)에 따라 서버에 주입한다. 서버 키와 이용자 로그인은 별개이며 사용자의 업무 권한·본문 저장·파일 참조는 호스트 책임이다.

개발 환경값은 `.env.dev`에서 관리한다. 이 색인은 외부 기능의 지원 여부와 자료 접근을 안내하며 끄적 전체 구현 완료를 의미하지 않는다.

## 외부로 전달할 끄적 지침

끄적 API가 구현되면 외부 사용자용 지침을 내부 설계와 별도로 제공한다. 형식은 기능 → 접근 가능한 계약/명세/예제 URL, 지원 여부·제약·필수 입력이다. 현재는 배포된 끄적 API나 공개 명세가 없어 빈 외부 가이드를 미리 만들지 않는다. n8n 제공 범위는 [자동화 기준](content.md#automation)을 따른다.

플랫폼 닉네임의 사용·갱신 정책은 [사용자 인증 기준](users.md#auth)을 따른다. 외부 claim 계약은 [로그인 지침](https://platform.shnea.kr/integrations/auth.md)에서 확인한다.
