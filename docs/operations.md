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
## Docker·배포

### 평소 사용

| 작업 | 명령 | 실행 위치 |
| --- | --- | --- |
| 개발 실행 | `./scripts/dev.ps1` | 개발 PC |
| 직접 이미지 게시 | `./scripts/release.ps1` | 개발 PC 또는 CI |
| 일반 운영 업데이트 | `git push origin main` | 개발 PC |
| 지정 버전 배포 | `sudo sh scripts/deploy.sh <SHA_12자리>` | NAS 운영 폴더 |
| 운영 상태·로그 | `sudo sh scripts/deploy.sh status` / `logs` | NAS 운영 폴더 |

`main` push → GitHub 검증 → 이미지 3개 빌드·게시 → NAS 배포 전용 Runner → 기존 deploy 순서다. 개발 PC는 push 후 꺼도 된다. NAS는 이미지를 내려받아 실행하며 소스 빌드를 하지 않는다. 자동 배포와 같은 커밋을 수동 release로 중복 게시하지 않는다.

### 파일과 환경

- 운영 기본은 `compose.yaml`, 개발 차이는 `compose.dev.yaml`이다. 격리 검증용 `compose.test.yaml`은 별도로 유지한다. 운영에 개발·테스트 Compose를 적용하지 않는다.
- `.env.dev`와 `.env.prod`는 Dotenvx 2.24.0으로 암호화해 Git에 포함한다. 변수 설명은 `.env.example` 한 곳에 둔다. `.env.build`는 사용하지 않는다.
- 별도 보관할 환경 키 파일은 `.env.keys` 하나다. 개발 PC에는 필요한 키를, NAS에는 운영 키만 둔다. 키는 Git·이미지·CI 산출물에서 제외한다. `.tools`에는 Dotenvx 실행 파일, `.deploy`에는 자동 배포 기록이 생긴다.
- Dotenvx를 `.tools/dotenvx.exe`(Windows) 또는 `.tools/dotenvx`(NAS)에 설치하거나 PATH로 제공한다. 기존 키를 바꾸지 않는 한 환경파일은 Git과 배포 묶음으로 전달되며 매번 수동 복사하지 않는다.
- 환경값은 `dotenvx set <변수> <값> -f .env.dev`처럼 수정한다. 비밀값을 채팅·로그·셸 이력에 남기지 않는다. 기존 DB 비밀번호는 환경파일만 바꿔도 자동 변경되는 값이 아니다.
- 기존 Compose 프로젝트 이름 `ggeujeok-dev`·`ggeujeok-prod`, 데이터 경로·네트워크·운영 설정값은 보존한다. 실제 운영 경로와 접속 주소는 암호화 설정·GitHub Secrets에만 둔다.
- 앱의 기존 `APP_ENV=development/production` 값은 앱 계약대로 유지한다. 파일과 작업 환경은 `dev/prod`로 구분한다.

<a id="env-management"></a>
### 환경값 확인·변경·복호화·암호화

**개발 PC의 해당 프로젝트 폴더에서 PowerShell로 실행한다.** `.tools/dotenvx.exe`와 그 프로젝트의 `.env.keys`가 필요하다. 아래는 운영 `.env.prod` 예시이며 개발은 `.env.dev`로 바꾼다. 다른 프로젝트의 키로는 복호화할 수 없다. 키가 없으면 기존 키를 받아야 하며 새로 생성해서 대체하지 않는다.

#### 1. 내용만 확인 — 파일은 암호화 상태 유지

```powershell
# 전체 값 보기
.\.tools\dotenvx.exe get -f .env.prod --format shell --no-armor --no-native

# 한 항목만 보기
.\.tools\dotenvx.exe get REGISTRY_HOST -f .env.prod --no-armor --no-native

# 원래 env 파일 형식으로 화면에만 복호화
.\.tools\dotenvx.exe decrypt -f .env.prod --stdout --no-armor --no-native
```

조회 결과에는 실제 비밀값이 포함될 수 있으므로 공유 로그·채팅에 붙여 넣지 않는다. `--stdout`은 파일을 바꾸지 않으며, 아래의 일반 `decrypt`와 다르다.

#### 2. 한두 값 변경 — set이 자동 암호화

```powershell
# 공개 설정 예시: 필요한 변수명과 값으로 바꿔 실행
.\.tools\dotenvx.exe set REGISTRY_HOST 'registry.shnea.kr' -f .env.prod --no-armor --no-native
```

**별도 복호화·재암호화 단계가 필요 없다.** `set`은 기본적으로 새 값을 암호화해 저장한다. 비밀번호·토큰을 명령줄에 직접 입력하면 셸 이력에 남을 수 있으므로 비밀값을 직접 편집할 때는 아래 방법을 사용한다.

#### 3. 여러 값 직접 편집 — 복호화 → 편집 → 재암호화

이 방법은 `.env.prod` 자체를 잠시 평문으로 바꾼다. 편집을 마치고 재암호화할 때까지 커밋·푸시하지 않는다.

```powershell
# 1) 파일을 평문으로 변환. 성공했을 때만 다음 단계 진행
.\.tools\dotenvx.exe decrypt -f .env.prod --no-armor --no-native

# 2) 편집기를 열어 값 수정 → UTF-8로 저장 → 편집기 닫기
notepad .env.prod

# 3) 저장을 마친 뒤 다시 암호화
.\.tools\dotenvx.exe encrypt -f .env.prod --no-armor --no-native

# 4) 평문 설정·키가 포함되지 않았는지 검사
python scripts/check-ci.py
```

각 단계를 따로 실행하고 명령이 실패하면 중단한다. 키·`DOTENV_PUBLIC_KEY_PROD` 등 암호화 메타데이터는 편집하지 않는다. 검사가 실패했다면 커밋하지 말고 암호화 상태부터 확인한다. 편집기의 평문 복사본·백업 파일도 Git에 올리지 않는다.

#### 4. 변경 반영

- 개발: 암호화된 `.env.dev`를 저장한 뒤 `./scripts/dev.ps1`로 컨테이너를 갱신한다.
- 운영: 암호화 검사 후 `.env.prod` 변경을 커밋·푸시한다. 자동 배포가 연결된 프로젝트에서는 GitHub Actions의 **deploy 성공**까지 확인한다. 파일을 바꾸는 것만으로 실행 중인 컨테이너가 갱신되지는 않는다.
- NAS에서는 조회가 필요할 때 운영 폴더에서 `sudo ./.tools/dotenvx get -f .env.prod --format shell --no-armor --no-native`를 사용한다. 변경은 개발 PC의 Git 관리 파일에서 진행한다. NAS에서만 고친 값은 다음 배포 때 덮어써질 수 있다.
- `.env.keys`는 별도 보관하고 커밋하지 않는다. 일반적인 값 변경에는 키 교체나 키 재배포가 필요 없다. DB 비밀번호는 환경파일 수정만으로 실제 DB 계정 비밀번호가 바뀌지 않으므로 별도로 맞춰야 한다.

명령 기준: 설치된 Dotenvx **2.24.0**의 도움말과 [공식 암호화 안내](https://dotenvx.com/docs/quickstart/). 안내 명령은 임시 예제 파일에서 조회·변경·복호화·재암호화와 기존 키 유지까지 확인했다.

### 이미지와 서비스

- 직접 만드는 이미지는 `${REGISTRY_HOST}/${IMAGE_NAME}-api`, `-web`, `-nginx` 3개다. 기본 Registry는 `registry.shnea.kr`, 이미지 이름은 `ggeujeok`이다. API 이미지를 migrate·api·worker가 함께 쓴다.
- release는 운영 비밀값 없이 빌드하며 전체 Git SHA 앞 12자리로 태그를 만든다. 이미 게시된 태그는 덮어쓰지 않는다. CPU 기본 대상은 NAS에 맞춘 `linux/amd64`이며 필요할 때 release의 `-Platform`으로 지정한다.
- 로컬 개발 이미지는 `ggeujeok-*:dev`이며 기존 named volume을 사용한다. 기본 dev는 worker를 실행하지 않는다. 실제 DEV 연동이 준비됐을 때만 `./scripts/dev.ps1 --profile worker up -d --build --wait`로 시작한다.
- DB → 마이그레이션 성공 → API/worker → web → nginx 순서를 지킨다. 운영 갱신은 전체 Pull·이미지 검증 후 `up -d --no-build --wait`로 실행하고 nginx를 통한 `/api/health` 응답을 확인한다.
- 운영 공개 주소는 `https://shnea.kr`이며 기존 HTTPS 프록시와 30145 포트를 유지한다. 개발 주소는 `http://localhost:30145`이다.
- DB·업로드 임시 데이터는 운영 환경의 `DB_DATA_PATH`·`UPLOAD_DATA_PATH`에 유지한다. 전환 중 볼륨 삭제·DB 덮어쓰기·사용자 설정 초기화는 하지 않는다.

### CI/CD와 연결

- Pull Request는 GitHub 서버에서 검증만 한다. `main`의 검증·빌드는 GitHub 서버에서, 배포만 `ggeujeok-deploy` Runner에서 실행한다.
- 국가 제한을 유지하기 위해 Runner가 NAS 내부 SSH로 배포한다. Runner에는 Docker 소켓·앱 데이터·복호화 키를 마운트하지 않는다. 저장소별 전용 Runner 등록정보는 Docker volume에 자동 보관한다.
- 최초 연결 때 `scripts/install-deploy-runner.sh`와 제한 SSH 진입점을 설치한다. SSH 키는 `check`·`deploy <전체 SHA>`만 허용한다. 실제 호스트·포트·계정·키·호스트 키·배포 경로는 GitHub Secrets에 등록한다.
- Registry 인증이 필요한 환경은 `REGISTRY_USERNAME`·`REGISTRY_PASSWORD`를 Secret으로 등록한다. 인증을 쓰지 않는 기존 Registry는 로그인 단계 없이 사용할 수 있다.
- CI/CD는 같은 SHA의 이미지 digest와 허용된 운영 파일만 전달한다. 동시에 같은 운영 대상을 배포하지 않는다. `deploy` 성공까지 확인해야 배포 완료다.

### 실패와 이전 버전

| 실패 단계 | 상태와 조치 |
| --- | --- |
| 검증·빌드 | 기존 운영 유지. 코드·빌드 오류 수정 |
| 일부 이미지 게시 | 해당 릴리스 배포 금지. 이미 게시된 태그를 덮어쓰지 않고 새 커밋으로 수정 |
| 배포 전 Pull·구성 검사 | 컨테이너 변경 전에 중단. Registry·설정 확인 |
| 컨테이너 갱신·상태 검사 | 실패 기록과 실제 컨테이너 상태 확인. 무조건 자동 롤백하지 않음 |

release는 성공했고 deploy만 실패했다면 GitHub의 **Re-run failed jobs**로 같은 산출물을 다시 배포한다. 산출물은 90일 보관한다. 전체 워크플로 재실행은 태그 덮어쓰기 방지에 걸릴 수 있다.

이전 버전이 현재 DB·설정과 호환될 때 `sudo sh scripts/deploy.sh <이전_SHA>`를 사용한다. 운영에서 다시 빌드하지 않는다. `.deploy/current`, `.deploy/previous`, `.deploy/history`, `.deploy/configs`에서 버전·상태·이전 구성을 확인한다. 이미지 변경은 DB나 파일 복원이 아니다.

전환 전 날짜 태그는 `.deploy/legacy-tag`와 실제 이미지 ID로 기록한다. 필요한 경우에만 `sudo sh scripts/deploy.sh --legacy <보호된_기존_태그>`로 같은 검증을 거쳐 배포한다. 새로운 릴리스부터 SHA 규칙을 따른다.

Registry 정리는 Registry 운영 영역에서 이미 공통 관리한다. 이미지별 최근 5개 또는 최근 30일과 NAS 사용 중 이미지를 보존하며 이 프로젝트에 정리 코드·예약 작업을 추가하지 않는다. DB 복구 훈련은 이번 배포 표준 전환 범위에 포함하지 않는다.

### 개발 검증

```powershell
./scripts/dev.ps1 config --quiet
./scripts/dev.ps1
./scripts/dev.ps1 ps
```

기존 격리 테스트는 개발 API 이미지가 준비된 뒤 실행한다. 실제 계정·운영 DB·운영 키를 사용하지 않는다.

```sh
docker compose -f compose.test.yaml up --abort-on-container-exit --exit-code-from test
docker compose -f compose.test.yaml down
```

기존 백업 도구는 별도 점검 용도로 남기며 자동 배포에서 실행하지 않는다. 사용법은 `sh scripts/backup-db.sh .env.dev output/backups`다. 기존 외부 백업·복구 요구의 이행 상태는 STATUS.md에 구분해 기록하며 이 전환으로 완료됐다고 보지 않는다.


### 백업·장애·되돌리기

- PostgreSQL을 매일 백업해 암호화한 뒤 운영 서버 밖에 보관한다. 일별 7개·주별 4개를 유지한다.
- 초기 복구 목표는 최대 24시간 데이터 손실·4시간 내 복구다. 목표 달성 여부는 실제 복원 연습으로 검증한다.
- 플랫폼 파일 원본의 보존·백업 범위는 별도 확인한다. 끄적 DB 백업만으로 첨부 원본까지 복구된다고 간주하지 않는다.
- 로컬 점검은 `sh scripts/backup-db.sh .env.dev output/backups`로 실행한다. PostgreSQL 17의 custom dump를 읽기 전용으로 만들고 소유자만 읽는 파일로 저장한다. 출력된 파일을 `sh scripts/check-db-restore.sh <파일.dump>`에 전달하면 네트워크·호스트 볼륨이 없는 임시 DB에 전체 복원하고 테이블별 행 수를 확인한 뒤 임시 컨테이너와 볼륨을 삭제한다. 실제 DB를 덮어쓰는 기능은 없다. 이 도구는 개발 체크아웃에서 별도 점검할 때만 사용하며 자동 배포에 포함하지 않는다.
- 이 로컬 덤프는 암호화된 외부 정기 백업을 대신하지 않는다. 외부 저장소·암호화 키·스케줄러가 정해진 뒤 매일 백업과 보존을 연결한다. 덤프에는 계정·세션·댓글 등 민감한 데이터가 포함되므로 Git에 넣거나 공개 경로에 두지 않는다.
- 업로드 볼륨은 완료 전 임시 조각이다. DB만 복원하면 중단된 업로드를 이어갈 수 없으므로 해당 이미지를 다시 추가한다. 완료된 첨부는 DB의 파일 참조와 플랫폼의 원본이 함께 유지되어야 한다. 복원 명령의 기준은 [pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html)·[pg_restore](https://www.postgresql.org/docs/17/app-pgrestore.html)다.
- 배포 전 DB 백업·마이그레이션 검증, 실패 시 이미지 복귀와 DB 호환성을 확인한다. 비가역 DB 변경을 단순 이미지 교체로 되돌린다고 가정하지 않는다.
- 상태 확인·서비스별 로그·실패 Job·재처리·백업/복원·롤백 절차는 실제 구현과 함께 확정하고 검증한다. n8n·알림·통계·로그 장애는 글 저장/조회와 분리한다.

### 플랫폼 AI 연결 관리

기능 정책은 [AI 도우미](content.md#automation), 외부 계약은 [플랫폼 AI 자료](platform-integration.md)를 따른다. API·worker에는 환경별 `PLATFORM_URL`·`PLATFORM_API_KEY`·`PLATFORM_PROJECT_ID`·`PLATFORM_ENVIRONMENT_ID`를 주입한다. 기존 플랫폼 Job도 계속 사용하며 worker 전용 키를 별도로 설정한 경우 `PLATFORM_WORKER_API_KEY`를 유지한다. AI 실행에는 `ai:execute`·`ai:jobs:read`, Job 처리에는 `jobs:write/read/work` 권한이 필요하다. 키의 `integration/context` 프로젝트·환경과 설정값을 대조하고 DEV/PROD를 섞지 않는다.

기존 끄적 전용 n8n 워크플로는 보존하지만 새 AI 작업의 호출 경로가 아니다. 아래 명령은 해당 **기존 워크플로를 별도로 관리해야 할 때만** 사용한다. 새 AI 연동을 위해 실행하지 않는다.

```sh
# DEV 연동을 준비한 뒤에만 실행
dotenvx run --strict --overload --no-armor --no-native -f .env.dev -- node scripts/provision-n8n.mjs
# 운영 워크플로를 수정해야 할 때만 로컬에서 실행
dotenvx run --strict --overload --no-armor --no-native -f .env.prod -- node scripts/provision-n8n.mjs
```

- 로컬 관리용 `N8N_MANAGEMENT_API_KEY`는 n8n 관리 API 키다. 운영 파일에 이 값이 없다면 실행할 PowerShell 세션에 `$env:N8N_MANAGEMENT_API_KEY = .\.tools\dotenvx.exe get N8N_MANAGEMENT_API_KEY -f .env.dev --no-armor --no-native`로 기존 관리 키만 읽어 제공하고, 관리 명령이 끝나면 `Remove-Item Env:N8N_MANAGEMENT_API_KEY`로 지운다. 다른 개발 설정을 운영 명령에 함께 로드하지 않는다. API/worker 컨테이너나 브라우저에 넣지 않는다. 기존 OpenRouter 자격증명을 참조하며 그 키를 복사하거나 변경하지 않는다.
- 기존 워크플로에는 `N8N_WEBHOOK_BASE_URL`, `N8N_WEBHOOK_TOKEN`, `AI_CALLBACK_TOKEN`이 필요하다. 새 플랫폼 AI 작업은 이 값과 결과 보관 API를 사용하지 않는다. 기존 실행 중 작업이 남아 있는 동안은 콜백 설정을 제거하지 않는다.
- 등록 스크립트는 개발 `output/n8n/ggeujeok-resources.json`, 운영 `output/n8n/ggeujeok-resources-production.json`에 기록한 끄적 리소스만 갱신한다. 기존 워크플로가 보존됐는지 비교하고, 사용자가 고른 워크플로별 모델도 유지한다. 이 로컬 관리 자료를 잃었다면 재등록 전에 기존 끄적 리소스 ID를 확인한다.
- 개발 일반 큐와 호출 전용 큐를 분리한다. 플랫폼 키의 프로젝트·환경을 검사하며 일반 작업과 `@루미` 호출 소비자를 독립 실행한다. 이미지에 비밀값을 넣지 않는다.
- 새 플랫폼 AI 작업은 원격 ID로 결과를 조회한다. 모델 실패·형식 실패·결과 미확인은 관리자 작업 목록에서 확인하고, 불명확한 접수에 새 AI 요청 ID를 발급하지 않는다. 실제 공급자 호출과 사용량은 DEV 작업으로 별도 검수한다.


### 광고 설정

광고의 기본값은 `.env.dev`/`.env.prod`의 `ADS_ENABLED=false`(실제 광고), `ADS_SHOW_PLACEHOLDERS=false`(광고가 꺼졌을 때 자리 표시)다. 관리자 [광고 설정](https://shnea.kr/admin/settings)에서 저장한 값이 우선하며 `환경변수 기본값 사용`으로 저장값을 지운다. 관리자 저장은 DB에 보존되고 다음 글 열람부터 적용되므로 재배포가 필요 없다. API는 설정 변경·초기화의 관리자 감사 기록을 남긴다.

| 실제 광고 | 자리 표시 | 동작 |
| --- | --- | --- |
| false | false | 광고와 자리 모두 숨김 |
| false | true | 자리만 표시, Google 요청 없음 |
| true | 무관 | 유효한 계정·슬롯에서 실제 광고 표시 |

기본 서비스는 `ADS_PROVIDER=adsense` 또는 `adfit`이다. 관리자 화면에서 서비스와 입력값을 함께 저장하며 두 서비스의 값은 전환해도 보존한다. AdSense는 게시자 ID(`ca-pub-`+16자리)와 글 하단 슬롯을 입력하고 오른쪽·중간 슬롯은 선택한다. 애드핏은 위치별 광고단위 ID와 발급된 크기를 입력하며 글 하단 ID가 필수다. 실제 광고를 켤 때 선택한 서비스의 필수 입력을 서버에서 검증한다. 임의 HTML·스크립트 입력은 받지 않는다.

`/ads.txt`는 저장한 AdSense 게시자 ID로 자동 제공한다. `ca-pub-`를 `pub-`로 변환해 Google DIRECT 행을 반환하며 광고 활성화·슬롯 발급 여부와 무관하게 유지한다. 게시자 ID가 없으면 404이고, 조회 실패는 오류로 응답해 빈 성공 파일을 만들지 않는다. 별도 파일 편집 없이 광고 설정을 변경하면 반영된다. 형식은 [Google ads.txt 안내](https://support.google.com/adsense/answer/12171612?hl=ko)를 따른다.

AdSense의 초기값만 기존 `ADSENSE_CLIENT_ID`, `ADSENSE_POST_SLOT`, `ADSENSE_SIDEBAR_SLOT`, `ADSENSE_INLINE_SLOT`에서도 읽는다. 애드핏의 발급값은 관리 화면에서 저장한다. 환경변수 기본값 사용은 저장한 서비스 선택·발급값·스위치를 지우고 환경값으로 복귀하므로 다시 입력할 값은 따로 보관한다. 새 스위치 환경변수가 없을 때 기존 `ADSENSE_ENABLED`·`ADSENSE_SHOW_PLACEHOLDERS`도 호환한다. 기본 환경변수를 바꾼 경우 `./scripts/dev.ps1 up -d --no-deps api`로 API를 재생성한다. Web은 API 설정을 매번 읽으므로 재빌드·재시작이 필요 없다. release에는 이 런타임 값을 전달하지 않는다. 공개 설정 조회 실패 시 광고와 자리를 모두 숨긴다.

자리 표시 모드는 발급값 없이 합의된 배치를 확인할 수 있다. 애드핏은 발급 크기를 바꾸거나 축소하지 않고, 영역보다 큰 광고는 SDK를 로드하지 않는다. 기본 추천 크기는 하단 300×250, 오른쪽 160×600, 중간 728×90이며 반드시 실제 발급 크기와 일치해야 한다. 공식 지원 크기·설치 규약은 [애드핏 웹 가이드](https://adfit.github.io/wiki/web-guide/)와 [SDK 안내](https://github.com/adfit/adfit-web-sdk)를 따른다. 네이버 애드포스트는 사용자 요청으로 제외했다.

현재 개발 기본값은 AdSense·실광고 false·자리 표시 true다. 실제 활성화 전 AdSense 승인·슬롯 발급·개인정보 고지·대상 지역의 인증 CMP를 준비하고, 계정의 자동 광고가 합의한 수동 배치를 바꾸지 않는지 확인한다.

목록 광고는 관리자 화면의 `글 목록 인피드 광고`를 켜서 사용한다. AdSense에서 별도의 **인피드 광고 단위**를 생성하고, 발급 코드의 `data-ad-slot`과 `data-ad-layout-key`를 해당 칸에 입력한다. 일반 디스플레이 슬롯을 대신 넣지 않는다. 디자인은 AdSense에서 목록에 맞춰 설정한다. 초기값은 꺼짐이며 별도 환경변수는 없다. 저장값은 011 마이그레이션으로 보관하고 기본값 복원 시 함께 지운다. 배치는 [공개 화면 기준](content.md#public), 설치 형식은 [Google 인피드 안내](https://support.google.com/adsense/answer/9189560?hl=ko)를 따른다.

```sh
npm run typecheck
npm test
docker compose -f compose.test.yaml up --abort-on-container-exit --exit-code-from test
docker compose -f compose.test.yaml down
```

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
- release는 운영 키·환경파일 없이 이미지를 빌드하고 SHA 태그로 게시한다.
- 운영 Compose·암호화 환경·deploy와 별도로 제공한 운영 키로 구성 검사·pull·기동·마이그레이션·health check가 가능하다.
- 실제 설정이 있는 DEV/PROD를 구분해 검증하고 이미지 갱신·재시작 후 데이터가 유지되는지 확인한다.
- 실제 백업을 별도 환경에 복원하고 복구 목표·첨부 접근·롤백을 확인한다. 미실행 검증을 완료로 표시하지 않는다.

참고: [환경 파일 선택](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/), [컨테이너 환경 주입](https://docs.docker.com/compose/how-tos/environment-variables/set-environment-variables/), [빌드](https://docs.docker.com/reference/cli/docker/compose/build/), [push](https://docs.docker.com/reference/cli/docker/compose/push/), [기동 순서](https://docs.docker.com/compose/how-tos/startup-order/). 해당 자료는 기능 작업 시에만 읽는다.
