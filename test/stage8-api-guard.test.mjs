import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createNotesHandler } from '../api/notes.js';
import { createMemosHandler } from '../api/memos.js';
import { createMemoItemHandler } from '../api/memo.js';
import { createInstructorNoticesHandler } from '../api/instructor-notices.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const token = 'Bearer aa.bb.cc';
const ownerVerify = async () => ({ kind: 'student', userId: A });
const noVerify = async () => null;

async function invoke(handler, method, { id, body, headers = {} } = {}) {
  let statusCode = 200;
  let payload;
  const recorded = new Map();
  const response = {
    setHeader(name, value) { recorded.set(name.toLowerCase(), value); return this; },
    status(value) { statusCode = value; return this; },
    json(value) { payload = value; return this; },
  };
  await handler({ method, query: { id }, body, headers: { authorization: token, ...headers } }, response);
  return { statusCode, payload, headers: recorded };
}

// Simulate a broken/misconfigured DB client that ignores owner_id filters.
// Even then, the API must never serialize a row belonging to a different user.
function wrongOwnerDb(tableName, value) {
  return { from(table) {
    assert.equal(table, tableName);
    const builder = {
      select() { return this; }, eq() { return this; }, in() { return this; }, order() { return this; },
      update() { return this; }, delete() { return this; },
      async maybeSingle() { return { data: value, error: null }; },
      then(resolve, reject) { return Promise.resolve({ data: [value], error: null }).then(resolve, reject); },
    };
    return builder;
  } };
}

const denial = { error: 'ACCESS_DENIED' };

test('direct legacy notes GET refuses a DB row owned by another user', async () => {
  const foreign = { owner_id: B, title: '과제', content: '실습용 가상 과제 기록' };
  const handler = createNotesHandler({ verify: ownerVerify, makeDb: () => wrongOwnerDb('study_notes', foreign) });
  const result = await invoke(handler, 'GET');
  assert.equal(result.statusCode, 403);
  assert.deepEqual(result.payload, denial);
  assert.doesNotMatch(JSON.stringify(result.payload), /실습용 가상/u);
});

test('direct memo list GET refuses a DB row owned by another user', async () => {
  const foreign = { id: ID, owner_id: B, title: 'B 자료', body: '외부 자료 본문' };
  const handler = createMemosHandler({ verify: ownerVerify, makeDb: () => wrongOwnerDb('user_notes', foreign) });
  const result = await invoke(handler, 'GET');
  assert.equal(result.statusCode, 403);
  assert.deepEqual(result.payload, denial);
  assert.doesNotMatch(JSON.stringify(result.payload), /외부 자료/u);
});

test('direct memo GET, PUT, DELETE never return cross-owner record or role-based privileges', async () => {
  const foreign = { id: ID, owner_id: B, title: 'B 자료', body: '비밀' };
  const handler = createMemoItemHandler({ verify: ownerVerify, makeDb: () => wrongOwnerDb('user_notes', foreign) });
  for (const method of ['GET', 'PUT', 'DELETE']) {
    const result = await invoke(handler, method, { id: ID, body: { title: '변경', body: '변경', role: 'instructor' },
      headers: { 'x-role': 'instructor', 'x-resource-id': 'instructor_notice:collection' } });
    assert.equal(result.statusCode, method === 'GET' ? 403 : 404);
    assert.deepEqual(result.payload, method === 'GET' ? denial : { error: 'NOT_FOUND' });
    assert.doesNotMatch(JSON.stringify(result.payload), /B 자료|비밀/u);
  }
});

test('notice GET requires verified identity and remains unimplemented without fake data', async () => {
  const handler = createInstructorNoticesHandler({ verify: ownerVerify });
  const anonymous = await invoke(handler, 'GET', { headers: { authorization: undefined } });
  assert.equal(anonymous.statusCode, 401);
  assert.deepEqual(anonymous.payload, { error: 'UNAUTHORIZED' });
  const forged = await invoke(createInstructorNoticesHandler({ verify: noVerify }), 'GET', {
    body: { role: 'instructor' }, headers: { 'x-role': 'instructor' },
  });
  assert.equal(forged.statusCode, 401);
  const authenticated = await invoke(handler, 'GET', { body: { role: 'instructor' } });
  assert.equal(authenticated.statusCode, 501);
  assert.deepEqual(authenticated.payload, { error: 'INSTRUCTOR_NOTICES_NOT_IMPLEMENTED' });
});

test('direct notice writes reject fake instructor role on every HTTP method', async () => {
  const handler = createInstructorNoticesHandler({ verify: ownerVerify });
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const result = await invoke(handler, method, { body: { role: 'instructor', title: '위조 공지' },
      headers: { 'x-role': 'instructor', 'x-resource-id': 'instructor_notice:collection' } });
    assert.equal(result.statusCode, 403);
    assert.deepEqual(result.payload, { error: 'NOTICE_READ_ONLY' });
  }
});
