import assert from 'node:assert/strict';
import { test } from 'node:test';
import handler from '../api/notes.js';

function invoke(method, requestHeaders = {}) {
  const headers = new Map();
  let statusCode = 200;
  let body;
  const response = {
    setHeader(name, value) { headers.set(name.toLowerCase(), value); return this; },
    status(code) { statusCode = code; return this; },
    json(value) { body = value; return this; },
  };
  return handler({ method, headers: requestHeaders }, response)
    .then(() => ({ headers, statusCode, body }));
}

test('non-GET request is rejected before using secrets', async () => {
  const result = await invoke('POST');
  assert.equal(result.statusCode, 405);
  assert.equal(result.headers.get('allow'), 'GET');
  assert.deepEqual(result.body, { error: 'METHOD_NOT_ALLOWED' });
});

test('anonymous request gets no notes, even without server secrets', async () => {
  const result = await invoke('GET');
  assert.equal(result.statusCode, 401);
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.equal(result.headers.get('vary'), 'Authorization');
  assert.deepEqual(result.body, { error: 'UNAUTHORIZED' });
  assert.equal('notes' in result.body, false);
});

test('malformed authorization is denied without any note data', async () => {
  const result = await invoke('GET', { authorization: 'Bearer not-a-jwt' });
  assert.equal(result.statusCode, 401);
  assert.deepEqual(result.body, { error: 'UNAUTHORIZED' });
});

test('missing secrets do not appear in API response', async () => {
  const oldUrl = process.env.SUPABASE_URL;
  const oldKey = process.env.SUPABASE_SECRET_KEY;
  try {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SECRET_KEY;
    const result = await invoke('GET', { authorization: 'Bearer a.b.c' });
    assert.equal(result.statusCode, 503);
    assert.deepEqual(result.body, { error: 'NOT_CONFIGURED' });
  } finally {
    if (oldUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_SECRET_KEY;
    else process.env.SUPABASE_SECRET_KEY = oldKey;
  }
});

test('invalid JWT does not authorize a request with browser-supplied identity fields', async () => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SECRET_KEY;
  try {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SECRET_KEY = 'not-a-real-key-for-test';
    const result = await invoke('GET', {
      authorization: 'Bearer a.b.c',
      userId: 'an-arbitrary-user',
      role: 'admin',
    });
    assert.equal(result.statusCode, 401);
    assert.deepEqual(result.body, { error: 'UNAUTHORIZED' });
  } finally {
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SECRET_KEY;
    else process.env.SUPABASE_SECRET_KEY = previousKey;
  }
});
