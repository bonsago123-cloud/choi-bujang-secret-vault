-- 방어전 R5 5단계: 권한 확인 전용 (데이터/권한 변경 없음)
-- 2026-10-30 권한 회수 전후 실행하여 예상 결과를 확인했다.
-- 이후에도 읽기 전용으로 실행하여 현재 권한을 재확인할 수 있다.
-- 예상 (실행 후): 두 테이블 모두 anon/authenticated의 네 권한은 false,
-- service_role 네 권한은 true. 테이블 RLS는 계속 true.

SELECT
    c.relname AS table_name,
    c.relrowsecurity AS rls_enabled,
    r.role_name,
    has_table_privilege(r.role_name, c.oid, 'SELECT') AS can_select,
    has_table_privilege(r.role_name, c.oid, 'INSERT') AS can_insert,
    has_table_privilege(r.role_name, c.oid, 'UPDATE') AS can_update,
    has_table_privilege(r.role_name, c.oid, 'DELETE') AS can_delete
FROM pg_class AS c
JOIN pg_namespace AS n
    ON n.oid = c.relnamespace
CROSS JOIN (
    VALUES ('anon'), ('authenticated'), ('service_role')
) AS r(role_name)
WHERE n.nspname = 'public'
  AND c.relkind IN ('r','p')
  AND c.relname IN ('study_notes', 'user_notes')
ORDER BY c.relname, r.role_name;

-- 아래는 PUBLIC/anon/authenticated 역할에 직접 부여된 테이블 권한 확인.
-- 권한 회수 후 0행이어야 한다.
SELECT
    c.relname AS table_name,
    CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee,
    a.privilege_type
FROM pg_class AS c
JOIN pg_namespace AS n
    ON n.oid = c.relnamespace
CROSS JOIN LATERAL aclexplode(
    COALESCE(c.relacl, acldefault('r', c.relowner))
) AS a
WHERE n.nspname = 'public'
  AND c.relname IN ('study_notes', 'user_notes')
  AND a.grantee IN (
    0,
    'anon'::regrole::oid,
    'authenticated'::regrole::oid
  )
ORDER BY c.relname, grantee, a.privilege_type;
