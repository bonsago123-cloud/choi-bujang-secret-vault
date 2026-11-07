import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { approvedDeviceSession, mayAccessProtectedData, DEVICE_COOKIE } from '../src/device-access.mjs';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const text = path => readFileSync(new URL('../'+path, import.meta.url), 'utf8');

function fakeDb(session, approval) {
  return { from(table) {
    const filter = {};
    return {
      select() { return this; }, eq(key,value) { filter[key] = value; return this; },
      gt() { return this; },
      async maybeSingle() {
        if (table === 'device_verified_sessions') return { data: session &&
          filter.owner_id === session.owner_id && filter.token_hash === session.token_hash ? session : null,
          error: null };
        if (table === 'device_approval_requests') return { data: approval &&
          filter.owner_id === approval.owner_id && filter.credential_id === approval.credential_id ? approval : null,
          error: null };
        throw new Error('unexpected table');
      },
    };
  } };
}
test('로그인만 한 미등록 기기에는 보호 자료 거부, 승인 버튼/기기 ID를 믿지 않음', async () => {
  const result = await approvedDeviceSession({ request: {headers:{ 'x-device-registered':'true', 'x-device-id':'approved' }},
    db:fakeDb(),identity:{kind:'student',userId:A} });
  assert.equal(result, false);
  assert.equal(await mayAccessProtectedData({ request:{headers:{}}, db:fakeDb(), identity:{kind:'student',userId:A} }), false);
});
test('유효한 서버 소유 세션과 동일 소유자 승인 DB 레코드가 있어야 통과', async () => {
  const { createHash } = await import('node:crypto');
  const token = Buffer.alloc(32, 7).toString('base64url');
  const token_hash = createHash('sha256').update(token).digest('hex');
  const session = {owner_id:A, credential_id:'credential-for-test',token_hash,expires_at:new Date(Date.now()+120000).toISOString()};
  const approval = {owner_id:A,credential_id:'credential-for-test',status:'approved'};
  const request = {headers:{cookie:`${DEVICE_COOKIE}=${token}`}};
  assert.equal(await approvedDeviceSession({request,db:fakeDb(session,approval),identity:{kind:'student',userId:A}}),true);
  assert.equal(await approvedDeviceSession({request,db:fakeDb(session,{...approval,status:'pending'}),identity:{kind:'student',userId:A}}),false);
  assert.equal(await approvedDeviceSession({request,db:fakeDb(session,approval),identity:{kind:'student',userId:B}}),false);
  assert.equal(await approvedDeviceSession({request:{headers:{cookie:`${DEVICE_COOKIE}=${token}; ${DEVICE_COOKIE}=${token}`}},db:fakeDb(session,approval),identity:{kind:'student',userId:A}}),false);
  assert.equal(await approvedDeviceSession({request,db:fakeDb({...session,expires_at:new Date(Date.now()-1000).toISOString()},approval),identity:{kind:'student',userId:A}}),false);
});
test('화면은 기기 승인 확인 전 메모 호출 차단하고 웹 저장소에 기기 키 저장하지 않음', () => {
  const html = text('public/index.html');
  assert.match(html,/device-verify-button/);
  assert.match(html,/device-request-button/);
  assert.match(html,/refreshDeviceApproval/);
  assert.doesNotMatch(html,/localStorage|sessionStorage|indexedDB/u);
  const server = text('api/device.js');
  assert.match(server,/verifyRegistrationResponse/);
  assert.match(server,/verifyAuthenticationResponse/);
  assert.match(server,/DEVICE_NOT_APPROVED/);
  for (const path of ['api/notes.js','api/memos.js','api/memo.js','api/restore/index.js']) {
    assert.match(text(path),/mayAccessProtectedData/);
    assert.match(text(path),/DEVICE_APPROVAL_REQUIRED/);
  }
});
test('SDP 11단계 설정을 변경하지 않고 원래 규칙을 사용', () => {
  const decider = text('src/decider.mjs');
  assert.match(decider,/export const RULE_IDS/u);
  assert.equal(JSON.parse(text('aleph.config.json')).step,11);
});
