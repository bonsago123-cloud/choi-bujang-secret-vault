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

// Approved fixture digest, pinned independently of mutable backup-store contents.
export const RESTORE_TARGET_CONTENT_HASH = '41f62fc4341f65fafff4db5d21ff1c932885956ac2e0029ff3280629c9b8939c';
if (sha256(RESTORE_TARGET_MEMO_B.body) !== RESTORE_TARGET_CONTENT_HASH) {
  throw new Error('승인된 B 메모 백업 본문 해시가 다릅니다.');
}

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
  if (!backup) throw new Error('비공개 가상 메모 사본에 해당 ID가 존재하지 않습니다.');
  // Never trust a supplied contentHash without hashing the actual body.
  // The approved digest is pinned independently of the live Map and candidate input.
  const validBackup = backup.id === RESTORE_TARGET_MEMO_B.id
    && backup.owner_id === TEST_USER_B_ID
    && typeof backup.body === 'string'
    && sha256(backup.body) === RESTORE_TARGET_CONTENT_HASH
    && backup.contentHash === RESTORE_TARGET_CONTENT_HASH;
  const validCandidate = candidateRecord && candidateRecord.id === backup.id
    && candidateRecord.owner_id === backup.owner_id
    && typeof candidateRecord.body === 'string'
    && sha256(candidateRecord.body) === RESTORE_TARGET_CONTENT_HASH
    && (candidateRecord.contentHash === undefined
      || candidateRecord.contentHash === RESTORE_TARGET_CONTENT_HASH);
  if (!validBackup || !validCandidate) throw new Error('백업 무결성 검증 실패: ID·소유자·실제 본문 해시 불일치');
  return { verified: true, backup };
}

// 비공개 사본에서 단 한 건의 B 계정 가상 메모 복원 처리
export async function restoreSingleMemoFromBackup({
  memoId,
  db,
  callerUserId,
  auditLog = [],
}) {
  if (memoId !== RESTORE_TARGET_MEMO_B.id) {
    throw new Error('복원 대상은 시험 계정 B의 지정된 가상 메모 ID여야 합니다.');
  }
  if (callerUserId !== TEST_USER_B_ID) {
    throw new Error('소유자가 일치하지 않는 복원 요청은 거절됩니다.');
  }
  // 1. The trusted backup and its actual body must be verified before ANY DB write.
  const initialBackup = VIRTUAL_MEMO_BACKUP_STORE.get(memoId);
  verifyBackupRecord(memoId, initialBackup);

  // 2. Determine the exact row affected; reject any ownership conflict without writing.
  const { data: existing, error: readError } = await db.from('user_notes')
    .select('id,owner_id,title,body').eq('id', memoId).maybeSingle();
  if (readError) throw new Error('복원 대상의 기존 상태를 읽지 못했습니다.');
  if (existing && existing.owner_id !== TEST_USER_B_ID) {
    throw new Error('기존 메모 소유자가 사본과 다릅니다. 복원을 중단합니다.');
  }

  // 3. Re-read the backup IMMEDIATELY before the mutation. Do not trust a stale preflight.
  const freshBackup = VIRTUAL_MEMO_BACKUP_STORE.get(memoId);
  verifyBackupRecord(memoId, freshBackup);
  if (freshBackup.backedUpAt !== initialBackup.backedUpAt) {
    throw new Error('검증 중 백업 버전이 변경됐습니다. 복원을 중단합니다.');
  }
  const memoToRestore = {
    id: freshBackup.id,
    owner_id: freshBackup.owner_id,
    title: freshBackup.title,
    body: freshBackup.body,
    updated_at: new Date().toISOString(),
  };

  // 4. Restore ONLY this row. INSERT cannot repair an already-existing tampered row.
  // A concurrent change must not be silently overwritten.
  let outcome;
  if (existing) {
    outcome = await db.from('user_notes')
      .update({ title: memoToRestore.title, body: memoToRestore.body,
        updated_at: memoToRestore.updated_at })
      .eq('id', memoId).eq('owner_id', TEST_USER_B_ID)
      .eq('body', existing.body).eq('title', existing.title)
      .select('id,owner_id,title,body').maybeSingle();
  } else {
    outcome = await db.from('user_notes').insert(memoToRestore)
      .select('id,owner_id,title,body').maybeSingle();
  }
  if (outcome.error || !outcome.data) {
    throw new Error('대상 메모 한 건의 복원 실패 또는 동시 수정 충돌');
  }
  // 5. Verify the DB-returned row before reporting success or appending an audit event.
  if (outcome.data.id !== memoId || outcome.data.owner_id !== TEST_USER_B_ID
      || outcome.data.title !== memoToRestore.title
      || typeof outcome.data.body !== 'string'
      || sha256(outcome.data.body) !== RESTORE_TARGET_CONTENT_HASH) {
    throw new Error('DB가 반환한 복원 결과의 ID·소유자·본문 해시 검증 실패');
  }
  auditLog.push({ at: new Date().toISOString(), event: 'RESTORE_MEMO',
    memoId, owner_id: TEST_USER_B_ID, contentHash: RESTORE_TARGET_CONTENT_HASH });
  return { restored: true, memo: memoToRestore,
    contentHash: RESTORE_TARGET_CONTENT_HASH };
}
