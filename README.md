# BYTE BACK 방어전 시작 틀 R5 — 2단계 자료 분리

1단계의 동일한 자료실을 이어서 사용합니다. 실제 개인정보·비밀번호·비밀키를 Git에 넣지 않습니다.

## 단계 기록

- 1단계: 공개 홈페이지·가상 메모·배포 식별 파일을 확인했습니다.
- 2단계: 원본 `data.json`과 `public/data.json`에서 메모를 제거하고 빌드의 원본 메모 복사를 중단했습니다.
- 별도로 제공한 SQL 파일을 Supabase SQL Editor에서 직접 실행해야 가상 메모 네 건이 DB에 저장됩니다. SQL 실행 여부는 아직 확인되지 않았습니다.
- 아직 DB 조회 API와 로그인 기능은 구현하지 않았습니다. 홈페이지는 공개 메모가 없다는 상태를 보여 줍니다.

## 확인과 실행

- `npm run build -- --local`: 로컬에서 정적 파일 생성 검사 (`--local`은 Vercel 식별 파일 생성을 건너뜁니다).
- Vercel 배포 시에는 `npm run build`로 저장소·커밋·배포 주소를 식별합니다.
- `GET /data.json`: `notes: []`의 빈 공개 목록을 반환합니다.
- `GET /aleph.json`: 배포 저장소·커밋·단계를 기록합니다.
- SQL Editor에서 `owner_id uuid`, RLS, 두 웹 역할의 `SELECT` 권한 제거, 가상 메모 네 건을 확인해야 합니다.

기존 `judgeIssuer`는 변경하지 않았으며, `repoUrl`과 `publicAppUrl`은 이후 단계 설정을 위한 자리표시자로 유지했습니다.

기타 작업과 원래 계약 문서는 보존합니다. 수정 전 [AGENTS.md](AGENTS.md)를 참조하세요.
