import { createHash } from 'node:crypto';

// 시험 계정 B의 가상 메모 복원 대상 정보
export const TEST_USER_B_ID = '22222222-2222-4222-8222-222222222222';
export const RESTORE_TARGET_MEMO_B = Object.freeze({
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  owner_id: TEST_USER_B_ID,
  title: 'B 계정 가상 메모',
  body: '실습용 가상 B 계정 백업 복원 메모',
});

export function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export const RESTORE_TARGET_CONTENT_HASH = sha256(RESTORE_TARGET_MEMO_B.body);

// 비공개 가상 메모 백업 저장소 (기밀 사본)
export const VIRTUAL_MEMO_BACKUP_STORE = new Map([
  [
    RESTORE_TARGET_MEMO_B.id,
    Object.freeze({
      ...RESTORE_TARGET_MEMO_B,
      contentHash: RESTORE_TARGET_CONTENT_HASH,
      backedUpAt: '2026-11-06T12:00:00.000Z',
    }),
  ],
]);

// 복구 대상 메모의 ID·소유자·내용 해시 대조 검증
export function verifyBackupRecord(targetId, candidateRecord) {
  const backup = VIRTUAL_MEMO_BACKUP_STORE.get(targetId);
  if (!backup) {
    throw new Error('비공개 가상 메모 사본에 해당 ID가 존재하지 않습니다.');
  }

  const matchesId = candidateRecord.id === backup.id;
  const matchesOwner = candidateRecord.owner_id === backup.owner_id;
  const candidateHash = candidateRecord.contentHash ?? sha256(candidateRecord.body ?? '');
  const matchesHash = candidateHash === backup.contentHash;

  if (!matchesId || !matchesOwner || !matchesHash) {
    throw new Error(`백업 무결성 검증 실패: ID(${matchesId}), 소유자(${matchesOwner}), 내용해시(${matchesHash})`);
  }

  return {
    verified: true,
    backup,
  };
}

// 비공개 사본에서 단 한 건의 B 계정 가상 메모 복원 처리
export async function restoreSingleMemoFromBackup({
  memoId,
  db,
  callerUserId,
  auditLog = [],
}) {
  if (typeof memoId !== 'string' || memoId !== RESTORE_TARGET_MEMO_B.id) {
    throw new Error('복원 대상은 시험 계정 B의 지정된 가상 메모 ID여야 합니다.');
  }

  const backup = VIRTUAL_MEMO_BACKUP_STORE.get(memoId);
  if (!backup) {
    throw new Error('사본을 찾을 수 없습니다.');
  }

  // 요청자가 B 본인인지 또는 권한이 있는지 검증
  if (callerUserId && callerUserId !== backup.owner_id) {
    throw new Error('소유자가 일치하지 않는 복원 요청은 거절됩니다.');
  }

  // ID·소유자·내용 해시 대조
  verifyBackupRecord(memoId, backup);

  // DB에 복구 대상 1건 삽입/복원 (기존 다른 메모 및 감사 이력 보존)
  const memoToRestore = {
    id: backup.id,
    owner_id: backup.owner_id,
    title: backup.title,
    body: backup.body,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await db.from('user_notes').insert(memoToRestore).select().maybeSingle();
  if (error && error.code !== '23505') {
    throw new Error(`DB 복원 중 오류 발생: ${error.message ?? error.code}`);
  }

  // 감사 기록에 복원 기록 추가 (기존 감사 기록 보존)
  auditLog.push({
    at: new Date().toISOString(),
    event: 'RESTORE_MEMO',
    memoId: backup.id,
    owner_id: backup.owner_id,
    contentHash: backup.contentHash,
  });

  return {
    restored: true,
    memo: memoToRestore,
    contentHash: backup.contentHash,
  };
}
