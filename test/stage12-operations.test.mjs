import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { buildOperationsReport } from '../src/operations-summary.mjs';
import { createOperationsHandler } from '../api/operations.js';
import { DEVICE_COOKIE } from '../src/device-access.mjs';

const USER = '11111111-1111-4111-8111-111111111111';
const TOKEN = Buffer.alloc(32, 11).toString('base64url');
const TOKEN_HASH = createHash('sha256').update(TOKEN).digest('hex');
const CREDENTIAL = 'test-credential-stage12';
const requestId = '11111111-1111-4111-8111-111111111112';
const generatedAt = '2026-11-08T01:02:03.000Z';

function mockDb(approved = true) {
  const session = { token_hash: TOKEN_HASH, owner_id: USER, credential_id: CREDENTIAL,
    expires_at: new Date(Date.now() + 60000).toISOString() };
  const credential = { credential_id: CREDENTIAL, owner_id: USER, status: approved ? 'approved' : 'pending' };
  return { from(table) {
    const filters = {};
    return { select() { return this; }, eq(k, v) { filters[k] = v; return this; },
      gt() { return this; }, async maybeSingle() {
        if (table === 'device_verified_sessions') {
          return { data: filters.token_hash === TOKEN_HASH && filters.owner_id === USER ? session : null, error: null };
        }
        if (table === 'device_approval_requests') {
          return { data: filters.credential_id === CREDENTIAL && filters.owner_id === USER ? credential : null, error: null };
        }
        throw new Error('unexpected table');
      } };
  } };
}
function response() {
  const headers = {};
  return { statusCode: 200, headers, payload: null,
    setHeader(k, v) { headers[k.toLowerCase()] = v; return this; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.payload = value; return this; } };
}

const auth = { authorization: 'Bearer abc.def.ghi', cookie: DEVICE_COOKIE + '=' + TOKEN };
const verify = async () => ({kind:'student',userId:USER});

test('규칙 3개와 복구 버전은 API 코드 근거, 운영 미연결 수치는 null', () => {
  const { summary, redactedServerLog: redacted } = buildOperationsReport({requestId, generatedAt});
  assert.equal(summary.policy.definedRules, 3);
  assert.deepEqual(summary.policy.ruleIds, ['device_registered','step_up_required','resource_zone']);
  assert.equal(summary.recovery.referenceVersion, '1.0.0-safe-stage9');
  assert.equal(summary.recovery.baselineIntegrity, 'verified');
  assert.equal(summary.recovery.execution, 'not_executed');
  assert.equal(summary.detection.eventCount, null);
  assert.equal(summary.detection.detectionCount, null);
  assert.equal(summary.revocation.revokedCount, null);
  assert.equal(summary.revocation.execution, 'not_connected');
  assert.equal(redacted.policy.definedRules, summary.policy.definedRules);
  assert.equal(redacted.detection.eventCount, summary.detection.eventCount);
  assert.equal(redacted.revocation.revokedCount, summary.revocation.revokedCount);
  assert.equal(redacted.recovery.referenceVersion, summary.recovery.referenceVersion);
  assert.equal(redacted.requestId, summary.requestId);
});

test('비로그인·미승인 기기는 조회 불가, 응답에 근거 없는 수치 없음', async () => {
  const handler = createOperationsHandler({verify, makeDb:() => mockDb(false), log:() => {}});
  const anon = response();
  await handler({method:'GET',headers:{}}, anon);
  assert.equal(anon.statusCode, 401);
  const blocked = response();
  await handler({method:'GET',headers:auth}, blocked);
  assert.equal(blocked.statusCode, 403);
  const post = response();
  await handler({method:'POST',headers:auth}, post);
  assert.equal(post.statusCode, 405);
});

test('승인된 기기만 API 200 및 화면과 동일한 가린 기록 생성', async () => {
  let logged = '';
  const handler = createOperationsHandler({verify, makeDb:() => mockDb(true), log:v=>{logged=v;}});
  const res = response();
  await handler({method:'GET',headers:auth}, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['cache-control'], 'private, no-store');
  const { summary, redactedServerLog } = res.payload;
  assert.equal(summary.policy.definedRules, 3);
  assert.equal(logged, '[STAGE12_OPERATIONS] ' + JSON.stringify(redactedServerLog));
  assert.equal(redactedServerLog.policy.definedRules, summary.policy.definedRules);
  assert.equal(redactedServerLog.detection.eventCount, summary.detection.eventCount);
  assert.equal(redactedServerLog.revocation.revokedCount, summary.revocation.revokedCount);
  assert.equal(redactedServerLog.recovery.referenceVersion, summary.recovery.referenceVersion);
  assert.ok(!/11111111-1111-4111-8111-111111111111|test-credential-stage12|abc\.def\.ghi|__Host-vault/i.test(logged));
  assert.ok(!/title|body|email|owner_id|token_hash|credential_id/i.test(JSON.stringify(res.payload)));
});

test('화면은 서버 응답으로만 수치를 표시하며 미인증에는 숨긴다', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /id="operations-section" hidden/u);
  assert.match(html, /authFetch\('\/api\/operations'\)/u);
  assert.match(html, /assertOperationsEvidence/u);
  assert.match(html, /operationsSection\.hidden = true/u);
  assert.match(html, /opsPolicyCount\.textContent = String\(summary\.policy\.definedRules\)/u);
  assert.match(html, /redactedServerLog/u);
  assert.doesNotMatch(html, /localStorage|sessionStorage|indexedDB/u);
});
