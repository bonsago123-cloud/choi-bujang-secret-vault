import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SAFETY_POLICY_BASELINE,
  VERIFIED_POLICY_HASH,
  verifyPolicyIntegrity,
  createTamperedPolicy,
  diffPolicies,
  restoreTestPolicy,
} from '../src/policy-restore.mjs';
import {
  RESTORE_TARGET_MEMO_B,
  RESTORE_TARGET_CONTENT_HASH,
  verifyBackupRecord,
  restoreSingleMemoFromBackup,
  sha256,
} from '../src/memo-backup.mjs';

export async function checkRestore() {
  const results = [];

  // 1. 사전 백업 검증
  try {
    verifyPolicyIntegrity(SAFETY_POLICY_BASELINE);
    results.push({ name: '안전 정책 사본 및 SHA-256 해시 검증', passed: true });
  } catch {
    results.push({ name: '안전 정책 사본 및 SHA-256 해시 검증', passed: false });
  }

  // 2. 시험 정책 변조 및 차이점(복원 버전과 변경 범위) 추출
  try {
    const tampered = createTamperedPolicy(SAFETY_POLICY_BASELINE);
    const diff = diffPolicies(SAFETY_POLICY_BASELINE, tampered);
    const passed = diff.targetVersion === SAFETY_POLICY_BASELINE.version
      && diff.targetHash === VERIFIED_POLICY_HASH
      && diff.diffCount === 1
      && diff.differences[0].field === 'dbPolicies.allowCrossOwnerRead';
    results.push({ name: '변조 침공 흉내 및 변경 범위/버전 차이점 산출', passed });
  } catch {
    results.push({ name: '변조 침공 흉내 및 변경 범위/버전 차이점 산출', passed: false });
  }

  // 3. 안전 정책 버전으로 시험 정책 롤백 및 감사 이력 보존
  try {
    const tampered = createTamperedPolicy(SAFETY_POLICY_BASELINE);
    const auditLog = [{ at: '2026-11-06T00:00:00Z', event: 'BASELINE' }];
    const restoreResult = restoreTestPolicy(tampered, { auditLog });
    const passed = restoreResult.success === true
      && restoreResult.restored.dbPolicies.allowCrossOwnerRead === false
      && auditLog.length === 2
      && auditLog[1].event === 'RESTORE_POLICY';
    results.push({ name: '검증된 버전으로 시험 정책 복원 및 감사 이력 보존', passed });
  } catch {
    results.push({ name: '검증된 버전으로 시험 정책 복원 및 감사 이력 보존', passed: false });
  }

  // 4. 가상 메모 B 백업 사본 무결성 검증 (ID·소유자·내용 해시)
  try {
    const verified = verifyBackupRecord(RESTORE_TARGET_MEMO_B.id, RESTORE_TARGET_MEMO_B);
    const passed = verified.verified === true
      && RESTORE_TARGET_MEMO_B.id === 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
      && RESTORE_TARGET_CONTENT_HASH === sha256(RESTORE_TARGET_MEMO_B.body);
    results.push({ name: '시험 계정 B 가상 메모 사본 무결성(ID·소유자·내용해시) 대조', passed });
  } catch {
    results.push({ name: '시험 계정 B 가상 메모 사본 무결성(ID·소유자·내용해시) 대조', passed: false });
  }

  // 5. 비공개 사본에서 단 한 건 복원 및 타 메모 보존
  try {
    const memory = new Map([
      ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', owner_id: '11111111-1111-4111-8111-111111111111', title: 'A 메모', body: 'A 내용' }],
    ]);
    const mockDb = {
      from(table) {
        return {
          insert(val) {
            memory.set(val.id, val);
            return { select() { return { async maybeSingle() { return { data: val, error: null }; } }; } };
          },
        };
      },
    };
    const auditLog = [];
    const restoredOutcome = await restoreSingleMemoFromBackup({
      memoId: RESTORE_TARGET_MEMO_B.id,
      db: mockDb,
      callerUserId: RESTORE_TARGET_MEMO_B.owner_id,
      auditLog,
    });
    const restoredRow = memory.get(RESTORE_TARGET_MEMO_B.id);
    const otherRow = memory.get('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    const passed = restoredOutcome.restored === true
      && restoredRow.id === RESTORE_TARGET_MEMO_B.id
      && restoredRow.owner_id === RESTORE_TARGET_MEMO_B.owner_id
      && sha256(restoredRow.body) === RESTORE_TARGET_CONTENT_HASH
      && otherRow !== undefined
      && auditLog.length === 1;
    results.push({ name: '단 1건 메모 B 복구 및 ID·소유자·내용해시 일치 확인', passed });
  } catch {
    results.push({ name: '단 1건 메모 B 복구 및 ID·소유자·내용해시 일치 확인', passed: false });
  }

  return results;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const results = await checkRestore();
    for (const item of results) {
      process.stdout.write(`${item.passed ? '통과' : '확인 필요'} · ${item.name}\n`);
    }
    process.stdout.write('10단계 복원 검증 완료 (가상 연습이며 공식 심판 채점과 별개입니다).\n');
    if (results.some(item => !item.passed)) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`복원 점검 첫 오류: ${error.message}\n`);
    process.exitCode = 1;
  }
}
