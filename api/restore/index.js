import { createClient } from '@supabase/supabase-js';
import config from '../../aleph.config.json' with { type: 'json' };
import { createLoginVerifier } from '../../src/verify-login.mjs';
import { cookieWriteForbidden, hasAuthCookie, identifyRequest } from '../../src/server-auth.mjs';
import {
  RESTORE_TARGET_MEMO_B,
  restoreSingleMemoFromBackup,
  verifyBackupRecord,
  VIRTUAL_MEMO_BACKUP_STORE,
} from '../../src/memo-backup.mjs';

const BEARER = /^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export function createMemoRestoreHandler({ verify, makeDb, auditLog = [] } = {}) {
  return async function handler(request, response) {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Vary', 'Authorization');

    // 10단계 복원 경로는 POST만 허용합니다.
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST');
      return response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
    }

    const authorization = request.headers?.authorization ?? request.headers?.Authorization;
    if (authorization !== undefined && (typeof authorization !== 'string' || !BEARER.test(authorization))
        || (authorization === undefined && !hasAuthCookie(request))) {
      response.setHeader('WWW-Authenticate', 'Bearer');
      return response.status(401).json({ error: 'UNAUTHORIZED' });
    }

    if (cookieWriteForbidden(request)) {
      return response.status(403).json({ error: 'FORBIDDEN' });
    }

    const url = process.env.SUPABASE_URL;
    const secretKey = process.env.SUPABASE_SECRET_KEY;
    if ((!url || !secretKey) && (!verify || !makeDb)) {
      return response.status(503).json({ error: 'NOT_CONFIGURED' });
    }

    try {
      const verifyLogin = verify ?? createLoginVerifier({ config, supabaseSecretKey: secretKey });
      const { identity } = await identifyRequest(request, response, verifyLogin);
      if (!identity || !UUID.test(identity.userId ?? '')) {
        response.setHeader('WWW-Authenticate', 'Bearer');
        return response.status(401).json({ error: 'UNAUTHORIZED' });
      }

      let body;
      try {
        body = typeof request.body === 'string' ? JSON.parse(request.body) : request.body;
      } catch {
        return response.status(400).json({ error: 'INVALID_PAYLOAD' });
      }

      // 복원 대상 ID 확인: 요청 본문의 memoId 또는 id, 없을 경우 기본적으로 시험 계정 B의 복원 대상 ID
      const targetId = body?.memoId ?? body?.id ?? request.query?.id ?? RESTORE_TARGET_MEMO_B.id;
      if (typeof targetId !== 'string' || !UUID.test(targetId)) {
        return response.status(400).json({ error: 'INVALID_ID' });
      }

      // 복원 대상은 시험 계정 B의 메모로만 확인
      if (targetId !== RESTORE_TARGET_MEMO_B.id) {
        return response.status(404).json({ error: 'TARGET_NOT_IN_BACKUP' });
      }

      // 시험 계정 B 본인만 복원 가능 (타 사용자 요청 거절)
      if (identity.userId !== RESTORE_TARGET_MEMO_B.owner_id) {
        return response.status(403).json({ error: 'ACCESS_DENIED' });
      }

      const backup = VIRTUAL_MEMO_BACKUP_STORE.get(targetId);
      if (!backup) {
        return response.status(404).json({ error: 'BACKUP_NOT_FOUND' });
      }

      // ID·소유자·내용 해시 대조
      try {
        verifyBackupRecord(targetId, backup);
      } catch {
        return response.status(409).json({ error: 'BACKUP_INTEGRITY_MISMATCH' });
      }

      const supabase = makeDb ? makeDb() : createClient(url, secretKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });

      const result = await restoreSingleMemoFromBackup({
        memoId: targetId,
        db: supabase,
        callerUserId: identity.userId,
        auditLog,
      });

      return response.status(200).json({
        restored: true,
        id: result.memo.id,
        owner_id: result.memo.owner_id,
        title: result.memo.title,
        contentHash: result.contentHash,
      });
    } catch {
      return response.status(500).json({ error: 'RESTORE_FAILED' });
    }
  };
}

const defaultHandler = createMemoRestoreHandler();
export default defaultHandler;
