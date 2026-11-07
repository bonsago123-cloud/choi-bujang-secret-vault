import { createHash } from 'node:crypto';

// 1~9단계에서 만든 접근 규칙을 안전 정책 기준으로 정의합니다.
// 1. src/decider.mjs 규칙: device_registered, resource_zone, step_up_required
// 2. aleph.config.json의 allowedRoutes: 허용된 4개 경로
// 3. DB 접근 정책: user_notes/study_notes 소유자(owner_id) 일치 강제, 익명 직통 조회 차단, 역할/헤더 위조 불신
export const SAFETY_POLICY_BASELINE = Object.freeze({
  version: '1.0.0-safe-stage9',
  deciderRules: Object.freeze(['device_registered', 'resource_zone', 'step_up_required']),
  allowedRoutes: Object.freeze([
    'GET /api/memos/:id',
    'PUT /api/memos/:id',
    'DELETE /api/memos/:id',
    'GET /api/instructor-notices',
  ]),
  dbPolicies: Object.freeze({
    enforceRowOwnerIsolation: true,
    revokeDirectAnonAccess: true,
    trustClientRoleHeader: false,
    trustClientResourceIdHeader: false,
    allowCrossOwnerRead: false,
  }),
});

export function canonicalPolicyJson(policy) {
  if (!policy || typeof policy !== 'object') throw new TypeError('invalid_policy');
  return JSON.stringify({
    version: policy.version,
    deciderRules: [...(policy.deciderRules ?? [])].sort(),
    allowedRoutes: [...(policy.allowedRoutes ?? [])].sort(),
    dbPolicies: {
      allowCrossOwnerRead: Boolean(policy.dbPolicies?.allowCrossOwnerRead),
      enforceRowOwnerIsolation: Boolean(policy.dbPolicies?.enforceRowOwnerIsolation),
      revokeDirectAnonAccess: Boolean(policy.dbPolicies?.revokeDirectAnonAccess),
      trustClientResourceIdHeader: Boolean(policy.dbPolicies?.trustClientResourceIdHeader),
      trustClientRoleHeader: Boolean(policy.dbPolicies?.trustClientRoleHeader),
    },
  });
}

export function computePolicyHash(policy) {
  const canonical = canonicalPolicyJson(policy);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

// 안전 정책 사본과 검증용 해시
export const VERIFIED_POLICY_HASH = computePolicyHash(SAFETY_POLICY_BASELINE);

export function verifyPolicyIntegrity(policy, expectedHash = VERIFIED_POLICY_HASH) {
  if (!policy || typeof policy !== 'object') {
    throw new Error('안전 정책 사본이 없습니다. 복원을 중단합니다.');
  }
  const actualHash = computePolicyHash(policy);
  if (actualHash !== expectedHash) {
    throw new Error(`안전 정책 해시가 일치하지 않습니다. 복원을 중단합니다. (기대: ${expectedHash}, 실제: ${actualHash})`);
  }
  return true;
}

// 시험용 사본에서 규칙 한 줄을 일부러 바꿔 침공 흉내 (예: 타인 자료 조회 허용)
export function createTamperedPolicy(baseline = SAFETY_POLICY_BASELINE) {
  verifyPolicyIntegrity(baseline);
  return {
    version: '1.0.0-tampered-test',
    deciderRules: [...baseline.deciderRules],
    allowedRoutes: [...baseline.allowedRoutes],
    dbPolicies: {
      ...baseline.dbPolicies,
      allowCrossOwnerRead: true, // 규칙 한 줄 변경: 침공 흉내 (B가 A의 자료를 읽을 수 있도록 변조)
    },
  };
}

// 검증한 사본과 시험 정책의 차이만 추출
export function diffPolicies(verifiedPolicy, testPolicy) {
  verifyPolicyIntegrity(verifiedPolicy);
  if (!testPolicy || typeof testPolicy !== 'object') {
    throw new Error('시험 정책이 없습니다.');
  }

  const diffs = [];

  // deciderRules diff
  const verifiedRules = new Set(verifiedPolicy.deciderRules);
  const testRules = new Set(testPolicy.deciderRules);
  for (const rule of testRules) {
    if (!verifiedRules.has(rule)) diffs.push({ field: 'deciderRules', change: 'added', item: rule });
  }
  for (const rule of verifiedRules) {
    if (!testRules.has(rule)) diffs.push({ field: 'deciderRules', change: 'removed', item: rule });
  }

  // allowedRoutes diff
  const verifiedRoutes = new Set(verifiedPolicy.allowedRoutes);
  const testRoutes = new Set(testPolicy.allowedRoutes);
  for (const route of testRoutes) {
    if (!verifiedRoutes.has(route)) diffs.push({ field: 'allowedRoutes', change: 'added', item: route });
  }
  for (const route of verifiedRoutes) {
    if (!testRoutes.has(route)) diffs.push({ field: 'allowedRoutes', change: 'removed', item: route });
  }

  // dbPolicies diff
  const allDbKeys = new Set([
    ...Object.keys(verifiedPolicy.dbPolicies ?? {}),
    ...Object.keys(testPolicy.dbPolicies ?? {}),
  ]);
  for (const key of allDbKeys) {
    const vVal = verifiedPolicy.dbPolicies?.[key];
    const tVal = testPolicy.dbPolicies?.[key];
    if (vVal !== tVal) {
      diffs.push({
        field: `dbPolicies.${key}`,
        change: 'modified',
        current: tVal,
        restored: vVal,
      });
    }
  }

  return {
    targetVersion: verifiedPolicy.version,
    targetHash: computePolicyHash(verifiedPolicy),
    diffCount: diffs.length,
    differences: diffs,
  };
}

// 검증한 안전 정책 버전으로 시험 정책 되돌리기
export function restoreTestPolicy(testPolicy, { baseline = SAFETY_POLICY_BASELINE, auditLog = [] } = {}) {
  // 1. 사본 유무 및 해시 검증 (해시 불일치 시 즉시 중단)
  verifyPolicyIntegrity(baseline);

  // 2. 실행 전 복원할 버전과 변경 범위 산출
  const plan = diffPolicies(baseline, testPolicy);

  // 3. 감사 이력 보존 및 복원 이벤트 기록
  const auditEntry = {
    at: new Date().toISOString(),
    event: 'RESTORE_POLICY',
    targetVersion: plan.targetVersion,
    restoredHash: plan.targetHash,
    diffsApplied: plan.differences,
  };
  auditLog.push(auditEntry);

  // 4. 안전 정책 사본 상태로 시험 정책 롤백 (실제 운영 정책은 건드리지 않음)
  const restored = {
    version: baseline.version,
    deciderRules: [...baseline.deciderRules],
    allowedRoutes: [...baseline.allowedRoutes],
    dbPolicies: { ...baseline.dbPolicies },
  };

  return {
    success: true,
    plan,
    restored,
    auditEntry,
  };
}
