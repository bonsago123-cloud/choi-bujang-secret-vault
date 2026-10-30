import assert from 'node:assert/strict';
import { test } from 'node:test';
import config from '../aleph.config.json' with { type: 'json' };
import { createNotesHandler } from '../api/notes.js';
import { createMemosHandler } from '../api/memos.js';
import { createMemoItemHandler } from '../api/memo.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const A_NOTE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B_NOTE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const auth = 'Bearer aa.bb.cc';

function fakeDb() {
  const rows = new Map();
  const studyNotes = [
    ['과제', A], ['포트폴리오', A], ['아침 리추얼', A], ['훈련 행정 자료', A],
    ['B 계정 시험 메모', B],
  ].map(([title, owner_id], i) => ({
    id: i + 1, title, content: `실습용 가상 ${title} 기록`, owner_id,
  }));
  const db = { from(table) {
    assert.ok(table === 'user_notes' || table === 'study_notes');
    let mode = 'select';
    let values;
    const match = [];
    const inMatch = [];
    const builder = {
      select() { return this; },
      eq(key, value) { match.push([key, value]); return this; },
      in(key, values) { inMatch.push([key, values]); return this; },
      order() { return this; },
      insert(value) { mode = 'insert'; values = value; return this; },
      update(value) { mode = 'update'; values = value; return this; },
      delete() { mode = 'delete'; return this; },
      async single() { const r = await run(); return { data: r.data[0] ?? null, error: r.error }; },
      async maybeSingle() { const r = await run(); return { data: r.data[0] ?? null, error: r.error }; },
      then(onSuccess, onFailure) { return run().then(onSuccess, onFailure); },
    };
    async function run() {
      if (mode === 'insert') {
        if (rows.has(values.id)) return { data: null, error: { code: '23505' } };
        rows.set(values.id, { ...values });
        return { data: [rows.get(values.id)], error: null };
      }
      const source = table === 'user_notes' ? [...rows.values()] : studyNotes;
      const selected = source.filter(row => match.every(([k, v]) => row[k] === v)
        && inMatch.every(([k, values]) => values.includes(row[k])));
      if (mode === 'update') for (const row of selected) Object.assign(row, values);
      if (mode === 'delete') for (const row of selected) rows.delete(row.id);
      return { data: selected, error: null };
    }
    return builder;
  } };
  return { db, rows, studyNotes };
}

async function invoke(handler, method, { id, body, authorization = auth } = {}) {
  let statusCode = 200;
  let payload;
  const headers = new Map();
  const response = {
    setHeader(name, value) { headers.set(name.toLowerCase(), value); return this; },
    status(code) { statusCode = code; return this; },
    json(value) { payload = value; return this; },
  };
  await handler({ method, headers: authorization ? { authorization } : {}, body, query: { id } }, response);
  return { statusCode, payload, headers };
}

test('A and B can only read their own legacy study notes', async () => {
  const { db } = fakeDb();
  let user = A;
  const api = createNotesHandler({ verify: async () => ({ userId: user }), makeDb: () => db });
  const a = await invoke(api, 'GET');
  assert.equal(a.statusCode, 200);
  assert.equal(a.payload.notes.length, 4);
  assert.ok(a.payload.notes.every(note => note.title !== 'B 계정 시험 메모'));
  user = B;
  const b = await invoke(api, 'GET');
  assert.equal(b.statusCode, 200);
  assert.deepEqual(b.payload.notes.map(note => note.title), ['B 계정 시험 메모']);
  assert.equal((await invoke(api, 'GET', { authorization: null })).statusCode, 401);
});

test('A/B own GET POST PUT DELETE; cross-ID operations cannot read, modify or remove', async () => {
  const { db, rows } = fakeDb();
  let user = A;
  const verify = async () => ({ kind: 'student', userId: user });
  const collection = createMemosHandler({ verify, makeDb: () => db,
    generateId: () => user === A ? A_NOTE : B_NOTE });
  const item = createMemoItemHandler({ verify, makeDb: () => db });

  assert.deepEqual(await getPost(A_NOTE, 'A'), { id: A_NOTE });
  user = B;
  assert.deepEqual(await getPost(B_NOTE, 'B'), { id: B_NOTE });
  assert.equal(rows.get(A_NOTE).owner_id, A);
  assert.equal(rows.get(B_NOTE).owner_id, B);
  assert.deepEqual((await invoke(collection, 'GET')).payload.map(note => note.id), [B_NOTE]);
  assert.equal((await invoke(item, 'GET', { id: A_NOTE })).statusCode, 404);
  const attemptedPut = await invoke(item, 'PUT', {
    id: A_NOTE, body: { title: '탈취 변경', body: '오염' },
  });
  assert.equal(attemptedPut.statusCode, 404);
  assert.equal(rows.get(A_NOTE).title, 'A');
  assert.equal((await invoke(item, 'DELETE', { id: A_NOTE })).statusCode, 404);
  assert.ok(rows.has(A_NOTE));

  // Even if A submits B's owner_id, the server does not transfer ownership.
  user = A;
  assert.deepEqual((await invoke(collection, 'GET')).payload.map(note => note.id), [A_NOTE]);
  assert.equal((await invoke(item, 'GET', { id: B_NOTE })).statusCode, 404);
  assert.equal((await invoke(item, 'DELETE', { id: B_NOTE })).statusCode, 404);
  const ownGet = await invoke(item, 'GET', { id: A_NOTE });
  assert.deepEqual(ownGet.payload, { id: A_NOTE, title: 'A', body: '본문 A' });
  const forgedOwnPut = await invoke(item, 'PUT', {
    id: A_NOTE, body: { title: '탈취 변경', body: '오염', owner_id: B },
  });
  assert.equal(forgedOwnPut.statusCode, 400);
  assert.equal(rows.get(A_NOTE).owner_id, A);
  assert.equal(rows.get(A_NOTE).title, 'A');
  const ownPut = await invoke(item, 'PUT', {
    id: A_NOTE, body: { title: 'A 수정', body: '본문 변경' },
  });
  assert.equal(ownPut.statusCode, 200);
  assert.deepEqual(ownPut.payload, { id: A_NOTE, title: 'A 수정', body: '본문 변경' });
  assert.equal(rows.get(A_NOTE).owner_id, A);
  assert.deepEqual((await invoke(item, 'DELETE', { id: A_NOTE })).payload, { id: A_NOTE });
  assert.equal((await invoke(item, 'GET', { id: A_NOTE })).statusCode, 404);
  user = B;
  assert.equal((await invoke(item, 'GET', { id: B_NOTE })).statusCode, 200);
  assert.equal((await invoke(item, 'PUT', { id: B_NOTE,
    body: { title: 'B 수정', body: '본문 B 수정' } })).statusCode, 200);
  assert.equal((await invoke(item, 'DELETE', { id: B_NOTE })).statusCode, 200);
  assert.equal(rows.size, 0);

  async function getPost(id, title) {
    const result = await invoke(collection, 'POST', {
      body: { title, body: `본문 ${title}`, owner_id: user === A ? B : A },
    });
    assert.equal(result.statusCode, 201);
    return result.payload;
  }
});

test('declared routes match real methods without inventing APIs', () => {
  assert.deepEqual(config.allowedRoutes, [
    'GET /api/notes', 'GET /api/memos', 'POST /api/memos',
    'GET /api/memos/:id', 'PUT /api/memos/:id', 'DELETE /api/memos/:id',
  ]);
});
