# SHNEA Platform 서비스 연결 지침

외부 프로젝트 개발자와 개발 AI에게 전달하는 지침이다. **2026-09-27 구현 기준**이며, 필요한 서비스만 선택해서 연결한다. 플랫폼 설치·운영 매뉴얼과 구분한다. 공개 주소는 `https://platform.shnea.kr`이지만 주소만으로 개발/운영 환경을 판단하지 않는다. 관리자가 지정한 프로젝트·환경과 키를 기준으로 연결한다.

## 1. 사용할 서비스 선택

| 필요한 기능 | 현재 연결 방법 | 외부 프로젝트가 담당할 일 |
| --- | --- | --- |
| 회원 로그인·가입·이메일 인증·비밀번호 복구 | 프로젝트 환경별 Keycloak OIDC 로그인 | 콜백·세션·사용자 프로필 연결, 서비스 자체 권한 |
| 파일·이미지·영상·오디오 저장 | 프로젝트 서버에서 파일 REST API 호출 | 사용자 권한, 업로드 접수·임시 원본·재개 기록, 파일 참조 저장 |
| 썸네일·미리보기·영상 스트리밍·공유 | 파일 ID로 상태·보기 URL 조회 | 준비 중/실패 표시, URL 만료 처리, 외부 도메인 재생 방식 선택 |
| 에디터·읽기 화면 | `@shnea/editor` React/Vue 컴포넌트 또는 일반 JS/JSP 번들 | 본문 JSON 저장·조회, 저장 실패 처리, 첨부 어댑터 |
| 일반 알림 발송·앱 내 알림함·웹 푸시 | **외부 업무 API 제공 전** | 아직 호출 경로를 만들거나 있다고 가정하지 않음 |
| 외부 웹훅·이벤트 구독 | **제공 전**. 현재 이벤트 전달은 플랫폼 내부 전용 | 파일 변환 상태는 조회 방식으로 확인 |
| 외부 프로젝트 로그 수집 | **구현 예정** | 아직 로그 전송 API를 연결하지 않음 |
| 외부 임의 작업의 비동기 실행 | **범용 Job 접수 API 없음** | 프로젝트 자체 업무 Job은 해당 프로젝트에서 처리 |

플랫폼에는 인증 이메일·운영 알림과 내부 Job·모니터링이 있으나, 이를 외부 프로젝트의 일반 알림/작업/로그 API로 사용할 수 있다는 뜻은 아니다. 에디터 패키지는 내부 검증용 `0.1.0-alpha.6`, 문서 형식은 version 3이며 공개 npm에는 아직 발행하지 않았다. 전체 서비스의 운영 출시 완료를 의미하지 않는다.

**파일만 사용할 때 기존 로그인을 교체할 필요는 없다.** 호스트 서버가 기존 로그인으로 사용자를 확인한 뒤 서버 키로 파일 API를 호출한다. **에디터만 사용할 때는 플랫폼 계정·키가 필요 없다.** 첨부도 호스트의 다른 저장소로 연결할 수 있다.

## 2. 연결 구조와 책임

```text
이용자 브라우저/앱
 ├─ 로그인 이동 ──────────── 플랫폼의 해당 환경 Keycloak
 └─ 호스트 프로젝트 서버 ─── 플랫폼 파일 API (X-Platform-Key)
       ├─ 이용자 로그인·업무 권한 검사
       ├─ 게시글 JSON·파일 ID·소유 관계 저장
       └─ 허용한 파일의 보기 URL만 이용자에게 반환

에디터/뷰어는 호스트 화면 안에서 실행 → 본문 저장은 호스트 서버
```

- **이용자 인증과 서버 키는 별개다.** 서버 키는 프로젝트·환경·기능 권한을 식별하며 특정 이용자를 대신하지 않는다.
- 브라우저·앱 배포물·공개 환경변수(`VITE_*`, `NEXT_PUBLIC_*` 등)·URL·Git에 서버 키를 넣지 않는다.
- 플랫폼 관리자 계정/JWT, Keycloak master 계정, NCP 키, 플랫폼 내부 서비스 비밀값을 외부 프로젝트에 전달하지 않는다.
- 외부 서버는 공개 HTTPS 진입점만 사용한다. 플랫폼 DB나 Docker 내부 서비스 포트에 직접 연결하지 않는다.
- 호스트가 요청자의 권한과 파일 소유 관계를 검사한다. 전달받은 `fileId`, `projectId`, `environmentId`, 에디터의 `scope`를 권한 증명으로 믿지 않는다. 키에 해당 환경 전체 파일 조회 권한이 있어도 이용자에게 전체 목록을 노출해서는 안 된다.

## 3. 관리자가 먼저 준비할 것

1. 관리자 화면에서 새 프로젝트를 만들고 DEV 환경을 생성한다. 운영용은 별도 PROD 환경·별도 키를 사용한다.
2. 로그인을 쓸 경우 호스트의 정확한 콜백 URL을 등록한다. 예: `https://app.example.com/auth/callback`. DEV는 `http://localhost:3000/auth/callback` 같은 로컬 HTTP도 허용한다. 와일드카드는 사용하지 않는다.
3. 프로젝트가 `ACTIVE`, 환경이 `READY`인지 확인한다. 환경 생성 접수와 인증 설정 반영 완료는 별개다.
4. 파일을 쓸 경우 **프로젝트 → 프로젝트 설정 → 파일 서비스 사용**을 켠다. 새 프로젝트는 기본 꺼짐이며 설정은 해당 프로젝트의 모든 환경에 적용된다.
5. **프로젝트 → API 키**에서 해당 환경에 필요한 권한만 선택해 발급한다. 원문은 발급 시 한 번만 확인할 수 있으므로 서버 비밀값 저장소로 전달한다.
6. 프로젝트 ID·환경 ID·환경 종류·issuer·콜백과 키의 권한/만료 여부를 호스트 개발자에게 전달한다. 키 원문은 지침·메신저 대화·AI 프롬프트에 포함하지 않는다.

| 서버 키 권한 | 용도 |
| --- | --- |
| `integration:read` | 소속 프로젝트·환경·issuer 확인. 아래 연결 점검에 필요 |
| `files:read` | 파일 정보·목록·보기 URL·보존 코드·파일 API 명세 조회 |
| `files:write` | 업로드 생성/전송/완료/재개/취소, 공개 범위·보존 코드·공개 공유 설정 변경 |
| `files:delete` | 완료 파일 삭제. 삭제를 담당하는 서버에만 부여 |
| `files:share` | 비공개 파일의 비밀번호 공유 생성·목록·철회 |
| `auth:mock` | 플랫폼 개발 모드의 DEV 환경에서만 모의 로그인 |

파일 업로드·조회로 시작한다면 `integration:read`, `files:read`, `files:write`를 선택한다. 기본 발급 권한은 `integration:read`뿐이며 기존 키에 새 기능 권한이 자동으로 붙지 않는다. 로그인만 쓰는 브라우저에는 서버 키가 필요 없고, 관리자가 전달한 공개 issuer/client ID를 사용한다.

키는 기본 만료가 없으며 필요하면 만료일을 지정할 수 있다. 권한 변경·키 교체는 새 키 발급 → 호스트 서버 전환 → 이전 키 폐기 순서다. **진행 중 업로드 세션은 생성한 키에 묶이므로** 교체 전에 완료하거나 새 키로 새 업로드를 시작해야 한다.

## 4. 호스트 설정과 첫 연결 확인

다음은 **호스트가 사용할 설정 이름의 예**다. 플랫폼 컨테이너의 운영 설정을 수정하는 절차가 아니다. 비밀값은 배포 시스템/서버의 비밀값 저장소에서 주입한다.

```dotenv
PLATFORM_URL=https://platform.shnea.kr
PLATFORM_PROJECT_ID=<관리자가 전달한 프로젝트 UUID>
PLATFORM_ENVIRONMENT_ID=<관리자가 전달한 환경 UUID>
PLATFORM_API_KEY=<서버 전용 키 — 실제 값은 이 문서에 기록하지 않음>
PLATFORM_OIDC_ISSUER=<관리자가 전달하거나 context로 확인한 issuer>
PLATFORM_OIDC_CLIENT_ID=app
PLATFORM_OIDC_REDIRECT_URI=https://app.example.com/auth/callback
```

서버에서 `GET /api/v1/integration/context`를 호출한다. Python 3.11 이상에서 아래를 `check_platform.py`로 저장하고 환경변수를 주입한 뒤 실행한다. 키가 다른 주소로 전달되지 않도록 리다이렉트를 따르지 않는다.

```python
import json
import os
import urllib.error
import urllib.request

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

base = os.environ["PLATFORM_URL"].rstrip("/")
if not base.startswith("https://"):
    raise SystemExit("PLATFORM_URL은 HTTPS 주소로 지정하세요.")
request = urllib.request.Request(
    base + "/api/v1/integration/context",
    headers={"X-Platform-Key": os.environ["PLATFORM_API_KEY"]},
)
try:
    with urllib.request.build_opener(NoRedirect).open(request, timeout=15) as response:
        context = json.load(response)
except urllib.error.HTTPError as error:
    raise SystemExit(f"연결 실패: HTTP {error.code}, 요청 ID: "
                     f"{error.headers.get('X-Request-ID', '없음')}")
except urllib.error.URLError:
    raise SystemExit("연결 실패: DNS·TLS·네트워크를 확인하세요.")
if (context["projectId"] != os.environ["PLATFORM_PROJECT_ID"]
        or context["environmentId"] != os.environ["PLATFORM_ENVIRONMENT_ID"]):
    raise SystemExit("지정한 프로젝트/환경과 키의 소속이 다릅니다.")
print(json.dumps(context, ensure_ascii=False, indent=2))
```

성공 응답은 `projectId`, `environmentId`, `kind`(`DEV`/`PROD`), `issuer`, `scopes`를 포함하며 키 원문은 포함하지 않는다. 예상 환경과 필요한 권한을 확인한 뒤 연결한다. `issuer`의 realm 이름을 프로젝트 코드로 추측하지 않는다. 로컬 전용 `http://localhost:30140`을 사용할 때는 별도 개발 설정으로 다루고 운영 HTTPS 검사를 해제하지 않는다.

## 5. 로그인 연결

호스트 스택에 맞는 검증된 OIDC 라이브러리로 **Authorization Code + PKCE(S256)**를 연결한다. 환경의 기본 공개 클라이언트 ID는 `app`이고 client secret은 없다. 일반 앱의 비밀번호 직접 교환(password grant)은 꺼져 있다. [Keycloak OIDC 안내](https://www.keycloak.org/securing-apps/oidc-layers), [브라우저 어댑터 안내](https://www.keycloak.org/securing-apps/javascript-adapter)를 참고한다.

| 항목 | 사용할 값 |
| --- | --- |
| issuer | 해당 환경에서 받은 정확한 `issuer` |
| discovery | `{issuer}/.well-known/openid-configuration` |
| client ID | `app` |
| flow / PKCE | Authorization Code / S256 |
| scope | `openid`; 이름·이메일이 필요하면 `profile email` 추가 |
| redirect URI | 관리자에 등록한 정확한 호스트 콜백 URL |
| 사용자 식별 | 검증한 토큰의 `iss`와 `sub` 조합. 이메일만으로 다른 환경 계정을 합치지 않음 |

로그인 버튼 → 해당 환경의 인증 화면 → 호스트 콜백 처리 → 호스트 화면/세션 순서다. 라이브러리의 state·nonce·PKCE 및 토큰 검증을 사용한다. 호스트 서버는 토큰을 단순 디코딩한 결과로 권한을 주지 않는다. 서명·issuer·만료와 토큰 종류에 맞는 audience를 검증한다. **호스트 API용 access token audience는 현재 프로젝트 생성 기능이 자동 설정해 주지 않는다.** 별도 API가 Bearer 토큰을 받는 구조라면 운영자와 audience 설정·검증 계약을 먼저 확정하며 검증을 생략해서 맞추지 않는다. ID token을 업무 API 접근 토큰으로 사용하지 않는다.

브라우저 로그인은 콜백 origin을 Keycloak의 허용 출처로 반영한다. 이는 파일 REST API의 CORS 허용과 별개다. 호스트의 세션/토큰 저장, CSRF 보호, 로그인 취소·만료·재로그인 처리를 구현한다. 브라우저 토큰을 영구 저장소에 무조건 보관하는 예제를 만들지 않는다. `/api/v1/config`는 **플랫폼 관리자 로그인 설정**이므로 외부 프로젝트 로그인에 사용하지 않는다.

로그아웃은 호스트 세션 정리와 OIDC 로그아웃을 함께 설계한다. 기본 `app`에 임의의 로그아웃 복귀 URL이나 confidential client 설정이 준비돼 있다고 가정하지 말고 허용 설정을 운영자와 확인한다. 기존 access token을 자체 검증하는 서버는 계정/프로젝트 중지 이후에도 만료까지 수락할 수 있다. 즉시 차단이 필요하면 별도 상태 확인 정책을 정한다.

소셜 로그인·자체 가입·이메일 인증·복구는 환경 정책에 따른다. 소셜 제공자 키는 플랫폼 운영자가 관리한다. DEV 인증 이메일은 모의 수신함을 쓰며 실제 운영 발송과 구분한다. `auth:mock` 키의 `POST /api/v1/dev/login`은 서버에서 성공/취소/동의 거부/장애를 재현하는 개발용이며 실제 소셜 로그인 검수를 대신하지 않는다.

## 6. 파일 연결

### 빠른 실행

관리자 **개발자 센터 → 서버 연동 예제** 또는 [file-client.py 다운로드](https://platform.shnea.kr/examples/file-client.py)에서 Python 예제를 받는다. Python 3.11 이상과 표준 라이브러리만 필요하다. 서버에 `PLATFORM_URL`, `PLATFORM_API_KEY`를 주입하고 **전용 DEV 환경의 테스트 파일**로 실행한다.

```sh
python file-client.py upload ./sample.mp4 --state ./upload-state.json --visibility PRIVATE --retention default --wait 120
python file-client.py views FILE_ID --wait 120
# 이 예제로 만든 테스트 파일만 삭제한다. files:delete 권한이 필요하다.
python file-client.py delete FILE_ID
```

`FILE_ID`는 업로드 결과의 실제 UUID로 바꾼다. CLI 출력에는 비공개 보기 토큰 URL이 들어갈 수 있으므로 공개 로그·CI 산출물·메신저에 붙이지 않는다. 이 예제는 파일 한 개의 서버 업로드를 보여 주며 호스트의 브라우저 업로드 API나 사용자 권한 검사를 대신하지 않는다. 모듈로 가져올 때 파일명을 `file_client.py`로 바꾼다.

### 호스트 서버에서 구현할 흐름

| 순서 | 플랫폼 API | 처리 기준 |
| --- | --- | --- |
| 1 | `POST /api/v1/files/uploads` | `requestId`(UUID), `originalName`, `size`, 전체 `sha256`, `visibility`, `retentionCode` 전달 |
| 2 | `PATCH /api/v1/files/uploads/{id}` | 8MiB 이하 원시 조각, `Content-Type: application/octet-stream`, `Content-Length`, `Upload-Offset`, `X-Chunk-SHA256` |
| 중단/재개 | `GET /api/v1/files/uploads/{id}` | 서버의 `receivedBytes`부터 같은 원본·같은 키로 재개 |
| 3 | `POST /api/v1/files/uploads/{id}/complete` | 전체 크기·해시 검증 후 반환된 `fileId`를 호스트 DB에 저장 |
| 4 | `POST /api/v1/files/{id}/view-ticket` | 사용자 권한 확인 후 현재 상태·보기 URL 발급 |
| 조회 | `GET /api/v1/files/{id}` / `GET /api/v1/files/{id}/views` | 파일 정보 / 변환 상태 조회 |
| 취소 | `DELETE /api/v1/files/uploads/{id}` | 미완료 세션 취소. 완료 파일 삭제와 구분 |
| 삭제 | `DELETE /api/v1/files/{id}` | 호스트 참조·권한 확인 후 완료 파일 삭제 |

최대 파일 크기는 **5,000,000,000바이트**다. 조각 상한은 8,388,608바이트이며 한 파일의 조각은 순서대로 전송한다. 호스트의 요청 크기·디스크·프록시 제한도 함께 정한다. 하나의 거대한 multipart 요청으로 5GB 지원이 자동 완성되는 것은 아니다. 원본과 재개 기록은 호스트가 보관하며 업로드 세션은 생성 후 24시간에 만료된다.

생성 요청의 `requestId`는 파일별로 한 번 만들고 응답 유실 시 같은 키·같은 본문으로 재사용한다. 조각 응답을 받지 못했다면 위치를 조회하며 무조건 다음 조각으로 넘어가지 않는다. 완료 요청 재시도는 같은 파일 ID를 반환한다. 이 업로드 계약은 **tus 호환 API가 아니다**.

파일은 기본 `PUBLIC`이다. 민감한 첨부는 생성할 때 명시적으로 `PRIVATE`를 지정한다. PRIVATE 파일은 호스트에서 이용자 권한을 확인한 다음 보기 URL을 발급해야 하며 **그 URL 자체도 만료 전 접근 권한**이다. 응답 캐시·접근 로그·분석 도구에 토큰 URL을 남기지 않는다. 공개 파일은 URL을 아는 사람이 볼 수 있고 플랫폼이 호스트 게시글의 공개 여부를 자동으로 알지는 못한다.

### 썸네일·미리보기·영상·공유

보기 응답의 `thumbnailUrl`, `previewUrl`, `originalUrl`, `downloadUrl`, `viewerUrl`, `shareUrl`, `streamUrl`을 용도에 맞게 사용한다. 지원하지 않거나 준비되지 않은 URL은 null일 수 있다. `state`와 영상의 `video.state`를 각각 확인해 대기/처리/완료/미지원/실패를 표시한다. 원본 업로드 완료가 HLS 변환 완료를 뜻하지 않는다.

- 원본·썸네일·일반 보기의 비공개 URL은 최대 5분, HLS 전용 URL은 `streamExpiresAt`까지 최대 2시간이다. 고정 시간으로 추측하지 말고 실제 만료값을 사용한다. 호스트 DB/본문에는 임시 URL 대신 파일 ID를 보관한다.
- 준비 중 상태는 적당한 간격으로 조회하고 화면을 떠나면 중단한다. 상태 확인마다 새 티켓을 만들지 않는다. 파일당 최근 20개 보기 세션 제한이 있어 불필요한 발급은 다른 보기 링크에 영향을 줄 수 있다.
- 지원 영상은 H.264/AAC HLS와 자동·360p·720p·1080p를 제공하되 원본보다 확대하지 않는다. 입력 한도는 60분·5GB·각 변 4096px·850만 화소 이하 등이며 모든 코덱/문서 변환을 보장하지 않는다.
- 공개 공유 카드는 `shareUrl`을 사용한다. `GET/PUT /api/v1/files/{id}/public-share`로 제목·설명·썸네일 노출을 관리한다. 비공개는 별도 `POST /api/v1/files/{id}/shares`에 `{password, expiresInDays}`를 보내 비밀번호 공유를 만든다(`files:share`, 기본 7일, 1~30일). 공유 비밀번호는 URL에 넣지 않는다.
- 같은 내용 파일 확인은 `GET /api/v1/files/{id}/duplicates`다. 같은 프로젝트·환경의 내용 해시 비교이며 자동 병합·물리 저장 중복 제거·유사 이미지 검색이 아니다.

**외부 도메인에 넣는 방법은 별도 확인이 필요하다.** 현재 파일 API는 임의 출처의 브라우저 CORS를 열지 않으며 기본 HTML/영상 뷰어의 `frame-ancestors 'self'` 때문에 다른 도메인의 iframe에서 바로 쓸 수 없다. 먼저 반환된 `viewerUrl`을 새 탭/직접 이동으로 열어 확인한다. 호스트 본문 안의 HLS·문서 미리보기가 필요하면 허용 출처/임베드 정책 또는 호스트의 인증된 같은 출처 미디어 중계·플레이어를 별도 구현하고 검수한다. 단순히 서버 키를 브라우저에 넣거나 URL만 바꾸면 해결되지 않는다. 임의 URL을 받는 공개 중계 프록시는 만들지 않는다.

### 보존·본문 삭제

`GET /api/v1/files/retention-policies`로 코드와 정책을 확인한다. `default`, `tmp`, `영구`는 고정 코드이며 `default`가 영구를 뜻하지 않는다. 오래 보관할 게시글 첨부는 목적에 맞는 정책을 선택한다. 자동 정리는 환경별 기본 꺼짐이지만 켜지면 정책 변경이 기존 파일에도 적용된다. 게시글에 참조돼 있다는 사실이나 상태 조회만으로 보존 기간이 연장되지는 않는다.

에디터에서 첨부 블록을 지우거나 게시글 저장에 실패했다고 원본 파일을 즉시 삭제하지 않는다. 다른 게시글 참조와 진행 중 저장 여부를 호스트에서 확인해 미사용 파일을 정리한다. 공개 범위 변경·삭제·프로젝트 중지는 후속 접근에 반영되지만 이미 내려받은 사본·외부 공유 카드 캐시는 회수할 수 없다.

## 7. 에디터·뷰어 연결

[실행 예제](https://platform.shnea.kr/examples/editor/)와 [에디터 연동 지침 다운로드](https://platform.shnea.kr/examples/editor/INTEGRATION.md)를 함께 전달한다. 저장소 기준 상세 지침은 [packages/editor/INTEGRATION.md](../packages/editor/INTEGRATION.md)다.

1. 운영자가 전달한 `shnea-editor-0.1.0-alpha.6.tgz`를 설치하거나 일반 JS/JSP용 `dist/browser` 자산 전체를 받는다. 공개 npm에서 설치할 수 있다고 가정하지 않는다. 버전과 라이선스 파일을 함께 보관한다.
2. React는 `@shnea/editor/react`, Vue는 `@shnea/editor/vue`의 `ShneaEditor`·`ShneaViewer`를 사용하고 공통 CSS를 로딩한다. 일반 JS/JSP는 ES 모듈 번들을 호스트 정적 자산으로 제공한다.
3. 변경 이벤트로 받은 문서 JSON을 호스트의 게시글 API에 저장한다. 조회한 JSON을 검증해 편집/읽기에 같은 값으로 전달한다. 저장 실패를 표시하고 미저장 내용을 보호한다. 다른 게시글로 바뀌면 `documentKey`를 바꾼다.
4. 첨부 `upload`는 **호스트 서버**에 파일을 보내고 `{fileId, scope, kind, name, size}`를 돌려준다. `resolve`는 호스트의 권한 검사를 거쳐 최신 보기 상태·URL을 조회한다. 계약 예제의 `/api/editor/files`는 호스트가 구현할 예시이며 플랫폼에 이미 존재하는 API가 아니다.
5. 영상은 `attachments.video`로 호스트 플레이어를 연결할 수 있다. 생략 시 기본 뷰어 iframe을 사용하므로 **다른 도메인의 플랫폼 뷰어는 위 임베드 제한을 먼저 해결해야 한다.** 패키지 설치만으로 외부 도메인 영상 연동이 끝나는 것은 아니다.
6. 화면 해제 시 에디터·뷰어·진행 중 요청을 정리한다. 본문에서 파일을 제거하는 것과 저장소 원본 삭제를 분리한다.

에디터 자체는 본문을 서버나 브라우저 저장소에 영속 저장하지 않는다. 예제의 ‘보관’은 메모리 보관이며 새로고침하면 사라진다. 버전 3 JSON은 임의 HTML 삽입 대신 제공된 문서 검증·뷰어로 다룬다. 에디터 독립 사용 시에는 위 프로젝트/키/로그인/파일 절차를 생략할 수 있다.

## 8. 오류와 운영 기준

| 결과 | 호스트 처리 |
| --- | --- |
| 400 | 필드·형식·해시·크기 확인. 같은 입력을 자동 반복하지 않음 |
| 401 | 키 만료/폐기, 프로젝트 중지, 환경 준비 상태 확인. 이용자 로그인 만료와 구분 |
| 403 | 키 권한·파일 사용 설정·DEV 제한 확인 |
| 404 | 없는 파일 또는 접근할 수 없는 범위. 존재 여부를 이용자에게 과도하게 노출하지 않음 |
| 409 | 최신 상태/업로드 위치를 다시 읽고 충돌 원인에 맞게 처리 |
| 413 | 호스트·프록시·플랫폼의 요청 크기 제한 확인 |
| 429 | 응답에 재시도 안내가 있으면 준수하고 요청 빈도를 낮춤 |
| 5xx·통신 단절 | 반영 여부 확인 후 제한된 재시도. 생성/삭제/발송을 무조건 반복하지 않음 |

표준 오류는 `application/problem+json`의 `code`, `detail`, `requestId`, 선택적 `errors`로 전달한다. 프로그램은 HTTP 상태와 `code`로 분기하고 한국어 `detail`은 화면에 텍스트로 표시한다. 알 수 없는 코드·비JSON 응답도 일반 오류로 처리한다. OIDC 및 의도된 Mock 실패는 별도 계약이다.

게이트웨이는 호출자의 `X-Request-ID`를 덮어써 플랫폼 요청 ID를 발급한다. 호스트는 자기 요청 ID와 **응답의** `X-Request-ID`를 함께 기록한다. 업로드 생성 본문의 UUID `requestId`와 이 추적 ID는 용도가 다르다. 키·토큰·비밀번호·원문 본문·임시 URL은 로그에서 제외한다. 실제 이용자 IP 기록이 필요하면 [클라이언트 IP 지침](CLIENT_IP_GUIDE.md)을 호스트의 프록시 구성에 맞게 적용하며 외부 요청 헤더를 그대로 신뢰하지 않는다.

## 9. 외부 프로젝트에서 완료할 검수

- [ ] 지정한 DEV 프로젝트/환경과 context 응답이 일치한다. PROD 키·계정·파일을 섞지 않는다.
- [ ] 로그인 성공·취소·만료·로그아웃·재로그인과 다른 환경 토큰 거부를 확인한다.
- [ ] 브라우저 번들·네트워크 요청·로그에 서버 키/관리자 자격증명이 없다.
- [ ] 호스트 사용자 A가 B의 비공개 파일 ID로 조회·티켓 발급·삭제할 수 없다.
- [ ] 업로드 중단·같은 기록으로 재개·완료 응답 유실·키 교체·만료·용량 초과를 처리한다.
- [ ] 이미지·영상·오디오·일반 파일을 실제 외부 도메인에서 열고 변환 대기/실패/미지원·URL 만료를 확인한다.
- [ ] 보호 파일의 무인증 접근, 공개 범위 전환, 공유 철회와 삭제 후 신규 접근 차단을 확인한다.
- [ ] Markdown/표/굵게/기울임/한글/첨부가 JSON 저장 → 재조회 → 재편집 → 읽기에서 일치한다.
- [ ] 문서 교체·화면 해제·저장 실패·재접속·실제 모바일/IME를 확인한다.
- [ ] 보존 정책·미사용 첨부 정리·오류/요청 ID 기록과 운영 키 전달 방식을 정한다.

플랫폼 내부 예제 검증이 외부 프로젝트의 실제 도메인·인증·저장·권한·모바일 검수를 대신하지 않는다. 필요한 항목을 DEV에서 마친 뒤 관리자가 PROD 준비 상태를 확인하고 운영으로 전환한다.

## 10. 다른 개발자·AI에게 전달할 양식

이 파일을 외부 프로젝트의 `docs/PLATFORM_INTEGRATION.md` 등으로 복사하고 아래 양식을 함께 전달한다. 코드 작성 규칙에 해당 문서를 먼저 읽도록 연결한다. 실제 키 대신 **서버 설정 이름과 비밀값 주입 여부**만 전달한다. 지침을 복사한 날짜/기준 버전을 남기고 서비스 추가 시 원본과 비교한다.

```text
이 프로젝트에 SHNEA Platform 서비스를 연결해 주세요.
첨부한 서비스 연결 지침을 먼저 읽고 현재 제공되는 기능만 사용하세요.

사용 기능: [로그인 / 파일 / 에디터 중 선택]
호스트 기술: [예: React + Spring Boot]
호스트 주소/로그인 콜백: [...]
플랫폼 기본 주소: https://platform.shnea.kr
프로젝트 ID / 환경 ID / 종류: [... / ... / DEV]
OIDC issuer / client ID: [... / app, 로그인을 쓸 때]
서버 키 설정명: PLATFORM_API_KEY (원문은 전달하지 않음)
발급 권한: [integration:read, files:read, files:write 등]
비밀값 주입 상태: [개발 서버에 주입 완료 / 운영자 설정 필요]
파일 공개 범위 / 보존 코드 / 사용자 권한 기준: [...]
에디터 패키지: [0.1.0-alpha.6 tgz 또는 일반 JS 자산 전달 위치]
본문 저장 API·DB / 첨부 소유 관계: [기존 경로 또는 구현 필요]
외부 도메인 미디어 방식: [새 탭 기본 뷰어 / 별도 연동 협의]

서버 키를 브라우저/앱에 넣거나 플랫폼 관리자·내부 API·DB를 사용하지 마세요.
호스트가 사용자 권한을 검사하고 본문 JSON·파일 참조를 저장하게 하세요.
미제공 알림·웹훅·공통 로그 API를 임의로 만들거나 호출하지 마세요.
연결 확인 → 선택한 기능 구현 → DEV 검수 순서로 진행하고,
실제 확인하지 않은 동작과 운영 전 필요한 설정을 구분해 보고해 주세요.
```

## 상세 계약과 기준 자료

현재 저장소를 열 수 있다면 아래 문서와 명세를 함께 참고한다. 파일 하나만 전달하는 경우에도 위 연결 순서·경계·검수 기준은 그대로 적용한다. 세부 요청/응답은 사용하는 버전의 명세를 우선하며 충돌 시 운영자에게 확인한다.

- [프로젝트·인증 API](PROJECT_API.md), [파일 API·보존·HLS](FILES.md), [오류와 요청 ID](API_CONVENTIONS.md)
- [에디터 계약](EDITOR.md), [프레임워크별 설치·예제](../packages/editor/INTEGRATION.md)
- [파일 OpenAPI 원본](../services/file-service/src/main/resources/openapi.json): 서버에서는 `GET /api/v1/files/openapi` + `files:read` 키. 관리자 개발자 센터에서도 조회/다운로드 가능
- [현재 구현·검증 상태](STATUS.md): 일반 알림·외부 웹훅·공통 로그 등 후속 범위의 제공 여부 확인

OpenAPI는 **우리가 제공하는 HTTP API의 명세 형식**이다. OpenAI/AI 서비스 연결을 뜻하지 않는다.
