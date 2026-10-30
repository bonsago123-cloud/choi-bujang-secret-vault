# BYTE BACK 방어전 R5 — 5단계 저장점 (2026-10-30)

> **현재 설정 단계: 5단계.** 아래 4·3·2단계 절은 각 단계 당시 기록이며 현행 데이터베이스 직접 권한을 나타내지 않습니다. 5단계 공식 심판 결과는 아직 이 문서에 기록하지 않았습니다.

## 1. 현재 작동하는 기능

- Supabase Auth로 로그인·로그아웃하며 서버의 `src/verify-login.mjs`가 로그인 토큰을 검증합니다. 브라우저가 보낸 임의 사용자 ID를 권한 판단에 사용하지 않습니다.
- 기존 가상 자료는 `GET /api/notes`로 조회하며, 서버가 확인한 `owner_id`로 필터링합니다. 기존 A 소유 4건, B 소유 1건을 유지합니다.
- 새 사용자 메모는 `/api/memos` 및 `/api/memos/:id` 서버 함수에서 본인 메모만 목록·추가·조회·수정·삭제합니다. 서버는 각 요청에서 소유자를 확인합니다.
- 브라우저 코드는 자료를 Supabase 테이블에서 직접 읽거나 변경하지 않습니다. Supabase SDK의 브라우저 호출은 로그인·로그아웃·세션(Auth)에 사용합니다.
- 공개 `/data.json` 경로에는 가상 메모 원문을 제공하지 않고, `/aleph.json`은 배포 정보 식별에 사용합니다.

## 2. 5단계 적용: 데이터 요청은 서버 API로 집중

- **대상 테이블은 `public.study_notes`와 `public.user_notes` 두 개뿐입니다.** 실제 자료 삭제나 다른 테이블·함수·시퀀스 권한 수정은 하지 않았습니다.
- 2026-10-30 학습 DB에서 `REVOKE ALL PRIVILEGES ... FROM PUBLIC, anon, authenticated`를 두 테이블에 적용했습니다. 적용 SQL은 `db/stage5_revoke_direct_access.sql`에 기록했습니다.
- 적용 후 읽기 전용 SQL 검증: 두 테이블 모두 `anon`·`authenticated`의 SELECT/INSERT/UPDATE/DELETE 권한이 **모두 false**, `service_role`의 네 권한은 **모두 true**, RLS 활성화는 유지. `PUBLIC`·`anon`·`authenticated`의 명시적인 테이블 권한도 **0건**이었습니다.
- 데이터베이스 검증 쿼리는 `db/stage5_verify_direct_access.sql`에 있습니다. Supabase Auth, 4단계 서버의 로그인·소유자 검사, 서버 전용 비밀 설정을 변경하지 않았습니다.
- 권한 회수 이후 사용자가 A 계정 운영 화면에서 기존 가상 메모 4건과 자신의 메모 추가·조회·수정·삭제가 정상 작동한다고 보고했습니다. 이 사실은 **사용자 수행 검증**이며 이번 저장점에서 테스트 계정으로 API를 자동 재현한 것은 아닙니다.
- **남은 확인:** 원본 Supabase REST 경로를 `anon` 키로 직접 요청한 실제 HTTP 상태는 이 저장점에서 아직 독립적으로 측정하지 않았습니다. 심판 결과나 5단계 만점을 추정하지 않습니다. 권한 검사상 직접 테이블 접근은 차단되어 있습니다.

## 3. 설정과 자료 경로

- `aleph.config.json`의 `step`: `5`
- `publicAppUrl`: `https://choi-bujang-secret-vault-one-theta.vercel.app`
- `originalApiUrl`: `https://xfvldqqajkfxahjdvieo.supabase.co/rest/v1/study_notes` (쿼리 문자열 없음)
- `identityProvider`, `judgeIssuer`, 기존 `allowedRoutes` 6개 모두 유지. `restoreRoute`는 아직 `null`.
- `src/decider.mjs`의 `starter.deny` 기본 규칙과 이후 단계의 자료도 변경하지 않았습니다.

## 4. 재검증 방법 (Windows CMD, 저장소 루트)

```cmd
npm ci
npm run build -- --local
npm run test:r5
npm run test:package
node --test test/notes.test.mjs test/memos.test.mjs test/stage4-owner.test.mjs test/stage4-attack-check.test.mjs
npm run bundle
```

- `npm ci`는 잠금 파일 기준 설치, `--local`은 배포 식별 없이 로컬 빌드, `npm run bundle`은 제출 묶음 생성 및 학생 자기점검입니다. 공식 채점과 다릅니다.
- **`npm run bundle` 전에** 로컬 `git status`가 깨끗해야 하고 실제 변경을 검토한 뒤 커밋해야 합니다. `bundle-notes.json`과 `artifacts/submission.json`은 Git에 커밋하지 않습니다.
- 웹 화면에서 A 계정의 본인 메모 읽기·추가·수정·삭제가 유지되는지 다시 확인합니다. 비로그인 서버 API는 HTTP 401로 거부되어야 합니다. 원본 REST의 `anon` 키 접근은 권한 부족으로 거부되어야 합니다.
- 비밀키·액세스 토큰·개인정보·실제 메모 본문을 채팅·Git·README·제출 JSON에 쓰지 않습니다.

## 5. 포트폴리오 메모 (문제 → 대응 → 검증)

- **문제:** 로그인 사용자가 Supabase REST API를 직접 호출할 수 있으면 메모 자료에 대한 진입 경로가 서버 함수 이외에도 남습니다.
- **대응:** 브라우저 자료 요청은 기존 서버 함수로 통일하고, 두 메모 테이블의 `PUBLIC`·`anon`·`authenticated` 직접 권한을 회수했습니다. 서버는 로그인 검증 및 `owner_id` 검사를 유지합니다.
- **검증:** 실제 DB 권한 전후를 비교하여 클라이언트 역할의 권한 회수와 서버 역할 권한 유지를 확인했고, A 계정의 서버 API 경유 CRUD 유지도 사용자 화면에서 확인했습니다. `anon` 키 원본 HTTP 재검증은 별도 남았습니다.

---

# BYTE BACK 방어전 R5 — 4단계 저장점 (2026-10-30, 당시 기록)

> 아래 4단계부터는 이전 시점 기록입니다. 현재 5단계 DB 직접 권한 상태를 설명하지 않습니다.

## 현재 구현 및 확인된 사항

- Supabase Auth 토큰을 서버에서 검증합니다. 브라우저가 지정한 사용자 ID나 소유자 ID를 권한 판단의 근거로 신뢰하지 않습니다.
- `GET /api/notes`: `study_notes`의 기존 실습용 가상 메모를 확인된 `owner_id`로 필터링합니다. 현재 A 소유 4건, B 소유 1건이며 비로그인 요청은 거부합니다.
- `GET /api/memos`, `POST /api/memos`: `user_notes`에서 본인 메모만 목록으로 반환하고, 추가 시 서버가 확인한 사용자 UUID를 `owner_id`에 기록합니다.
- `GET /api/memos/:id`, `PUT /api/memos/:id`, `DELETE /api/memos/:id`: UUID와 `owner_id`를 함께 검사하므로 상대 메모를 찾거나 변경·삭제할 수 없도록 구현했습니다. 수정 시 요청 본문의 `owner_id`와 `id`를 거부하며 `{title,body}`를 받습니다. 개별 조회와 수정 응답은 `{id,title,body}`를 유지합니다.
- **DB 측 4단계 RLS·권한 정책은 Supabase 대시보드에서 직접 적용했으며 읽기 전용으로 확인했습니다.** `db/stage4_memo_rls.sql`은 이를 재현·점검하기 위한 기록입니다. `anon`은 두 테이블 권한 없음, `authenticated`는 SELECT·INSERT·UPDATE·DELETE만 부여됩니다. 각 테이블에서 SELECT/INSERT/UPDATE/DELETE 정책 4개씩, 총 8개가 활성화됐습니다. 실제 메모 내용은 저장소에 기록하지 않습니다.
- 비로그인 자기점검은 실제 HTTP 상태만 기록합니다. 2026-10-30 사용자가 A/B 화면에서 A 소유 기존 메모 4건·B 소유 1건, 양 계정의 신규 메모 분리 및 본인 추가·조회·수정을 확인했고, 양방향으로 상대 메모 UUID 조회가 HTTP 404였다고 보고했습니다. 상대 메모 UUID에 대한 운영 PUT/DELETE 및 본인 DELETE의 최신 운영 재검증은 별도 미확인입니다. 모의 테스트는 운영 검증과 구분합니다.
- 기존 `/data.json` 정적 배포는 차단되어 있고, `/aleph.json`이 배포 식별에 사용됩니다.

## 실제 API 허용 경로

`aleph.config.json`의 `allowedRoutes`에 다음 실제 구현 경로 6개를 기재했습니다.

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| GET | `/api/notes` | 소유자별 가상 메모 |
| GET | `/api/memos` | 본인 메모 목록 |
| POST | `/api/memos` | 본인 메모 추가 |
| GET | `/api/memos/:id` | 소유자 확인 후 한 건 조회 |
| PUT | `/api/memos/:id` | 소유자 확인 후 수정 |
| DELETE | `/api/memos/:id` | 소유자 확인 후 삭제 |

4단계 당시 단계 값은 `4`, 배포 주소는 `https://choi-bujang-secret-vault-one-theta.vercel.app`였습니다. 인증 발급자 및 `judgeIssuer`는 변경하지 않았습니다. 5단계 이전 당시 `originalApiUrl`과 `restoreRoute`는 `null`이었습니다. `src/decider.mjs`의 `starter.deny`는 6단계 이전 기본 거부 규칙입니다.

## 다시 실행하는 방법 (Windows CMD)

```cmd
npm ci && npm run build -- --local && npm run test:r5 && npm run test:package && node --test test/notes.test.mjs test/memos.test.mjs test/stage4-owner.test.mjs test/stage4-attack-check.test.mjs
npm run bundle
```

`npm run bundle` 전에 Git 변경을 모두 검토하고 커밋하고, Git이 무시하는 로컬 `bundle-notes.json`에 가상의 설명을 입력해야 합니다. 생성된 `artifacts/submission.json`과 `bundle-notes.json`은 커밋하지 않습니다. B 계정 1건 표시 문제는 4단계 화면 수정 커밋 `766300ec5c8a`의 변경 및 사용자 화면 확인으로 해결되었습니다. A/B 운영 화면 검증 범위는 위 기록과 같으며, 실행하지 않은 PUT/DELETE 교차 요청은 완료로 표시하지 않습니다. 서버 비밀키, 토큰, 사용자 실명 및 메모 본문은 제출에 넣지 않습니다.

---

# BYTE BACK 방어전 R5 — 3단계 저장점 (2026-10-29)

> **3단계 당시 기록입니다.** 현행 접근 권한은 문서 맨 위 5단계 기록을 참고하세요.

## 현재 작동하는 기능

- Supabase Auth 이메일·비밀번호 로그인과 로그아웃. 서버의 기존 `src/verify-login.mjs`로 토큰을 검증하며, 브라우저가 전송하는 `userId`, `role`, `owner_id`를 인증·권한 근거로 신뢰하지 않습니다.
- 로그인 후 `GET /api/notes`에서 기존 학습용 가상 메모 4건을 조회합니다. 비로그인 요청은 자료 없이 거부하고 로그아웃하면 화면의 메모를 숨깁니다.
- 새 학습용 메모를 `public.user_notes`에 UUID로 저장하고 추가·목록·조회·수정·삭제합니다. 서버가 확인한 사용자 ID로 `owner_id`를 지정합니다.
- 목록은 로그인한 사람의 메모만 반환합니다. **개별 UUID 조회·수정·삭제에는 아직 소유자 조건이 없습니다.** 다른 로그인 사용자가 UUID를 알면 접근할 수 있는 문제는 4단계에서 다룹니다. 실제 개인정보는 넣지 않습니다.
- 공개 `/data.json` 생성을 중단하고 `/aleph.json`에 배포 식별을 기록합니다.

## 3단계 API 경로

| 메서드 | 경로 | 동작 |
| --- | --- | --- |
| GET | `/api/notes` | 인증 후 기존 가상 메모 4건 |
| GET | `/api/memos` | 인증된 사용자의 메모 목록 |
| POST | `/api/memos` | 메모 추가, `{id}` 반환 |
| GET | `/api/memos/:id` | `{id,title,body}` 반환, 없으면 404 |
| PUT | `/api/memos/:id` | 메모 수정 |
| DELETE | `/api/memos/:id` | 메모 삭제 |

`aleph.config.json`의 `step`은 `3`, `allowedRoutes`에는 위 경로 6개가 등록되어 있습니다. Supabase Auth의 `identityProvider` 공개 발급자 정보가 설정되어 있으며 `judgeIssuer`는 유지됩니다. `originalApiUrl`과 `restoreRoute`는 아직 `null`입니다. 서버 비밀키는 Git과 브라우저 코드에 넣지 않습니다.

## 다시 실행하는 방법 (Windows CMD)

```cmd
npm ci && npm run build -- --local && npm run test:r5 && npm run test:package && node --test test/notes.test.mjs && node --test test/memos.test.mjs
npm run bundle
```

`--local`은 로컬 빌드 옵션입니다. `bundle-notes.json`은 로컬 제출 설명, `artifacts/submission.json`은 생성된 제출 묶음이며 **둘 다 Git에 커밋하지 않습니다**. 번들 실행 전에는 변경 파일을 모두 필요한 만큼 커밋해 Git 작업 폴더가 깨끗해야 합니다. `npm run bundle`은 실제 비로그인 API 응답 상태를 학생 자기 점검으로 기록하며 공식 심판 채점 결과가 아닙니다.

## 확인 범위와 남은 약점

2026-10-29 기준 로컬 검사에서 메모 관리 4/4, 기존 자료 API 5/5, R5 3/3, 패키징 3/3 통과 및 로컬 빌드 성공을 확인했습니다. 당시 배포 커밋 `5b51265`는 Vercel 운영 환경에서 READY였고 비로그인 브라우저에서 메모 본문이 보이지 않았으며 자료 API 두 곳에서 `UNAUTHORIZED` 응답을 확인했습니다. 실제 A 계정의 메모 추가·수정·삭제는 학생이 확인했습니다. HTTP 401 상태 코드 자체와 A 계정의 전체 API 호출 내역을 독립적으로 검증한 것은 아닙니다. 4단계 전까지 개별 메모의 소유자 검사 미구현 상태이며 과거 공개 Git·배포 기록도 별개로 남습니다.

---

## 2단계 기록 (이하 내용은 당시 기록이며 현재 상태 설명이 아닙니다)

# BYTE BACK 방어전 R5 — 2단계 서버 API 자료 조회

학습용 **가상 메모 네 건**을 Supabase `public.study_notes`에 보관하고, 홈페이지에서는 Vercel 서버 함수 `GET /api/notes`를 통해 조회합니다. 실제 개인정보·비밀번호·비밀키는 Git, 정적 파일, 브라우저 코드에 저장하지 않습니다.

## 현재 흐름

1. 방문자가 `/`에 접속하면 브라우저가 `GET /api/notes`를 요청합니다.
2. Vercel의 `api/notes.js`가 **서버에서만** `SUPABASE_URL` 및 `SUPABASE_SECRET_KEY` 환경변수를 읽습니다.
3. 서버 함수는 `study_notes`에서 `owner_id IS NULL`이고 이름이 지정된 가상 메모 네 건의 `title`, `content`만 읽습니다.
4. 응답에는 가상 메모 네 건만 포함합니다. 브라우저는 각 항목을 카드로 보여 줍니다.
5. `public/data.json`은 삭제하며, 빌드가 이전 복사본을 발견해도 제거합니다. 따라서 현재 배포의 `/data.json`을 통해 메모가 노출되지 않습니다.

## 보안상 남은 약점 (중요)

**`GET /api/notes`는 현재 공개 주소입니다. 로그인·인증·사용자별 권한 확인이 없어서 URL을 아는 사람은 누구나 가상 메모 네 건을 요청할 수 있습니다.**

서버 전용 Supabase secret key는 브라우저에 전달되지 않지만, **키가 숨겨져 있다는 사실만으로 서버 API 접근이 통제되는 것은 아닙니다.** 따라서 실습용 가상 자료만 조회하고 실제 학생 자료를 넣지 않습니다. 이후 단계에서 인증·인가를 구현해야 합니다.

서버의 secret key는 Supabase RLS(행 수준 보안)를 우회할 수 있으므로 `title`, `content` 두 필드와 지정된 가상 메모 네 건만 응답합니다. 오류 응답·로그에는 내부 오류 정보나 키를 출력하지 않습니다.

## Vercel 환경변수 설정

대상: `choi-bujang-secret-vault` → **Settings → Environment Variables**. 두 변수 모두 서버 전용으로 등록하고 Production에 적용합니다.

| 이름 | 값의 출처 | 공개 여부 |
| --- | --- | --- |
| `SUPABASE_URL` | Supabase `defense-r5-learning` 프로젝트 URL | 서버에서 읽음 |
| `SUPABASE_SECRET_KEY` | Supabase 대시보드 **Settings → API Keys → Secret Keys** | **비밀. 서버에서만 읽음** |

비밀키 값을 이 README, `.env` 파일의 Git 추적 내역, 채팅, 클라이언트 코드 또는 로그에 절대로 넣지 마세요. 비밀 입력란에 직접 등록하세요. Vercel 환경변수를 추가한 뒤 **재배포**해야 적용됩니다.

## 확인 방법

- `npm run build -- --local` — 로컬 빌드, 오래된 `public/data.json` 제거. `--local`은 Vercel 식별 생성을 생략합니다.
- `npm run test:r5` — 배포 식별·공개 JSON 자기 점검 테스트
- `npm run test:package` — 패키징 기준 테스트
- `node --test test/notes.test.mjs` — 서버 함수의 메서드·환경변수·응답 테스트
- `GET /` — 가상 메모 카드 4개 표시 (환경변수 설정·배포 후)
- `GET /api/notes` — 공개 상태에서 가상 메모 4개 반환 (**현재 약점**, 비밀키는 반환 금지)
- `GET /data.json` — `404` 또는 메모가 포함되지 않은 응답
- `GET /aleph.json` — 단계·배포 저장소·커밋 정보 유지, secret key 없음

`aleph.config.json`의 `step`은 `2`이며 빌드·배포 식별 스크립트는 2~12단계를 허용합니다. `judgeIssuer`는 변경하지 않았습니다. `repoUrl` 및 `publicAppUrl`은 실제 GitHub 및 Vercel 주소로 설정했습니다. 배포 식별 정보는 `/aleph.json`의 커밋과 저장소를 대조해 확인합니다.

---

## 공개 가상 메모 원문 노출 재검사 (2026-10-28)

**검사 목적:** 현재 배포 파일과 GitHub `main` 최신 파일에서 가상 메모 원문이 검색되는지 확인하고, **과거 Git 커밋·옛 배포의 노출 문제를 현재 배포의 수정과 구분**합니다. 검색 대상은 `실습용 가상 (과제|포트폴리오|리추얼|행정) 기록`에 맞는 가상 메모 본문 네 문장입니다.

아래 결과는 **2026-10-28, 배포 커밋 `8909c369d83a4b438b6b89b0af4f930df163ed4b` 확인 당시**의 기록입니다. 이후 새 커밋과 배포가 생성되면 검사를 반복해 날짜와 결과를 갱신합니다.

### 1. GitHub 최신 파일 검색 (Windows CMD)

```cmd
git fetch origin
git grep -n -E "실습용 가상 (과제|포트폴리오|리추얼|행정) 기록" origin/main -- .
```

- `git fetch origin`: GitHub의 원격 변경 이력을 가져옵니다. 로컬 작업 파일을 덮어쓰지 않습니다.
- `git grep`: Git이 추적하는 파일의 내용 검색. `-n`은 줄 번호, `-E`는 확장 정규표현식, `origin/main`은 최신 원격 브랜치, `-- .`은 현재 디렉터리 이하 검색 범위입니다. 저장소 루트에서 실행합니다.
- 일치하는 문장이 없다면 결과가 출력되지 않을 수 있습니다(검색 종료 코드 `1`). 출력이 없다는 사실은 **현재 원격 브랜치의 추적 파일에서 해당 문장이 발견되지 않았다는 뜻**이지, 과거 커밋과 공개 API까지 안전하다는 뜻은 아닙니다.
- GitHub의 최신 루트 [`data.json`](data.json)이 `"notes": []`인지 별도로 확인합니다.

### 2. 현재 배포 파일과 공개 API 검색 (Windows CMD, Node.js)

배포 주소: `https://choi-bujang-secret-vault-one-theta.vercel.app`

```cmd
node -e "(async()=>{const base='https://choi-bujang-secret-vault-one-theta.vercel.app';const re=/실습용 가상 (과제|포트폴리오|리추얼|행정) 기록/g;for(const p of ['/','/data.json','/aleph.json','/api/notes']){const r=await fetch(base+p,{cache:'no-store'});const body=await r.text();console.log(p,'HTTP',r.status,'원문 일치:',(body.match(re)||[]).length)}})().catch(e=>{console.error(e);process.exitCode=1})"
```

이 명령은 비로그인 HTTP 요청으로 **상태 코드**와 **가상 메모 본문 원문 일치 횟수**를 출력합니다. 요청 실패를 0건으로 기록하지 마세요. `/`의 원본 HTML과 브라우저에서 JavaScript가 실행된 뒤 나타나는 카드 내용은 서로 다릅니다. 카드는 `/api/notes` 응답으로 표시됩니다. 로그인하지 않은 브라우저에서도 해당 API에 접근할 수 있는지 별도로 확인합니다.

### 3. 과거 Git 커밋과 옛 배포 검색

```cmd
git grep -n -E "실습용 가상 (과제|포트폴리오|리추얼|행정) 기록" d853989f6af1c6b49dae3565af5a42ea968a26a7 -- data.json public/data.json
git log --all --oneline -- data.json public/data.json
```

첫 번째 명령은 **최초 공개 커밋**에 남아 있는 가상 메모 원문을 검사합니다. 두 번째 명령은 로컬에서 확인 가능한 해당 파일의 변경 이력을 보여 줍니다. [최초 커밋의 `public/data.json`](https://github.com/bonsago123-cloud/choi-bujang-secret-vault/blob/d853989f6af1c6b49dae3565af5a42ea968a26a7/public/data.json)도 확인할 수 있습니다.

Vercel의 **Deployments** 목록에서 이전 배포와 고유 URL을 찾고 비로그인 접근 성공·로그인 필요·확인 실패를 구분해 기록합니다. 과거 URL이 존재한다고 해서 모두 현재 공개 상태라고 단정하지 않으며, 확인에 실패했다고 해서 과거 노출이 사라졌다고 판단하지 않습니다.

### 4. 직접 확인한 검색 결과

| 검사 대상 | 검색·응답 결과 | 의미 |
| --- | --- | --- |
| GitHub `main` 추적 파일 전체 (당시) | 가상 메모 원문 4종 완전 일치 **0건** | 최신 추적 파일에 해당 메모 문장이 발견되지 않음 |
| GitHub 루트 `data.json` (당시) | `"notes": []` | 현재 루트 JSON에 메모 본문 없음 |
| 배포 `/`의 정적 HTML (당시) | 원문 일치 **0건** | HTML 원본에는 없지만 JS 실행 후 API의 메모 카드 표시 |
| 배포 `/data.json` (당시) | **HTTP 404** | 현재 정적 공개 경로에서 파일 미제공 |
| 배포 `/aleph.json` (당시) | **HTTP 200**, 2단계, 커밋 `8909c369...`, 원문 일치 **0건** | 확인 당시 배포 식별 정보 |
| 배포 `/api/notes` (당시) | **HTTP 200**, 가상 메모 **4건 원문 반환** | 로그인·사용자별 인가 없이 메모 본문 공개 |
| 최초 Git 커밋 `d853989f6...` | `data.json`에 4건, `public/data.json`에 4건의 원문 존재 | **과거 공개 커밋에서 본문 조회 가능** |
| 이전 Vercel 배포들 | 배포 기록·고유 URL 존재. 일부 로그인 요구, 일부 확인 실패 | 과거 배포의 모든 비로그인 열람 가능 여부는 **미확인** |

이 표는 기록된 날짜와 커밋에 대한 검사 결과입니다. 이후 배포까지 자동 검증했다는 의미는 아닙니다.

### 5. 남은 약점 및 결론

1. **현재 공개 API 노출:** `GET /api/notes`는 인증·인가 없이 가상 메모 4건을 반환합니다. 서버 전용 `SUPABASE_SECRET_KEY`가 브라우저에 전달되지 않는다고 API 응답이 비공개인 것은 아닙니다. 실제 개인정보나 학생 기록을 넣지 않습니다.
2. **과거 공개 이력 잔존:** 최신 `/data.json`의 404와 현재 추적 파일 검색 0건은 **과거 커밋·과거 배포·캐시·제3자 복사본의 노출을 없앤 증거가 아닙니다. 옛 공개 커밋과 옛 배포가 남는 한 과거 노출이 해소됐다고 기록하지 않습니다.**
3. **검사 범위의 한계:** 확인한 공개 저장소·배포 URL·자기 점검 결과에만 해당합니다. 모든 과거 배포를 확인했거나 공식 심판이 합격 판정을 내렸다는 뜻은 아닙니다.

---

## 2단계 저장점 (2026-10-28)

### 1. 현재 작동하는 기능

- Supabase `public.study_notes`에서 실습용 가상 메모 4건을 `GET /api/notes`로 조회합니다.
- 홈페이지 `/`에서 가상 메모 카드를 표시합니다.
- 확인 당시 배포 `/data.json`은 HTTP 404를 반환합니다.
- `/aleph.json`으로 단계·저장소·배포 커밋을 확인합니다.
- 서버 전용 Supabase 비밀키는 브라우저 코드나 API 응답에 넣지 않습니다.
- 가상 메모 원문 검색 결과와 과거 노출 이력을 README에 기록합니다.

### 2. 다시 실행하는 방법

Windows CMD의 저장소 루트에서 실행합니다. Node.js 22 이상을 사용합니다.

```cmd
npm ci
npm run build -- --local
npm run test:r5
npm run test:package
node --test test/notes.test.mjs
npm run bundle
```

- `npm ci`: 잠금 파일을 기준으로 의존성을 설치합니다.
- `npm run build -- --local`: 로컬 공개 파일을 빌드하며 운영 배포 완료를 의미하지 않습니다.
- `npm run test:r5`: 방어전 R5 관련 로컬 테스트를 수행합니다.
- `npm run test:package`: 패키징 기준 테스트를 수행합니다.
- `node --test test/notes.test.mjs`: 메모 API의 로컬 테스트를 수행합니다.
- `npm run bundle`: 최신 로컬 커밋을 기준으로 제출 묶음 JSON을 생성하고 자기 점검을 실행합니다.

`npm run bundle` 실행 전 Git 작업 폴더에 커밋되지 않은 변경이 없어야 합니다. `bundle-notes.json`은 로컬 제출 설명 자료이고, `artifacts/submission.json`은 생성되는 제출 결과물입니다. **두 파일은 Git 커밋에 포함하지 않습니다.**

### 3. 설정 확인

| 항목 | 현재 설정 |
| --- | --- |
| `step` | `2` |
| `repoUrl` | `https://github.com/bonsago123-cloud/choi-bujang-secret-vault` |
| `publicAppUrl` | `https://choi-bujang-secret-vault-one-theta.vercel.app` |
| `judgeIssuer` | 기존 방어전 운영 측 설정 유지 (변경하지 않음) |
| `identityProvider` | `null` |
| `allowedRoutes` | `[]` |
| `originalApiUrl` | `null` |
| `restoreRoute` | `null` |

`identityProvider`, `allowedRoutes`, `originalApiUrl`, `restoreRoute`는 이후 단계에서 사용하는 미구현 설정입니다. `src/decider.mjs`의 현재 규칙 이름 `RULE_IDS`는 시작 틀의 `starter.deny` 한 개입니다. 실제 사용자별 허용 정책이 구현된 것은 아닙니다.

### 4. 자기 점검 및 제출 묶음

`src/attack-check.mjs`의 현재 2단계 점검은 비로그인 상태에서 **`/data.json`에 가상 메모 본문이 남아 있는지** 확인합니다. 이는 공개 `/api/notes`의 인증·인가까지 검사하는 것이 아니므로 둘을 구분해 기록합니다.

제출 묶음의 형식은 다음과 같습니다.

- 스키마: `aleph.defense.submission.v2`
- 단계: `2`
- 커밋: 제출 묶음을 생성하는 시점의 Git `HEAD`
- 정책 규칙: `starter.deny`
- 자기 점검: `anonymous_note_read` (`/data.json` 기준)
- 생성 파일: `artifacts/submission.json`

**새 저장점 커밋 이후 `npm run bundle`을 다시 실행**하여 실제 커밋 번호와 결과를 확인합니다. 실행하지 않은 점검을 완료했다고 기록하지 않으며, 제출 묶음 생성 자체를 공식 심판의 합격 판정이라고 쓰지 않습니다.

### 5. 저장점의 남은 보안 약점

1. **공개 API:** `/api/notes`는 아직 인증 없이 가상 메모 4건을 반환합니다.
2. **과거 Git 이력:** 최초 공개 커밋의 `data.json`과 `public/data.json`에 가상 메모 본문이 남아 있습니다.
3. **과거 배포:** 이전 배포 기록과 URL이 존재하지만 모든 과거 URL의 비로그인 접근 가능 여부는 확인되지 않았습니다.
4. **인증·인가:** 사용자별 접근 통제는 이후 단계에서 구현해야 합니다.

**현재 정적 파일 노출을 제거한 사실과 과거 공개 노출의 해결 여부는 별개입니다.** 과거 공개 이력이 남아 있는 동안 과거 노출이 해소됐다고 판단하거나 기록하지 않습니다.

---

원래의 다른 기능 및 시작 틀 계약은 유지합니다. [AGENTS.md](AGENTS.md)를 참고하세요.
