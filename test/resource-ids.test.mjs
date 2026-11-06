import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RESOURCE_IDS, memoResourceId } from '../src/resource-ids.mjs';
import notices, { createInstructorNoticesHandler } from '../api/instructor-notices.js';
import { createMemosHandler } from '../api/memos.js';
import { createMemoItemHandler } from '../api/memo.js';
import { createNotesHandler } from '../api/notes.js';

const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const fake = (method, extra = {}) => ({ method, headers: { 'x-resource-id': 'instructor_notice:collection', ...extra.headers }, query: extra.query ?? {} });
async function invoke(handler, request) {
  let code = 200, body; const headers = new Map();
  const response = {
    setHeader(k, v) { headers.set(k.toLowerCase(), v); return this; },
    status(c) { code = c; return this; },
    json(v) { body = v; return this; },
  };
  await handler(request, response);
  return { code, body, headers };
}

test('memo, study note and instructor notice use different server-owned resource IDs', () => {
  assert.equal(new Set(Object.values(RESOURCE_IDS)).size, 3);
  assert.equal(memoResourceId(ID), 'personal_memo:' + ID);
  assert.equal(memoResourceId('not-a-uuid'), RESOURCE_IDS.personalMemos);
});

test('server does not elevate a forged client X-Resource-ID on existing routes', async () => {
  const memoList = await invoke(createMemosHandler(), fake('GET'));
  assert.equal(memoList.code, 401);
  assert.equal(memoList.headers.get('x-resource-id'), RESOURCE_IDS.personalMemos);
  const memoItem = await invoke(createMemoItemHandler(), fake('GET', { query: { id: ID } }));
  assert.equal(memoItem.code, 401);
  assert.equal(memoItem.headers.get('x-resource-id'), memoResourceId(ID));
  const notes = await invoke(createNotesHandler(), fake('GET'));
  assert.equal(notes.code, 401);
  assert.equal(notes.headers.get('x-resource-id'), RESOURCE_IDS.studyNotes);
});

test('instructor notices have a distinct resource ID, but no fictional content', async () => {
  const result = await invoke(notices, fake('GET'));
  assert.equal(result.headers.get('x-resource-id'), RESOURCE_IDS.instructorNotices);
  assert.equal(result.code, 401);
  assert.deepEqual(result.body, { error: 'UNAUTHORIZED' });
  const trusted = createInstructorNoticesHandler({ verify: async () => ({
    kind: 'student', userId: '11111111-1111-4111-8111-111111111111',
  }) });
  const authorized = await invoke(trusted, fake('GET', { headers: { authorization: 'Bearer aa.bb.cc' } }));
  assert.equal(authorized.code, 501);
  assert.deepEqual(authorized.body, { error: 'INSTRUCTOR_NOTICES_NOT_IMPLEMENTED' });
});
