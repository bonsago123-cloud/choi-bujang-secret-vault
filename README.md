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

`aleph.config.json`의 `step`은 `2`이며 빌드·배포 식별 스크립트는 2~12단계를 허용합니다. `judgeIssuer`는 변경하지 않았습니다. `repoUrl` 및 `publicAppUrl`은 실제 GitHub 및 Vercel 주소로 설정했습니다. 배포 식별 정보는 `/aleph.json`의 커밋과 저장소를 대조해 확인합니다.


## 공개 가상 메모 원문 노출 재검사 (2026-10-28)

**검사 목적:** 현재 배포 파일과 GitHub `main` 최신 파일에서 가상 메모 원문이 검색되는지 확인하고, **과거 Git 커밋·옛 배포의 노출 문제를 현재 배포의 수정과 구분**합니다. 검색 대상은 `실습용 가상 (과제|포트폴리오|리추얼|행정) 기록`에 맞는 가상 메모 본문 네 문장입니다. 아래 확인 결과는 커밋 `6bb4d8591b40028b70ac3e446c176026a3f151eb` 당시의 기록입니다. 다음 커밋에서는 검사를 반복해 날짜와 결과를 갱신합니다.

### 1. GitHub 최신 파일 검색 (Windows CMD)

```cmd
git fetch origin
git grep -n -E "실습용 가상 (과제|포트폴리오|리추얼|행정) 기록" origin/main -- .
```

- `git fetch origin`: 원격 GitHub 변경 이력을 가져옵니다. 로컬 파일은 덮어쓰지 않습니다.
- `git grep`: Git에 추적된 파일 내용 검색. `-n`은 줄 번호, `-E`는 확장 정규표현식, `origin/main`은 최신 원격 브랜치, `-- .`은 저장소 전체입니다.
- 일치 문장이 없다면 결과가 출력되지 않을 수 있습니다(검색 종료 코드 1). 출력이 없다는 사실은 **현재 브랜치의 추적 파일에서 검색한 문장이 없다는 뜻**이지, 과거 커밋과 공개 API까지 안전하다는 뜻은 아닙니다.
- GitHub의 최신 루트 [`data.json`](data.json)이 `"notes": []`인지 별도로 확인하세요.

### 2. 현재 배포 파일과 공개 API 검색 (Windows CMD, Node.js)

```cmd
node -e "(async()=>{const base='https://choi-bujang-secret-vault-one-theta.vercel.app';const re=/실습용 가상 (과제|포트폴리오|리추얼|행정) 기록/g;for(const p of ['/','/data.json','/aleph.json','/api/notes']){const r=await fetch(base+p,{cache:'no-store'});const body=await r.text();console.log(p,'HTTP',r.status,'원문 일치:',(body.match(re)||[]).length)}})().catch(e=>{console.error(e);process.exitCode=1})"
```

이 검사는 비로그인 HTTP 요청에서 **상태 코드**와 **가상 메모 본문 원문 일치 횟수**만 출력합니다. 요청 실패를 0건으로 기록하지 마세요. `/`의 원본 HTML과 브라우저에서 JavaScript가 실행된 뒤 나타나는 카드 내용은 서로 다릅니다. 카드 내용은 `/api/notes` 응답으로 표시됩니다. 로그인 없는 브라우저에서도 API를 별도로 열어 접근 가능 여부를 확인하세요.

### 3. 과거 Git 커밋과 옛 배포 검색

```cmd
git grep -n -E "실습용 가상 (과제|포트폴리오|리추얼|행정) 기록" d853989f6af1c6b49dae3565af5a42ea968a26a7 -- data.json public/data.json
git log --all --oneline -- data.json public/data.json
```

첫 명령은 **최초 공개 커밋**에 남아 있는 가상 메모 원문을 검사합니다. 두 번째 명령은 해당 파일의 로컬에서 확인 가능한 변경 이력을 나열합니다. 웹에서 [최초 커밋의 `public/data.json`](https://github.com/bonsago123-cloud/choi-bujang-secret-vault/blob/d853989f6af1c6b49dae3565af5a42ea968a26a7/public/data.json)도 다시 열 수 있습니다. Vercel의 **Deployments** 목록에서 옛 배포 및 배포별 고유 URL을 확인하고, 비로그인 접근 성공·로그인 요구·확인 실패를 구분해 기록하세요.

### 4. 직접 확인한 검색 결과

| 검사 대상 | 검색·응답 결과 | 의미 |
| --- | --- | --- |
| GitHub 최신 `main`의 추적 파일 전체 | 가상 메모 원문 4종의 완전 일치 **0건** | 최신 저장소 추적 파일에는 해당 본문 문장이 없음 |
| GitHub 최신 루트 `data.json` | `"notes": []` | 현재 GitHub 루트 JSON에는 메모 본문 없음 |
| 현재 배포 `/`의 정적 HTML | 원문 일치 **0건** | HTML 원본에는 없지만 JS 실행 후 API의 메모 카드가 표시됨 |
| 현재 배포 `/data.json` | **HTTP 404** | 현재 정적 공개 경로에서 파일을 제공하지 않음 |
| 현재 배포 `/aleph.json` | **HTTP 200**, 2단계·커밋 `6bb4d859...`, 원문 일치 **0건** | 현재 배포 식별 정보 유지 |
| 현재 배포 `/api/notes` | **HTTP 200**, 가상 메모 **4건 원문 반환** | 로그인·사용자별 인가 없이 메모 본문 공개 중 |
| 최초 Git 커밋 `d853989f6...` | `data.json`에 **4건**, `public/data.json`에 **4건**의 원문 존재 | **과거 공개 커밋에서 본문을 여전히 조회 가능** |
| 이전 Vercel 배포들 | 배포 기록·고유 URL 존재. 일부 요청은 로그인 요구, 일부 확인 실패 | 과거 배포의 모든 비로그인 열람 가능 여부는 **미확인** |

### 5. 남은 약점 및 결론

1. **현재 공개 API 노출:** `GET /api/notes`는 인증·인가 없이 가상 메모 4건을 반환합니다. Vercel의 서버 전용 `SUPABASE_SECRET_KEY`가 브라우저에 전달되지 않는다고 해서 API 응답이 비공개인 것은 아닙니다. 실제 개인정보나 실제 학생 기록을 넣지 않습니다.
2. **과거 공개 이력 잔존:** 최신 `/data.json`의 404와 최신 Git 파일의 검색 0건은 **과거 커밋·과거 배포·캐시·제3자 복사본의 노출을 없앤 증거가 아닙니다.** 옛 공개 커밋과 옛 배포가 남는 한 **과거 노출이 해소됐다고 기록하지 않습니다.**
3. **검사 범위의 한계:** 이 기록은 확인한 공개 저장소·배포 URL·자기 점검 결과에만 해당합니다. 모든 과거 배포를 확인했거나 심판이 최종 합격 판정을 내렸다는 뜻은 아닙니다.

원래의 다른 기능 및 시작 틀 계약은 유지합니다. [AGENTS.md](AGENTS.md)를 참고하세요.
