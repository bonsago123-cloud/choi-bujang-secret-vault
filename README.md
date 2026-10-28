# BYTE BACK 방어전 R5 — 2단계 서버 API 자료 조회

학습용 **가상 메모 네 건**을 Supabase `public.study_notes`에 보관하고, 홈페이지에서는 Vercel 서버 함수 `GET /api/notes`를 통해 조회합니다. 실제 개인정보·비밀번호·비밀키는 Git, 정적 파일, 브라우저 코드에 저장하지 않습니다.

## 현재 흐름

1. 방문자가 `/`에 접속하면 브라우저가 `GET /api/notes`를 요청합니다.
2. Vercel의 `api/notes.js`가 **서버에서만** `SUPABASE_URL` 및 `SUPABASE_SECRET_KEY` 환경변수를 읽습니다.
3. 서버 함수는 `study_notes`에서 `owner_id IS NULL`이고 이름이 지정된 가상 메모 네 건의 `title`, `content`만 읽습니다.
4. 응답에는 가상 메모 네 건만 포함합니다. 브라우저는 각 항목을 카드로 보여 줍니다.
5. `public/data.json`은 삭제하며, 빌드가 이전 복사본을 발견해도 제거합니다. 따라서 `/data.json`을 통해 메모가 노출되지 않습니다.

## 보안상 남은 약점 (중요)

**`GET /api/notes`는 현재 공개 주소입니다. 로그인·인증·사용자별 권한 확인이 없어서, URL을 아는 사람은 누구나 가상 메모 네 건을 요청할 수 있습니다.** 서버 전용 Supabase secret key는 브라우저에 전달되지 않지만, **키가 숨겨져 있다는 사실만으로 서버 API 접근이 통제되는 것은 아닙니다.** 따라서 실습용 가상 자료만 조회하고 실제 학생 자료를 넣지 않습니다. 이후 단계에서 인증·인가를 구현해야 합니다.

서버의 secret key는 Supabase RLS(행 수준 보안)를 우회할 수 있으므로 `title`, `content` 두 필드와 지정된 가상 메모 네 건만 응답합니다. 오류 응답·로그에는 내부 오류 정보나 키를 출력하지 않습니다.

## Vercel 환경변수 설정

대상: `choi-bujang-secret-vault` → **Settings → Environment Variables**. 두 변수 모두 서버 전용으로 등록하고 Production에 적용합니다.

| 이름 | 값의 출처 | 공개 여부 |
| --- | --- | --- |
| `SUPABASE_URL` | Supabase `defense-r5-learning` 프로젝트 URL | 서버에서 읽음 |
| `SUPABASE_SECRET_KEY` | Supabase 대시보드 **Settings → API Keys → Secret Keys** | **비밀. 서버에서만 읽음** |

비밀키 값을 이 README, `.env` 파일의 Git 추적 내역, 채팅, 클라이언트 코드 또는 로그에 절대로 넣지 마세요. 비밀 입력란에 직접 등록하세요. Vercel 환경변수를 추가한 뒤 **재배포**해야 적용됩니다.

## 확인 방법

- `npm run build -- --local` — 로컬 빌드, 오래된 `public/data.json` 제거, `--local`은 Vercel 식별 생성을 생략
- `npm run test:r5` — 배포 식별·공개 JSON 자기점검 테스트
- `npm run test:package` — 패키징 기준 테스트
- `node --test test/notes.test.mjs` — 서버 함수의 메서드·환경변수·응답 테스트
- `GET /`: 가상 메모 카드 4개 표시 (환경변수 설정·배포 후)
- `GET /api/notes`: 공개 상태에서 가상 메모 4개를 반환 (**현재 약점**, 비밀키는 반환 금지)
- `GET /data.json`: `404` 또는 메모가 포함되지 않은 응답
- `GET /aleph.json`: 단계·배포 저장소·커밋 정보 유지, secret key 없음

`aleph.config.json`의 `step`은 `2`이며 빌드·배포 식별 스크립트는 2~12단계를 허용합니다. `judgeIssuer`는 변경하지 않았습니다. 기존 `repoUrl` 및 `publicAppUrl` 자리표시자 값은 별도의 설정 작업이며, 실제 배포 판정은 `/aleph.json`의 Vercel 자동 식별 정보로 확인합니다.

원래의 다른 기능 및 시작 틀 계약은 유지합니다. [AGENTS.md](AGENTS.md)를 참고하세요.
