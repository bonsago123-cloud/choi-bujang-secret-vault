-- 방어전 R5 5단계: 학습용 메모 테이블 직접 접근 회수
-- 대상: public.study_notes 및 public.user_notes 두 테이블만
-- 실행 기록: 2026-10-30 학습 DB에서 아래 SQL 적용 및 권한 재검증 완료.
-- 재실행은 필요할 때만 검토 후 진행하며, 이 파일 자체를 열어 보는 것은 DB를 변경하지 않음.
-- 기존 서비스는 service_role 서버 키를 사용하므로 해당 역할의 직접 권한을 회수하지 않는다.
-- 로그인(Auth), RLS 정책, 다른 테이블, 시퀀스 및 실제 메모 데이터는 변경하지 않는다.

BEGIN;

REVOKE ALL PRIVILEGES
ON TABLE public.study_notes, public.user_notes
FROM PUBLIC, anon, authenticated;

COMMIT;
