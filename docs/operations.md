# 운영 기준

통계·로그·감사·Docker 환경·배포·복구의 기준 문서다. 별도 표시가 없는 정책은 **확정**이며 실제 운영 검증 완료를 뜻하지 않는다. 사용자 기능은 [사용자 기준](users.md), 글·파일·작업 처리는 [콘텐츠 기준](content.md)을 따른다.

<a id="observability"></a>
## 조회수·통계·로그·보존

### 자체 통계

- 관리자는 전체/글별 조회수·일별 추정 방문자·인기 글·유입 경로·최근 방문 현황을 확인한다. Google 도구와 자체 통계의 역할을 구분한다.
- 하루 만료의 무작위 익명 쿠키로 브라우저를 구분하고 서버에는 해시를 집계 키로 사용한다. 로그인 계정과 연결하거나 여러 기기를 같은 사람으로 합치지 않는다.
- 같은 방문자·같은 글은 직전 집계 후 30분에 한 번만 집계한다. 첫 집계는 Viewer 표시 성공 후 수행하며 서버가 재요청을 억제한다.
- 관리자 본인·미리보기·알려진 봇 User-Agent·사전 가져오기를 제외한다. 봇 판별 완전성·수치 조작 불가능성을 보장하지 않는다.
- 쿠키가 없거나 거부되면 고유 방문자·중복 제거 조회 집계에서 제외한다. 관리자 화면에 누락·다중 기기 가능성과 추정치임을 표시한다. 일별 고유 방문자의 합을 기간 전체 고유 인원으로 표시하지 않는다.
- 통계에는 원문 IP·전체 User-Agent·Referer 경로/쿼리·원문 검색어를 보관하지 않는다. 유입은 외부 호스트명 단위다.
- 원시 이벤트는 30일, 식별자 없는 일별 집계는 13개월 보존한다. 전체 누적 조회수는 글별 누적 카운터로 유지한다.
- 자체 통계 수집 실패가 공개 글 조회를 막지 않아야 한다. [개인정보 페이지](content.md#public)는 실제 수집 목적·항목·보존·외부 서비스에 맞춘다.
- 구현: 관리자 `/admin/statistics`에서 7/30/90일 일별 통계·상위 글·외부 도메인 유입·최근 20건을 본다. 날짜는 한국 시간이다. 당일 쿠키 확인 후 집계하며 날짜가 바뀌면 새 무작위 식별자로 교체한다. DNT/GPC 요청은 제외한다. 과거 방문을 소급 생성하지 않는다.
- `014_statistics.sql`의 원시 이벤트·일별/글별/유입 집계를 같은 트랜잭션으로 저장한다. 방문자 단위 잠금으로 동시 탭의 중복·일별 고유 수를 보호한다. 워커가 매시간 보존을 정리하며 글 삭제 시 글별 집계·누적도 삭제하고 식별자 없는 일별 집계는 유지한다.

### 외부 통계

- GA는 측정 설정이 있을 때 연결한다. 방문 행동·유입 분석에 사용하며 초기에는 보고서 API를 끄적으로 수집하지 않는다.
- 사이트 기본 정보와 검색·분석 입력은 아래 [사이트 설정](#site-settings)에서 관리한다.
- Search Console은 소유권 확인과 사이트맵 등록을 지원한다. 검색 노출·검색어·CTR·순위 확인은 해당 서비스에서 한다.
- 스크립트나 외부 서비스 장애가 글 조회·저장을 막지 않게 한다. 실계정 설정과 검수는 [필수 입력](#inputs)을 받은 뒤 수행한다.

### 로그·감사·정리

- 시스템·오류 로그는 공통 로그 API를 사용한다. 서버에서 구조화·비동기 전송하며 버퍼·재시도 상한을 둔다. 외부 계약과 한도는 [로그 자료](platform-integration.md)를 따른다.
- 전송 실패 때 로컬 표준 출력과 누락/실패 횟수로 확인할 수 있게 한다. 로컬 컨테이너 로그에도 회전·크기 제한을 적용한다. 사용자 요청을 로그 전송 완료까지 대기시키지 않는다.
- 끄적 요청 ID와 플랫폼 응답 `X-Request-ID`를 연결한다. Job/업로드 중복 방지용 requestId와 요청 추적 ID는 용도가 다르다.
- 키·토큰·Authorization·Cookie·인증 코드·비밀번호·전체 요청/응답 본문·비공개 URL·불필요한 개인정보를 송신 전에 제외한다.
- 오류 분기는 HTTP 상태와 기계용 code를 사용한다. 알 수 없는 code·비JSON 응답도 처리한다. 사용자 detail은 텍스트로 표시하며 입력 오류·권한 오류를 무조건 재시도하지 않는다.
- 공통 운영 로그는 7일 보존이며 유실·중복 가능성이 있다. 업무 완료의 유일한 증거나 영구 감사 기록으로 사용하지 않는다.
- 관리자·자동화의 변경 감사 기록은 끄적 DB에서 180일 보존한다. 주체·대상·행위·결과·시각만 기록하고 주요 변경과 같은 트랜잭션에 둔다. 본문·토큰·비밀번호는 제외한다.
- 정상 완료된 외부 전달/처리 기록은 30일 보존한다. 미완료 기록은 나이만으로 삭제하지 않는다. [알림](users.md#notifications)·[파일](content.md#media)의 자체 보존 정책은 각 기준 문서를 따른다.
- 워커에서 시작 시와 매시간 알림·통계·180일 지난 감사 기록·만료 세션·[파일](content.md#media)을 정리한다. 항목별 실패를 분리해 파일 서버 장애가 나머지 정리를 막지 않는다. 알림 보존은 [알림 정책](users.md#notifications)을 따른다.
- 운영 로그는 `operations/logs.ts`의 고정 이벤트와 허용 필드만 받는다. 자유 형식 예외·URL·요청 본문을 직렬화하지 않는다. API 요청 ID와 플랫폼 오류 응답 ID를 연결하고 로컬 표준 출력에도 남긴다. 최대 200건 대기·10건 배치·총 5초/3회 전송으로 제한하며 400/401/403/413은 재시도하지 않는다. 누락·실패 배치 수를 로컬 로그로 확인한다. 플랫폼 관리 화면의 서비스 `ggeujeok`에서 검색한다.

<a id="deployment"></a>
## Docker·배포·복구

### 환경 파일과 배포 파일

| 파일 | 위치 | 책임 |
| --- | --- | --- |
| `.env.dev` | 로컬 | 개발 이미지·포트·개발 DB·localhost 실행/테스트. 실제 연동은 DEV 값 준비 후 연결 |
| `.env.build` | 로컬 | 운영 이미지 이름·고정 태그·레지스트리·대상 아키텍처·비밀값 없는 빌드 설정 |
| `.env.prod` | 운영 | 배포 이미지 버전·도메인·DB·OIDC·플랫폼·n8n·운영 비밀값 |

- 운영 배포 디렉터리의 기본 파일은 **`.env.prod`와 `compose.yaml` 두 개**다. 환경 선택은 Compose의 `--env-file`로 명시하고 자동 `.env`에 의존하지 않는다.
- 사용자 지정 운영 경로는 `/volume1/docker/prod/ggeujeok`이다. DB는 `.env.prod`의 `DB_DATA_PATH=/volume2/homes/ggeujeok/db`, 업로드 임시 데이터는 `UPLOAD_DATA_PATH=/volume2/homes/ggeujeok/uploads`로 bind mount한다. 두 값이 없는 개발 환경은 기존 Docker named volume을 그대로 사용한다.
- 운영 계약은 `.env.prod`를 선택한 이미지 pull → `up -d`다. 명령은 아래 실행 절차를 따른다. 현재 배포 결과와 미검증 범위는 [현재 상태](../STATUS.md)에 기록한다.
- `compose.yaml`은 이미지 실행 전용으로 소스 경로·build·개발 환경 파일 참조를 넣지 않는다. 운영에는 Git clone·Dockerfile·로컬 소스·Node.js 설치가 필요 없어야 한다.
- 로컬 전용 `compose.build.yaml` 한 개가 web·api·nginx 빌드를 독립적으로 정의한다. `.env.dev`로 개발 이미지를, `.env.build`로 운영 이미지를 빌드·push한다. 운영에 이 파일을 배포하지 않는다.
- `.env.build`만으로 운영 이미지를 만들 수 있어야 한다. 운영 DB·플랫폼 키·`.env.prod` 또는 실행 시 설정이 빌드에 필요해서는 안 된다.
- 실제 세 환경 파일은 Git·빌드 컨텍스트에서 제외한다. 비밀값 없는 `.env.dev.example`, `.env.build.example`, `.env.prod.example`만 로컬 저장소에 둔다. 예제 파일은 운영에 필요 없다.
- 런타임 환경값은 해당 서비스에 필요한 변수만 명시적으로 주입한다. 환경 파일 전체를 모든 컨테이너에 전달하거나 이미지에 복사하지 않는다.
- `--env-file`의 치환과 컨테이너 환경 주입을 구분한다. 셸 변수가 우선할 수 있으므로 릴리스 명령은 충돌 없는 환경에서 실행하고 비밀값을 출력하지 않는 구성 검사를 사용한다.
- 운영 도메인과 서버 비밀값을 빌드에 고정하지 않는다. 브라우저 공개 설정은 서버가 허용한 값만 실행 시 제공해 설정 변경을 위한 재빌드를 줄인다. build args·공개 변수에 비밀값을 넣지 않는다.

### 이미지·서비스·영속 데이터

- 단일 서버 Compose를 기본으로 Nginx·web·api·worker·PostgreSQL을 운영한다. DB/API 포트는 외부 공개하지 않는다. worker는 API 이미지의 `apps/api/dist/worker.js`를 실행하며 추가 환경 파일·큐 서버 없이 기존 DB를 사용한다.
- 운영 주소는 `https://shnea.kr`이며 외부 NPM이 HTTPS를 종료하고 운영 서버의 **HTTP 30145 → 컨테이너 Nginx 8080**으로 전달한다. 로컬 개발 주소는 `http://localhost:30145`이고 `HOST_BIND=127.0.0.1`로 이 PC에서만 접근한다. 30140은 다른 서비스이므로 사용하지 않는다.
- 현재 로컬 플랫폼·OIDC·n8n 런타임 값은 비워 두고 worker를 중지한다. 공개 화면과 격리 테스트·모의 관리자 화면부터 확인한다. 실제 로그인·업로드·자동화는 DEV 환경과 콜백 연결 후 검수하며 인증 우회 기능을 만들지 않는다.
- NAS의 자동 네트워크 주소 풀이 부족해 운영 `.env.prod`의 `DOCKER_SUBNET=10.250.20.0/24`를 사용한다. 다른 서버에서는 기존 네트워크·라우팅과 충돌하지 않는 범위를 확인하며, 비우면 Docker 자동 할당을 따른다.
- 사용자 요청에 따라 이전 호스트용 설정·자동 이동 기능은 두지 않는다. 호스트 변경 뒤에는 쿠키가 공유되지 않아 새 주소에서 다시 로그인해야 한다.
- NPM의 호스트명·인증서·전달 주소가 준비되어야 실제 도메인 검수가 가능하다. 끄적 이미지에 TLS 개인키를 넣거나 NPM 구성을 임의로 변경하지 않는다.
- 이미지 규칙은 `registry.shnea.kr/ggeujeok-{web|api|nginx}:{tag}`다. 운영은 고정 버전·digest를 기록한다. worker·마이그레이션은 api 이미지를 재사용한다.
- macOS/Windows에서도 Linux 컨테이너를 사용한다. 실제 서버 아키텍처를 먼저 확인하고 해당 대상을 빌드한다. 양쪽 운영이 필요하면 같은 소스의 amd64/arm64 이미지를 검증한다. 에뮬레이션 실행을 네이티브 운영 검증으로 간주하지 않는다.
- DEV와 PROD의 Compose 프로젝트 이름·볼륨·키·데이터를 분리한다. 로컬은 빌드된 개발 태그, 운영은 검증된 배포 태그를 사용한다.
- Nginx 설정 템플릿·기동 스크립트·마이그레이션을 해당 이미지에 포함한다. 운영 디렉터리에서 개별 설정을 bind mount하는 방식을 기본으로 하지 않는다.
- DB 준비 → 일회성 마이그레이션 성공 → API/worker 시작 순서를 둔다. 마이그레이션 실패를 정상 기동으로 표시하지 않는다.
- 운영 DB·업로드 임시 원본은 위 사용자 지정 경로에 보관한다. TLS 인증서는 기존 외부 NPM에서 관리한다. 두 배포 파일 원칙이 영속 데이터·Docker 설치·레지스트리 인증까지 두 파일에 넣는다는 뜻은 아니다.
- TLS 발급/갱신은 컨테이너와 관리 볼륨 또는 기존 인프라에서 처리한다. 외부 발급 인증서·백업 자격증명 파일이 불가피할 때만 최소 예외와 이유를 기록한다. 인증서 개인키를 이미지에 넣지 않는다.
- 레지스트리 인증은 Docker 자격증명 관리로 처리한다. 업데이트에서 DB 볼륨을 삭제하지 않고 정상 배포 절차에 볼륨 삭제 명령을 넣지 않는다.

### 백업·장애·되돌리기

- PostgreSQL을 매일 백업해 암호화한 뒤 운영 서버 밖에 보관한다. 일별 7개·주별 4개를 유지한다.
- 초기 복구 목표는 최대 24시간 데이터 손실·4시간 내 복구다. 목표 달성 여부는 실제 복원 연습으로 검증한다.
- 플랫폼 파일 원본의 보존·백업 범위는 별도 확인한다. 끄적 DB 백업만으로 첨부 원본까지 복구된다고 간주하지 않는다.
- 로컬 점검은 `sh scripts/backup-db.sh .env.dev output/backups`로 실행한다. PostgreSQL 17의 custom dump를 읽기 전용으로 만들고 소유자만 읽는 파일로 저장한다. 출력된 파일을 `sh scripts/check-db-restore.sh <파일.dump>`에 전달하면 네트워크·호스트 볼륨이 없는 임시 DB에 전체 복원하고 테이블별 행 수를 확인한 뒤 임시 컨테이너와 볼륨을 삭제한다. 실제 DB를 덮어쓰는 기능은 없다. 운영 파일이 두 개뿐인 서버에는 이 점검 스크립트를 둘 필요가 없다.
- 이 로컬 덤프는 암호화된 외부 정기 백업을 대신하지 않는다. 외부 저장소·암호화 키·스케줄러가 정해진 뒤 매일 백업과 보존을 연결한다. 덤프에는 계정·세션·댓글 등 민감한 데이터가 포함되므로 Git에 넣거나 공개 경로에 두지 않는다.
- 업로드 볼륨은 완료 전 임시 조각이다. DB만 복원하면 중단된 업로드를 이어갈 수 없으므로 해당 이미지를 다시 추가한다. 완료된 첨부는 DB의 파일 참조와 플랫폼의 원본이 함께 유지되어야 한다. 복원 명령의 기준은 [pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html)·[pg_restore](https://www.postgresql.org/docs/17/app-pgrestore.html)다.
- 배포 전 DB 백업·마이그레이션 검증, 실패 시 이미지 복귀와 DB 호환성을 확인한다. 비가역 DB 변경을 단순 이미지 교체로 되돌린다고 가정하지 않는다.
- 상태 확인·서비스별 로그·실패 Job·재처리·백업/복원·롤백 절차는 실제 구현과 함께 확정하고 검증한다. n8n·알림·통계·로그 장애는 글 저장/조회와 분리한다.

### 현재 실행 절차

운영 서버의 최종 배치는 다음과 같다. `uploads`는 업로드 중인 임시 원본/조각이며 완료된 이미지 원본은 플랫폼에 있다. 글·댓글·분류·사이트/광고/루미 설정은 DB 이전 대상이다.

```text
/volume1/docker/prod/ggeujeok/
  compose.yaml
  .env.prod
/volume2/homes/ggeujeok/
  db/
  uploads/
```

새 운영 폴더를 처음 준비할 때 아래처럼 만든다. 기존 데이터가 있다면 먼저 백업·소유권을 확인하며 초기화하지 않는다. API/worker의 업로드 사용자는 현재 이미지의 UID/GID `1000:1000`이다. DB 디렉터리의 컨테이너 사용자 소유권은 PostgreSQL 이미지 진입점이 설정한다. NAS의 상위 디렉터리 ACL도 해당 접근을 허용해야 한다.

```sh
sudo mkdir -p /volume1/docker/prod/ggeujeok /volume2/homes/ggeujeok/db /volume2/homes/ggeujeok/uploads
sudo chown 1000:1000 /volume2/homes/ggeujeok/uploads
sudo chmod 700 /volume2/homes/ggeujeok/db /volume2/homes/ggeujeok/uploads
```

최초 이전은 DB dump/복원과 기존 플랫폼 파일 접근 검증 후 공개 전환했다. 운영에는 새 글·이미지가 추가되고 있으므로 이전 개발 DB를 다시 복원해 덮어쓰지 않는다. 최초 이전 결과는 [이력](history.md)에 기록한다.

최초 준비 때만 `.env.dev.example`을 `.env.dev`로 복사한다. 이미 설정한 파일은 덮어쓰지 않는다. 플랫폼 입력은 해당 환경의 실제 값을 사용하며 비밀값을 출력하는 `docker compose config` 대신 `config --quiet`로 검사한다.

```sh
docker compose --env-file .env.dev -f compose.build.yaml build
docker compose --env-file .env.dev config --quiet
docker compose --env-file .env.dev stop worker
docker compose --env-file .env.dev up -d db api web nginx
docker compose --env-file .env.dev ps
```

로컬 브라우저 확인 주소는 `http://localhost:30145`, 상태 확인은 같은 주소의 `/api/health`다. 소스 변경 후 영향받은 이미지의 build와 up을 다시 실행한다. 개발 이미지도 소스를 이미지에 포함하며 현재 자동 재빌드는 하지 않는다.

광고의 기본값은 `.env.dev`/`.env.prod`의 `ADS_ENABLED=false`(실제 광고), `ADS_SHOW_PLACEHOLDERS=false`(광고가 꺼졌을 때 자리 표시)다. 관리자 [광고 설정](https://shnea.kr/admin/settings)에서 저장한 값이 우선하며 `환경변수 기본값 사용`으로 저장값을 지운다. 관리자 저장은 DB에 보존되고 다음 글 열람부터 적용되므로 재배포가 필요 없다. API는 설정 변경·초기화의 관리자 감사 기록을 남긴다.

| 실제 광고 | 자리 표시 | 동작 |
| --- | --- | --- |
| false | false | 광고와 자리 모두 숨김 |
| false | true | 자리만 표시, Google 요청 없음 |
| true | 무관 | 유효한 계정·슬롯에서 실제 광고 표시 |

기본 서비스는 `ADS_PROVIDER=adsense` 또는 `adfit`이다. 관리자 화면에서 서비스와 입력값을 함께 저장하며 두 서비스의 값은 전환해도 보존한다. AdSense는 게시자 ID(`ca-pub-`+16자리)와 글 하단 슬롯을 입력하고 오른쪽·중간 슬롯은 선택한다. 애드핏은 위치별 광고단위 ID와 발급된 크기를 입력하며 글 하단 ID가 필수다. 실제 광고를 켤 때 선택한 서비스의 필수 입력을 서버에서 검증한다. 임의 HTML·스크립트 입력은 받지 않는다.

AdSense의 초기값만 기존 `ADSENSE_CLIENT_ID`, `ADSENSE_POST_SLOT`, `ADSENSE_SIDEBAR_SLOT`, `ADSENSE_INLINE_SLOT`에서도 읽는다. 애드핏의 발급값은 관리 화면에서 저장한다. 환경변수 기본값 사용은 저장한 서비스 선택·발급값·스위치를 지우고 환경값으로 복귀하므로 다시 입력할 값은 따로 보관한다. 새 스위치 환경변수가 없을 때 기존 `ADSENSE_ENABLED`·`ADSENSE_SHOW_PLACEHOLDERS`도 호환한다. 기본 환경변수를 바꾼 경우 `docker compose --env-file .env.dev up -d --no-deps api`로 API를 재생성한다. Web은 API 설정을 매번 읽으므로 재빌드·재시작이 필요 없다. `.env.build`에는 이 런타임 값을 넣지 않는다. 공개 설정 조회 실패 시 광고와 자리를 모두 숨긴다.

자리 표시 모드는 발급값 없이 합의된 배치를 확인할 수 있다. 애드핏은 발급 크기를 바꾸거나 축소하지 않고, 영역보다 큰 광고는 SDK를 로드하지 않는다. 기본 추천 크기는 하단 300×250, 오른쪽 160×600, 중간 728×90이며 반드시 실제 발급 크기와 일치해야 한다. 공식 지원 크기·설치 규약은 [애드핏 웹 가이드](https://adfit.github.io/wiki/web-guide/)와 [SDK 안내](https://github.com/adfit/adfit-web-sdk)를 따른다. 네이버 애드포스트는 사용자 요청으로 제외했다.

현재 개발 기본값은 AdSense·실광고 false·자리 표시 true다. 실제 활성화 전 AdSense 승인·슬롯 발급·개인정보 고지·대상 지역의 인증 CMP를 준비하고, 계정의 자동 광고가 합의한 수동 배치를 바꾸지 않는지 확인한다.

목록 광고는 관리자 화면의 `글 목록 인피드 광고`를 켜서 사용한다. AdSense에서 별도의 **인피드 광고 단위**를 생성하고, 발급 코드의 `data-ad-slot`과 `data-ad-layout-key`를 해당 칸에 입력한다. 일반 디스플레이 슬롯을 대신 넣지 않는다. 디자인은 AdSense에서 목록에 맞춰 설정한다. 초기값은 꺼짐이며 별도 환경변수는 없다. 저장값은 011 마이그레이션으로 보관하고 기본값 복원 시 함께 지운다. 배치는 [공개 화면 기준](content.md#public), 설치 형식은 [Google 인피드 안내](https://support.google.com/adsense/answer/9189560?hl=ko)를 따른다.

```sh
npm run typecheck
npm test
docker compose -f compose.test.yaml up --abort-on-container-exit --exit-code-from test
docker compose -f compose.test.yaml down
```

통합 테스트는 외부 포트를 열지 않는 별도 네트워크·임시 메모리 DB를 사용한다. `.env.dev`·실계정·개발 데이터에 접근하지 않는다. 먼저 위 개발 API 이미지를 빌드해야 한다.

### 수정 후 Git 저장과 운영 업데이트

Git push는 소스 저장이고, 이미지 push는 배포할 실행 파일 업로드다. Git만 push해도 운영이 자동 갱신되지는 않는다. 로컬 검수 후 저장소 루트에서 변경 파일을 확인해 커밋한다. 실제 `.env.*`·DB·백업·`output/`은 올리지 않는다.

```sh
git status --short
git diff
# 수정한 파일만 지정
git add <수정한-파일>
git commit -m "변경 내용"
git push origin main
```

로컬 `.env.build`의 `IMAGE_TAG`를 매번 새 고정 태그(예: 날짜-커밋번호)로 바꾸고 `TARGET_PLATFORM=linux/amd64`, `BUILD_TARGET=production`을 유지한다. 기존 배포 태그는 덮어쓰지 않는다. 레지스트리는 현재 별도 로그인 없이 사용한다.

```sh
docker compose --env-file .env.build -f compose.build.yaml build
docker compose --env-file .env.build -f compose.build.yaml push
```

현재 NAS는 `docker compose` 대신 `/usr/local/bin/docker-compose`를 사용한다. `compose.yaml` 자체가 바뀐 경우에만 로컬의 최신 파일을 아래 경로로 함께 전달한다. 운영 `.env.prod`를 개발 파일로 덮어쓰지 않는다.

```sh
scp -P 9022 compose.yaml shpark@192.168.0.93:/volume1/docker/prod/ggeujeok/compose.yaml
ssh -p 9022 shpark@192.168.0.93
cd /volume1/docker/prod/ggeujeok
```

운영 `.env.prod`의 기존 `IMAGE_TAG`를 기록하고 새 이미지와 같은 값으로 바꾼다. 배포 전 운영 DB 백업을 확보한다. 특히 마이그레이션이 있다면 복원 절차와 이전 이미지 호환성을 확인한다. 이후 NAS에서 실행한다.

```sh
/usr/local/bin/docker-compose --env-file .env.prod config --quiet
/usr/local/bin/docker-compose --env-file .env.prod pull
/usr/local/bin/docker-compose --env-file .env.prod up -d
/usr/local/bin/docker-compose --env-file .env.prod ps
/usr/local/bin/docker-compose --env-file .env.prod logs --tail=80 migrate api worker web nginx
```

마이그레이션 종료 0·서비스 상태와 `https://shnea.kr/api/health`, 실제 수정한 화면을 확인한다. 앱 코드는 이미지로 갱신되고 `/volume2/homes/ggeujeok`의 데이터는 유지한다. 운영에서 Git pull이나 소스 빌드는 필요 없다. 정상 업데이트에 `down -v`나 DB 폴더 삭제를 사용하지 않는다. DB 변경이 이전 이미지와 호환될 때는 태그를 이전 값으로 되돌려 pull/up으로 복귀할 수 있다.

<a id="site-settings"></a>

### n8n 연결 관리

기능 정책은 [AI 도우미](content.md#automation)를 따른다. 끄적 전용 워크플로는 `scripts/n8n-workflows.mjs`에서 만들고 다음 명령으로 등록·갱신한다.

```sh
# DEV 연동을 준비한 뒤에만 실행
node --env-file=.env.dev scripts/provision-n8n.mjs
# 운영 워크플로를 수정해야 할 때만 로컬에서 실행
node --env-file=.env.dev --env-file=.env.prod scripts/provision-n8n.mjs
```

- 로컬 관리용 `N8N_MANAGEMENT_API_KEY`는 n8n 관리 API 키다. API/worker 컨테이너나 브라우저에 넣지 않는다. 기존 OpenRouter 자격증명을 참조하며 그 키를 복사하거나 변경하지 않는다.
- 실행 환경은 `N8N_WEBHOOK_BASE_URL`, `N8N_WEBHOOK_TOKEN`, `AI_CALLBACK_TOKEN`을 API/worker에 주입한다. 웹훅 인증과 결과 보관 인증은 별도 키를 쓴다. 실제 값은 해당 환경 파일과 n8n 자격증명에만 둔다.
- 등록 스크립트는 개발 `output/n8n/ggeujeok-resources.json`, 운영 `output/n8n/ggeujeok-resources-production.json`에 기록한 끄적 리소스만 갱신한다. 기존 워크플로가 보존됐는지 비교하고, 사용자가 고른 워크플로별 모델도 유지한다. 이 로컬 관리 자료를 잃었다면 재등록 전에 기존 끄적 리소스 ID를 확인한다.
- 개발 일반 큐와 호출 전용 큐를 분리한다. 플랫폼 키의 프로젝트·환경을 검사하며 일반 작업과 `@루미` 호출 소비자를 독립 실행한다. 이미지에 비밀값을 넣지 않는다.
- 워크플로 실행 내용의 n8n 저장은 끈다. 무료 모델 시간 초과·형식 실패는 관리자 작업 목록에서 확인한다. 실행 결과가 불명확한 요청을 무조건 재실행하지 않는다.


### 사이트 정보·검색 등록·방문 분석

관리자 `/admin/settings`에서 블로그 이름·기본 설명·공개 운영자명·문의 이메일·공유 이미지 HTTPS URL, Google/네이버 소유확인 토큰, GA4 측정 ID와 GTM 컨테이너 ID를 저장한다. 관리자·CSRF 검증과 `site.update` 감사 기록을 적용하며 임의 HTML·스크립트는 받지 않는다. 012 마이그레이션의 별도 설정 테이블을 사용하므로 광고 기본값 복원에 영향받지 않는다. 저장 후 새 페이지 요청에 적용하고 재배포하지 않는다.

- 기본 정보는 머리글·바닥글·공유/검색 메타·RSS·소개/정책의 연락처에 반영한다. 기본 설명을 임의로 본문 소개 문구로 노출하지 않는다. 공유 이미지가 비어 있으면 기존 기본 이미지를 쓰고 게시글 대표 이미지가 우선한다.
- 인증값은 발급 HTML 태그의 `content` 값만 입력한다. 초기 HTML의 `head`에 `google-site-verification`과 `naver-site-verification`을 넣는다. 저장 후 각 서비스에서 소유확인을 눌러야 한다. Google 도메인 속성은 별도 DNS 인증이 필요하며 이 설정은 URL 접두어 속성용이다. 사이트맵/RSS 제출과 색인 완료를 자동 처리하거나 보장하지 않는다.
- 분석 방식은 `사용 안 함`(초기값), `GA4 직접 연결`, `Google 태그 관리자` 중 하나만 사용한다. 전환해도 두 ID를 보관하고 공개 응답은 현재 방식의 ID만 제공한다. 설정 조회 실패 시 분석을 끈다.
- 태그는 공개 목록·글·소개/정책 페이지에서만 실행한다. 관리자·로그인·내 활동에는 넣지 않는다. 현재 탐색은 일반 링크로 새 문서를 열므로 Google 기본 페이지뷰를 한 번 전송한다. GA4 직접 연결의 최초 페이지 주소는 쿼리·해시를 제외한다. 계정 ID·이메일·댓글을 별도 이벤트로 보내지 않는다. 이후 SPA 탐색을 도입하면 페이지뷰 중복/누락을 다시 검증한다.
- GTM은 JavaScript 로더를 연결한다. JavaScript 없는 브라우저용 iframe은 넣지 않으며 소유확인은 위 HTML 메타 방식으로 한다. GA4 태그와 게시·추가 수집·동의 설정은 GTM에서 관리한다. GTM 내부 중복 태그는 블로그 설정으로 검사할 수 없다. 새로운 태그를 게시하면 실제 수집 내용에 맞게 개인정보 고지를 갱신한다.
- 실제 GA4 실시간 수신·Tag Assistant·외부 소유확인·색인 검수는 발급값 입력 후 수행한다. 보관 기간·향상된 측정·동의 설정은 Google 계정에서 별도로 확인한다.

공식 기준: [Google 소유확인](https://support.google.com/webmasters/answer/9008080?hl=ko), [네이버 사이트맵 제출](https://searchadvisor.naver.com/guide/request-feed), [Google 태그 설치](https://developers.google.com/tag-platform/gtagjs), [GTM 설치](https://developers.google.com/tag-platform/tag-manager/web).

<a id="inputs"></a>
## 실제 연결·운영에 필요한 입력

도메인·외부 NPM·끄적 30145 포트는 사용자 확인 사항이다. 플랫폼 값은 사용자가 `.env.dev`에 입력한다. 나머지 실제 입력·운영 검증은 완료 전까지 미준비로 관리하며 원문 비밀값은 대화·문서로 받지 않는다.

| 항목 | 확인할 값 |
| --- | --- |
| 플랫폼·로그인 | [플랫폼 필수 입력](platform-integration.md#inputs) |
| n8n | 운영 전용 워크플로 4개·키·큐를 분리했고 기존 워크플로는 유지. 실제 생성 검증 범위는 [현재 상태](../STATUS.md) 참조. 로컬 런타임 연결은 보류 |
| 배포 | 서버·CPU 아키텍처·도메인/TLS 관리 방식·레지스트리 접근 |
| 복구 | 외부 백업 저장소·자격증명 주입 방식·플랫폼 파일 백업 범위·운영 확인 경로 |
| Google | GA 측정 ID·Search Console 확인값·AdSense 계정/광고 설정과 외부 승인 상태 |

날짜는 UTC 저장·ISO 8601 전송, 운영 화면은 Asia/Seoul 기준으로 표시한다.

## 수용 조건

- 조회수 중복·쿠키 부재·관리자·봇 제외·보존 정리·추정치 표시와 개인정보 페이지가 실제 처리와 일치한다.
- 로그 장애·한도·민감정보 제외·감사 기록·미완료 작업 재처리를 확인한다.
- `.env.build`만 있는 로컬 빌드 환경에서 운영 키 없이 이미지를 만들 수 있다.
- `.env.prod`와 `compose.yaml`만 복사한 깨끗한 배포 디렉터리에서 구성 검사·pull·기동·마이그레이션·health check가 가능하다.
- 실제 설정이 있는 DEV/PROD를 구분해 검증하고 이미지 갱신·재시작 후 데이터가 유지되는지 확인한다.
- 실제 백업을 별도 환경에 복원하고 복구 목표·첨부 접근·롤백을 확인한다. 미실행 검증을 완료로 표시하지 않는다.

참고: [환경 파일 선택](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/), [컨테이너 환경 주입](https://docs.docker.com/compose/how-tos/environment-variables/set-environment-variables/), [빌드](https://docs.docker.com/reference/cli/docker/compose/build/), [push](https://docs.docker.com/reference/cli/docker/compose/push/), [기동 순서](https://docs.docker.com/compose/how-tos/startup-order/). 해당 자료는 기능 작업 시에만 읽는다.
