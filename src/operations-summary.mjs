// Stage 12: Read-only operations-room evidence. Do not infer operational events from fixtures.
// A single immutable report drives the API response and the redacted server log.
import { RULE_IDS } from './decider.mjs';
import {
  SAFETY_POLICY_BASELINE, verifyPolicyIntegrity,
} from './policy-restore.mjs';

export function buildOperationsReport({ requestId, generatedAt } = {}) {
  if (typeof requestId !== 'string' || !/^[0-9a-f-]{36}$/iu.test(requestId)) {
    throw new TypeError('invalid_operations_request_id');
  }
  if (typeof generatedAt !== 'string' || !Number.isFinite(Date.parse(generatedAt))) {
    throw new TypeError('invalid_operations_time');
  }
  // Verifies the *checked-in* reference policy, not a production recovery execution.
  verifyPolicyIntegrity(SAFETY_POLICY_BASELINE);
  const summary = {
    schema: 'aleph.operations.summary.v1',
    requestId, generatedAt,
    policy: {
      evidence: 'api_verified',
      definedRules: RULE_IDS.length,
      ruleIds: [...RULE_IDS],
      evaluationExecutions: null,
      execution: 'not_executed',
    },
    detection: {
      evidence: 'not_executed',
      eventCount: null,
      detectionCount: null,
      eventFeed: 'not_connected',
      rule: 'burst_read',
      threshold: { requests: 120, comparator: 'greater_than', windowMinutes: 10 },
    },
    revocation: {
      evidence: 'not_executed',
      revokedCount: null,
      execution: 'not_connected',
      capability: 'proposal_only',
    },
    recovery: {
      evidence: 'api_verified',
      referenceVersion: SAFETY_POLICY_BASELINE.version,
      baselineIntegrity: 'verified',
      executedRestores: null,
      execution: 'not_executed',
    },
  };
  // Redaction by construction: no subject, token, IP, note ID, title, or body is read.
  // Numbers and status strings are copied from the exact summary returned by the API.
  const redactedServerLog = {
    schema: 'aleph.operations.redacted-log.v1',
    requestId: summary.requestId,
    generatedAt: summary.generatedAt,
    redacted: true,
    policy: { evidence: summary.policy.evidence, definedRules: summary.policy.definedRules,
      execution: summary.policy.execution },
    detection: { evidence: summary.detection.evidence, eventCount: summary.detection.eventCount,
      detectionCount: summary.detection.detectionCount },
    revocation: { evidence: summary.revocation.evidence, revokedCount: summary.revocation.revokedCount,
      execution: summary.revocation.execution },
    recovery: { evidence: summary.recovery.evidence, referenceVersion: summary.recovery.referenceVersion,
      baselineIntegrity: summary.recovery.baselineIntegrity,
      executedRestores: summary.recovery.executedRestores, execution: summary.recovery.execution },
  };
  return { summary, redactedServerLog };
}
