import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  SAFETY_POLICY_BASELINE,
  VERIFIED_POLICY_HASH,
  computePolicyHash,
  verifyPolicyIntegrity,
  createTamperedPolicy,
  diffPolicies,
  restoreTestPolicy,
} from '../src/policy-restore.mjs';
import {
  RESTORE_TARGET_MEMO_B,
  RESTORE_TARGET_CONTENT_HASH,
  VIRTUAL_MEMO_BACKUP_STORE,
  verifyBackupRecord,
  restoreSingleMemoFromBackup,
  sha256,
} from '../src/memo-backup.mjs';
import { createMemoRestoreHandler } from '../api/restore/index.js';
import { createMemoItemHandler } from '../api/memo.js';

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const MEMO_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const authB = 'Bearer bb.bb.bb';
const authA = 'Bearer aa.aa.aa';

function makeMockDb() {
  const rows = new Map([
    [MEMO_A, { id: MEMO_A, owner_id: USER_A, title: 'A 메모', body: 'A의 비밀 자료' }],
  ]);
  const db = {
    from(table) {
      assert.equal(table, 'user_notes');
      let mode = 'select';
      let values = null;
      const match = [];
      const builder = {
        select() { return this; },
        eq(k, v) { match.push([k, v]); return this; },
        order() { return this; },
        insert(val) { mode = 'insert'; values = val; return this; },
        update(val) { mode = 'update'; values = val; return this; },
        delete() { mode = 'delete'; return this; },
        async maybeSingle() {
          const outcome = await run();
          return { data: outcome.data[0] ?? null, error: outcome.error };
        },
        async single() {
          const outcome = await run();
          return { data: outcome.data[0] ?? null, error: outcome.error };
        },
        then(onSuccess, onFailure) { return run().then(onSuccess, onFailure); },
      };
      async function run() {
        if (mode === 'insert') {
          if (rows.has(values.id)) return { data: [], error: { code: '23505' } };
          rows.set(values.id, { ...values });
          return { data: [rows.get(values.id)], error: null };
        }
        const selected = [...rows.values()].filter(row => match.every(([k, v]) => row[k] === v));
        return { data: selected, error: null };
      }
      return builder;
    },
  };
  return { db, rows };
}

async function invoke(handler, method, { id, body, authorization } = {}) {
  let statusCode = 200;
  let payload;
  const headers = new Map();
  const request = {
    method,
    headers: authorization ? { authorization } : {},
    body,
    query: { id },
  };
  const response = {
    setHeader(key, value) { headers.set(key.toLowerCase(), value); return this; },
    status(code) { statusCode = code; return this; },
    json(value) { payload = value; return this; },
  };
  await handler(request, response);
  return { statusCode, payload, headers };
}

test('10단계 안전 정책 사본과 해시 검증 및 변조 탐지/비교', () => {
  // 1. 사본과 확인용 해시 생성 확인
  assert.equal(typeof VERIFIED_POLICY_HASH, 'string');
  assert.equal(VERIFIED_POLICY_HASH.length, 64);
  assert.equal(verifyPolicyIntegrity(SAFETY_POLICY_BASELINE), true);

  // 2. 사본이 없거나 해시가 다르면 중단
  assert.throws(() => verifyPolicyIntegrity(null), /사본이 없습니다/u);
  assert.throws(() => verifyPolicyIntegrity({ ...SAFETY_POLICY_BASELINE, version: 'fake' }), /해시가 일치하지 않습니다/u);

  // 3. 시험용 사본 한 줄 변조 (침공 흉내)
  const tampered = createTamperedPolicy(SAFETY_POLICY_BASELINE);
  assert.equal(tampered.dbPolicies.allowCrossOwnerRead, true);
  assert.notEqual(computePolicyHash(tampered), VERIFIED_POLICY_HASH);

  // 4. 검증한 사본과 시험 정책의 차이만 표시 (복원할 버전과 변경 범위 표시)
  const diff = diffPolicies(SAFETY_POLICY_BASELINE, tampered);
  assert.equal(diff.targetVersion, SAFETY_POLICY_BASELINE.version);
  assert.equal(diff.targetHash, VERIFIED_POLICY_HASH);
  assert.equal(diff.diffCount, 1);
  assert.deepEqual(diff.differences, [
    {
      field: 'dbPolicies.allowCrossOwnerRead',
      change: 'modified',
      current: true,
      restored: false,
    },
  ]);
});

test('10단계 안전 정책 되돌리기 및 복원 후 인가 재검증', async () => {
  const tampered = createTamperedPolicy(SAFETY_POLICY_BASELINE);
  const auditLog = [{ at: '2026-11-06T00:00:00Z', event: 'INIT_SYSTEM' }];

  // 복원 절차 실행: 바뀔 항목(plan) 확인 및 감사 이력 보존
  const result = restoreTestPolicy(tampered, { auditLog });
  assert.equal(result.success, true);
  assert.equal(result.plan.differences.length, 1);
  assert.equal(result.restored.dbPolicies.allowCrossOwnerRead, false);

  // 감사 이력 보존 확인
  assert.equal(auditLog.length, 2);
  assert.equal(auditLog[0].event, 'INIT_SYSTEM');
  assert.equal(auditLog[1].event, 'RESTORE_POLICY');

  // 정책 복원 후 확인: B의 A 자료 요청은 거부되고, A 정상 요청은 유지
  const { db } = makeMockDb();
  const verifyMock = async (token) => {
    if (token === authA) return { kind: 'student', userId: USER_A };
    if (token === authB) return { kind: 'student', userId: USER_B };
    return null;
  };

  const memoItemHandler = createMemoItemHandler({
    verify: verifyMock,
    makeDb: () => db,
  });

  // A의 본인 자료 정상 요청 -> 200 유지
  const resA = await invoke(memoItemHandler, 'GET', { id: MEMO_A, authorization: authA });
  assert.equal(resA.statusCode, 200);
  assert.equal(resA.payload.id, MEMO_A);
  assert.equal(resA.payload.title, 'A 메모');

  // B의 A 자료 접근 시도 -> 거부 (404/403) 및 자료 노출 차단
  const resB = await invoke(memoItemHandler, 'GET', { id: MEMO_A, authorization: authB });
  assert.ok([403, 404].includes(resB.statusCode));
  assert.doesNotMatch(JSON.stringify(resB.payload), /A의 비밀 자료/u);

  // DB가 잘못되어 B에게 A 행을 반환하더라도 서버 수준에서 403 ACCESS_DENIED로 거부
  const leakedRow = { id: MEMO_A, owner_id: USER_A, title: 'A 메모', body: 'A의 비밀 자료' };
  const leakyDbHandler = createMemoItemHandler({
    verify: verifyMock,
    makeDb: () => ({
      from() {
        return {
          select() { return this; }, eq() { return this; },
          async maybeSingle() { return { data: leakedRow, error: null }; },
        };
      },
    }),
  });
  const resBLeaky = await invoke(leakyDbHandler, 'GET', { id: MEMO_A, authorization: authB });
  assert.equal(resBLeaky.statusCode, 403);
  assert.deepEqual(resBLeaky.payload, { error: 'ACCESS_DENIED' });
  assert.doesNotMatch(JSON.stringify(resBLeaky.payload), /A의 비밀 자료/u);
});

test('10단계 시험 계정 B 가상 메모 복원 대상 정보와 무결성 해시 대조', () => {
  // 복원 대상 메모 ID와 내용 해시
  assert.equal(RESTORE_TARGET_MEMO_B.id, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  assert.equal(RESTORE_TARGET_MEMO_B.owner_id, USER_B);
  assert.equal(RESTORE_TARGET_CONTENT_HASH, sha256(RESTORE_TARGET_MEMO_B.body));

  // 비공개 사본에서 무결성 검증
  const verified = verifyBackupRecord(RESTORE_TARGET_MEMO_B.id, RESTORE_TARGET_MEMO_B);
  assert.equal(verified.verified, true);

  // 내용이나 소유자가 다르면 실패
  assert.throws(() => verifyBackupRecord(RESTORE_TARGET_MEMO_B.id, {
    ...RESTORE_TARGET_MEMO_B,
    body: '변조된 본문',
  }), /백업 무결성 검증 실패/u);
});

test('10단계 POST 복원 API: 비로그인 및 타인 요청 거절, B 본인 1건 정상 복원', async () => {
  const { db, rows } = makeMockDb();
  const auditLog = [{ at: '2026-11-06T00:00:00Z', event: 'SYSTEM_BOOT' }];

  const verifyMock = async (token) => {
    if (token === authA) return { kind: 'student', userId: USER_A };
    if (token === authB) return { kind: 'student', userId: USER_B };
    return null;
  };

  const handler = createMemoRestoreHandler({
    verify: verifyMock,
    makeDb: () => db,
    auditLog,
  });

  // 1. 비로그인 요청 -> 401
  const anon = await invoke(handler, 'POST', { body: { memoId: RESTORE_TARGET_MEMO_B.id } });
  assert.equal(anon.statusCode, 401);
  assert.deepEqual(anon.payload, { error: 'UNAUTHORIZED' });

  // 2. 다른 사용자 A가 B의 메모 복원 시도 -> 403 거부
  const crossUser = await invoke(handler, 'POST', {
    authorization: authA,
    body: { memoId: RESTORE_TARGET_MEMO_B.id },
  });
  assert.equal(crossUser.statusCode, 403);
  assert.deepEqual(crossUser.payload, { error: 'ACCESS_DENIED' });

  // 3. B가 아닌 알 수 없는 메모 ID 복원 시도 -> 404
  const unknownMemo = await invoke(handler, 'POST', {
    authorization: authB,
    body: { memoId: '33333333-3333-4333-8333-333333333333' },
  });
  assert.equal(unknownMemo.statusCode, 404);

  // 4. B의 정상 복원 요청 -> 200 OK
  const restoreRes = await invoke(handler, 'POST', {
    authorization: authB,
    body: { memoId: RESTORE_TARGET_MEMO_B.id },
  });
  assert.equal(restoreRes.statusCode, 200);
  assert.equal(restoreRes.payload.restored, true);
  assert.equal(restoreRes.payload.id, RESTORE_TARGET_MEMO_B.id);
  assert.equal(restoreRes.payload.owner_id, USER_B);
  assert.equal(restoreRes.payload.contentHash, RESTORE_TARGET_CONTENT_HASH);

  // 5. 복구 대상 한 건의 ID·소유자·내용 해시가 사본과 같아야 함
  const restoredRow = rows.get(RESTORE_TARGET_MEMO_B.id);
  assert.ok(restoredRow);
  assert.equal(restoredRow.id, RESTORE_TARGET_MEMO_B.id);
  assert.equal(restoredRow.owner_id, RESTORE_TARGET_MEMO_B.owner_id);
  assert.equal(sha256(restoredRow.body), RESTORE_TARGET_CONTENT_HASH);

  // 6. 다른 메모(A 메모)와 감사 기록 보존 확인
  assert.ok(rows.has(MEMO_A));
  assert.equal(rows.get(MEMO_A).owner_id, USER_A);
  assert.equal(auditLog.length, 2);
  assert.equal(auditLog[0].event, 'SYSTEM_BOOT');
  assert.equal(auditLog[1].event, 'RESTORE_MEMO');
  assert.equal(auditLog[1].memoId, RESTORE_TARGET_MEMO_B.id);
});
