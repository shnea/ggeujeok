# 프로젝트 이관 안내

2026-11-22 기준으로 새 작업 환경에서 이어받을 때 필요한 정보다. 실제 서버·저장소 이전과 데이터 복원은 이 문서 정리 작업에서 실행하지 않았다.

## 현재 기준

| 항목 | 확인한 상태 |
| --- | --- |
| 저장소 | [shnea/ggeujeok](https://github.com/shnea/ggeujeok), 기본 브랜치 `main` |
| 최근 운영 코드 | `49b65cd9e3a7` — [마지막 성공 배포](https://github.com/shnea/ggeujeok/actions/runs/43226454841). 뒤의 문서 커밋은 운영 이미지 버전과 다를 수 있다. |
| 운영 주소 | [블로그](https://shnea.kr), [관리자 설정](https://shnea.kr/admin/settings), [원격 MCP](https://shnea.kr/api/mcp) |
| 이번 확인 | `origin` 갱신 후 코드 차이 없음. 공개 `/api/health` 200, 키 없는 MCP 요청 401, 개발 Compose 구성 검사 성공. |
| 개발 주소 | `http://localhost:30145`. 현재 개발 OIDC·관리자 설정은 비어 있어 실제 로그인은 별도 연결 대상이다. |
| DB | PostgreSQL 17, 마이그레이션 `001`~`022`. 마이그레이션은 실행 이미지에 포함되고 기동 시 적용된다. |

현재 작업과 미확인 사항은 [STATUS.md](../STATUS.md), 과거 검증·배포 내역은 [이력](history.md)을 따른다. 새 환경에서의 실행 성공은 아직 확인하지 않았다.

## 따로 인계할 자료

| 대상 | Git 포함 여부와 인계 방법 |
| --- | --- |
| 소스·문서·잠금 파일·에디터 패키지 | Git에 포함된다. `vendor/shnea-editor-0.1.0-alpha.11.tgz`도 함께 받아야 빌드된다. [원본·체크섬](../vendor/README.md)을 참고한다. |
| `.env.dev`, `.env.prod` | 암호화된 상태로 Git에 포함된다. 변수 설명은 [`.env.example`](../.env.example)을 따른다. |
| `.env.keys` | Git 제외. 현재 PC에는 DEV·PROD 복호화 키가 있다. 필요한 환경의 키를 비밀값 전달 경로로 별도 인계한다. 운영 서버에는 PROD 키만 둔다. 기존 암호문에 새 키를 생성해 덮어쓰지 않는다. |
| Dotenvx 실행 파일 | `.tools`는 Git 제외. 기존에 검증한 버전은 2.24.0이다. 새 환경에 맞는 실행 파일을 `.tools` 또는 PATH에 준비한다. [환경 파일 관리](operations.md#env-management)를 따른다. |
| DB·업로드 데이터 | Git 제외. 운영의 `DB_DATA_PATH`·`UPLOAD_DATA_PATH`, 개발의 Compose named volume에 있다. 다른 호스트로 옮길 경우 최신 백업·복원 점검과 파일 인계가 필요하다. |
| 배포 기록 | 운영 `.deploy/current`, `previous`, `source-commit`, `current-images`, `configs`, `history`를 별도 보관한다. 현재/이전 이미지 태그·digest와 복구에 필요한 설정을 확인하는 자료다. |
| GitHub·NAS 접근과 CI 비밀값 | Git clone으로 전달되지 않는다. 담당 계정의 저장소 권한, Runner, GitHub Secrets, 제한 SSH 키·호스트 키, Registry 접근을 별도 인계한다. |
| 플랫폼·에이전트 설정 | OIDC 관리자 식별값, DEV/PROD 프로젝트·환경, 플랫폼 파일 원본 접근, 외부 에이전트의 MCP 키·스케줄 설정은 별도로 유지한다. 키 원문은 Git·문서에 넣지 않는다. |

`.env.keys`, `.tools`, `.deploy`, `output`, DB 덤프를 한꺼번에 Git에 추가하지 않는다. `output`에는 예전 운영 환경 백업도 있으므로 배포 산출물이나 에이전트 지침이 필요하면 해당 자료만 확인해 별도 전달한다. 기존 에이전트 전달 문서는 [저장소 관리 문서](assistant-agent-instructions.md)로 보관했다.

## 새 개발 환경에서 시작

필수 도구는 Git, Node.js 24와 npm, Docker Engine/Compose, PowerShell이다. 저장소 검사에는 Python 3도 사용한다. 먼저 기존 DEV 복호화 키와 Dotenvx를 준비하고 저장소 루트에서 실행한다.

```powershell
npm ci
./scripts/dev.ps1 config --quiet
./scripts/dev.ps1
./scripts/dev.ps1 ps
```

- 개발 서비스는 `ggeujeok-dev`를 사용한다. 기본 실행은 worker를 켜지 않으므로 실제 DEV 플랫폼 연결 후 필요한 경우에만 [운영 문서의 worker 절차](operations.md#deployment)를 따른다.
- `http://localhost:30145/api/health`와 공개 화면을 확인한다. 로그인·MCP 키 발급에는 DEV용 OIDC와 관리자 `iss/sub` 설정이 추가로 필요하다. 운영 키를 개발에 대신 넣지 않는다.
- 기존 개발 데이터도 옮겨야 하면 named volume의 별도 백업이 필요하다. 새 PC에서 서비스만 실행하면 예전 데이터가 따라오지 않는다.
- 서비스 중지는 `./scripts/dev.ps1 stop`이다. 환경값 조회·수정·암호화와 상세 실행 명령은 [운영 기준](operations.md#deployment)을 따른다.

검증 명령의 위치는 [AGENTS.md](../AGENTS.md)의 바로가기를 사용한다. 이관 문서 정리만으로 기존 기능 테스트를 다시 실행하지 않았으며, 마지막 기능 검증 결과는 이력에서 날짜와 함께 확인한다.

## 다른 저장소로 옮길 경우

- 현재 `origin`은 위 GitHub 저장소다. 대상 저장소 주소가 지정되지 않아 이 작업에서는 원격 주소를 바꾸지 않았다. 전체 Git 이력·브랜치·태그가 필요하면 단순 파일 복사와 구분해 이관한다.
- `main` 푸시는 [워크플로](../.github/workflows/ggeujeok.yml)의 verify → release → deploy를 실행한다. 새 저장소에서는 `prod` 환경과 `ggeujeok-deploy` 라벨의 self-hosted Runner를 준비한다. 기존 Runner 등록과 접근 권한이 새 저장소에 유효한지 확인한다.
- 필수 Secret 이름은 `NAS_SSH_HOST`, `NAS_SSH_PORT`, `NAS_SSH_USER`, `NAS_SSH_KEY`, `NAS_SSH_KNOWN_HOSTS`, `NAS_DEPLOY_PATH`다. Registry가 인증을 사용하면 `REGISTRY_USERNAME`, `REGISTRY_PASSWORD`도 필요하다. 값은 GitHub에서 원문을 다시 읽을 수 없으므로 기존 비밀값 보관자에게 받거나 대상에 맞게 재발급한다.
- 새 저장소나 호스트의 SSH 제한 진입점·허용된 배포 경로를 검토한다. 설치 근거는 [Runner 설치](../scripts/install-deploy-runner.sh), [SSH 제한 진입점](../scripts/ssh-deploy-gateway.sh), [운영 절차](operations.md#deployment)다. 같은 운영 대상에 두 Runner가 동시에 배포하지 않게 한다.
- 문서 현행화 커밋에는 `[skip ci]`를 사용해 기존 운영 서버를 재배포하지 않는다. 기능 변경은 일반 배포 절차와 실제 deploy 성공 확인을 따른다.

## 운영 호스트까지 옮길 경우

1. **현 상태 기록:** 기존 서버의 `.deploy` 기록·실행 이미지·암호화 환경·DB와 업로드 경로를 확보하고 외부 프록시·DNS·TLS 설정 담당자를 확인한다. 상세 경로와 접속 자격증명은 비밀값 인계로 전달한다.
2. **데이터 확보:** `scripts/backup-db.sh`는 PostgreSQL custom dump를 만들고 `scripts/check-db-restore.sh`는 격리 DB에서 복원을 점검한다. [백업 절차와 한계](operations.md#deployment)를 따른다. 운영 쓰기가 계속된다면 최종 백업과 전환 사이의 추가 변경을 어떻게 옮길지 먼저 정한다.
3. **플랫폼 자료 보존:** 완료된 이미지는 외부 플랫폼에 있고 DB에는 파일 ID·참조가 있다. DB 백업만으로 원본이 복구되지는 않는다. 플랫폼 프로젝트·환경·원본 파일과 접근 키를 함께 유지한다. 미완료 업로드를 이어가려면 업로드 임시 데이터도 필요하다.
4. **새 호스트 준비:** PostgreSQL 17, 운영 Compose, PROD 복호화 키, 같은 SHA의 API/Web/Nginx 이미지 3개를 준비한다. 운영 DB에 개발 데이터를 덮어쓰지 않는다. CPU 아키텍처가 달라지면 [릴리스 절차](operations.md#deployment)를 먼저 확인한다.
5. **주소·인증 연결:** 같은 도메인을 유지하면 프록시의 대상 호스트를 바꾸고 30145 진입 포트를 확인한다. 도메인이 바뀌면 `SITE_URL`, OIDC 콜백·로그아웃 URL, 플랫폼에 등록한 URL, 에이전트 MCP 주소도 함께 갱신한다. 관리자 `iss/sub`를 바꾸면 관리자 판정과 기존 MCP 키에 영향을 주므로 단순 이메일 대응으로 대체하지 않는다.
6. **전환 검수:** health·공개 글·이미지·로그인·관리자 저장·worker·MCP를 확인한다. 인증 없는 MCP는 401이어야 하며, 실제 키로 `get_capabilities`를 확인한다. `privacy`, `app100`의 보호 규칙도 유지한다. 새 서버에서 정상 동작을 확인한 뒤 트래픽과 worker 실행 주체를 전환한다.

기존 n8n 관리용 `output/n8n` 자료가 필요하다면 해당 리소스 ID를 별도 인계한다. 현재 AI 작업은 플랫폼 AI API를 사용하므로 이관을 이유로 기존 n8n 워크플로를 다시 등록하지 않는다. 외부 정기 백업·실제 운영 복구 훈련의 미완료 상태는 STATUS.md에서 확인한다.
