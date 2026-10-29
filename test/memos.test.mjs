import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMemosHandler } from '../api/memos.js';
import { createMemoItemHandler } from '../api/memo.js';
import { runAttackChecks } from '../src/attack-check.mjs';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const NOTE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const auth = 'Bearer aa.bb.cc';

function fakeDb() {
  const rows = new Map();
  const db = { from(table) {
    assert.equal(table, 'user_notes');
    let mode = 'list';
    let values = null;
    const match = [];
    const builder = {
      select() { return this; },
      eq(key, value) { match.push([key, value]); return this; },
      order() { return this; },
      insert(value) { mode = 'insert'; values = value; return this; },
      update(value) { mode = 'update'; values = value; return this; },
      delete() { mode = 'delete'; return this; },
      async maybeSingle() { const outcome = await run(); return { data: outcome.data[0] ?? null, error: outcome.error }; },
      async single() { const outcome = await run(); return { data: outcome.data[0] ?? null, error: outcome.error }; },
      then(resolve, reject) { return run().then(resolve, reject); },
    };
    async function run() {
      if (mode === 'insert') {
        if (rows.has(values.id)) return { data: [], error: { code: '23505' } };
        rows.set(values.id, { ...values });
        return { data: [rows.get(values.id)], error: null };
      }
      const selected = [...rows.values()].filter(row => match.every(([k, v]) => row[k] === v));
      if (mode === 'delete') for (const row of selected) rows.delete(row.id);
      if (mode === 'update') for (const row of selected) Object.assign(row, values);
      return { data: selected, error: null };
    }
    return builder;
  } };
  return { db, rows };
}

async function invoke(handler, method, { id, body, authorization = auth } = {}) {
  let statusCode = 200;
  let payload;
  const headers = new Map();
  const request = { method, headers: authorization ? { authorization } : {}, body, query: { id } };
  const response = {
    setHeader(key, value) { headers.set(key.toLowerCase(), value); return this; },
    status(code) { statusCode = code; return this; },
    json(value) { payload = value; return this; },
  };
  await handler(request, response);
  return { statusCode, payload, headers };
}

test('unauthenticated and invalid tokens never return notes', async () => {
  const { db } = fakeDb();
  const authenticate = async () => null;
  const list = createMemosHandler({ verify: authenticate, makeDb: () => db });
  const item = createMemoItemHandler({ verify: authenticate, makeDb: () => db });
  for (const [handler, method, id] of [[list, 'GET'], [list, 'POST'],
    [item, 'GET', NOTE], [item, 'PUT', NOTE], [item, 'DELETE', NOTE]]) {
    const anonymous = await invoke(handler, method, { id, authorization: null });
    assert.equal(anonymous.statusCode, 401);
    assert.deepEqual(anonymous.payload, { error: 'UNAUTHORIZED' });
    const invalid = await invoke(handler, method, { id });
    assert.equal(invalid.statusCode, 401);
    assert.deepEqual(invalid.payload, { error: 'UNAUTHORIZED' });
  }
});

test('A creates, lists, reads, updates and deletes a UUID note; missing GET is 404', async () => {
  const { db, rows } = fakeDb();
  let currentUser = A;
  const verify = async () => ({ kind: 'student', userId: currentUser });
  const list = createMemosHandler({ verify, makeDb: () => db, generateId: () => NOTE });
  const item = createMemoItemHandler({ verify, makeDb: () => db });
  const created = await invoke(list, 'POST', { body: { title: '  가상 메모 A  ', body: '본문 A', owner_id: B } });
  assert.equal(created.statusCode, 201);
  assert.deepEqual(created.payload, { id: NOTE });
  assert.equal(rows.get(NOTE).owner_id, A); // forged owner_id in body is ignored
  const listed = await invoke(list, 'GET');
  assert.equal(listed.statusCode, 200);
  assert.deepEqual(listed.payload, [{ ...rows.get(NOTE) }]);
  currentUser = B;
  const bList = await invoke(list, 'GET');
  assert.deepEqual(bList.payload, []); // listing uses verified owner_id
  currentUser = A;
  const fetched = await invoke(item, 'GET', { id: NOTE });
  assert.deepEqual(fetched.payload, { id: NOTE, title: '가상 메모 A', body: '본문 A' });
  const changed = await invoke(item, 'PUT', { id: NOTE, body: { title: '수정 A', body: '새 내용 A', owner_id: B } });
  assert.equal(changed.statusCode, 200);
  assert.deepEqual(changed.payload, { id: NOTE, title: '수정 A', body: '새 내용 A' });
  assert.equal(rows.get(NOTE).owner_id, A);
  const removed = await invoke(item, 'DELETE', { id: NOTE });
  assert.equal(removed.statusCode, 200);
  assert.deepEqual(removed.payload, { id: NOTE });
  const missing = await invoke(item, 'GET', { id: NOTE });
  assert.equal(missing.statusCode, 404);
  assert.deepEqual(missing.payload, { error: 'NOT_FOUND' });
});

test('invalid ID and payload are rejected', async () => {
  const { db } = fakeDb();
  const verify = async () => ({ kind: 'student', userId: A });
  const list = createMemosHandler({ verify, makeDb: () => db });
  const item = createMemoItemHandler({ verify, makeDb: () => db });
  assert.equal((await invoke(list, 'POST', { body: { id: 'abc', title: 'a', body: 'b' } })).statusCode, 400);
  assert.equal((await invoke(list, 'POST', { body: '{' })).statusCode, 400);
  assert.equal((await invoke(item, 'GET', { id: 'abc' })).statusCode, 400);
  assert.equal((await invoke(item, 'PUT', { id: NOTE, body: '{' })).statusCode, 400);
});

test('Stage 3 self-check records only actual unauthenticated HTTP statuses', async () => {
  const saved = globalThis.fetch;
  const urls = [];
  try {
    globalThis.fetch = async url => { urls.push(String(url)); return new Response('{"error":"UNAUTHORIZED"}', { status: 401 }); };
    const result = await runAttackChecks({ step: 3, publicAppUrl: 'https://project.vercel.app' });
    assert.equal(urls.length, 2);
    assert.deepEqual(urls, ['https://project.vercel.app/api/memos', 'https://project.vercel.app/api/notes']);
    assert.equal(result.length, 1);
    assert.match(result[0].observed, /401.*401/u);
  } finally { globalThis.fetch = saved; }
});
