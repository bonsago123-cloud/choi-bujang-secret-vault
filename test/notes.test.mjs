import assert from 'node:assert/strict';
import { test } from 'node:test';
import handler from '../api/notes.js';

function invoke(method) {
  const headers = new Map();
  let statusCode = 200;
  let body;
  const response = {
    setHeader(name, value) { headers.set(name.toLowerCase(), value); return this; },
    status(code) { statusCode = code; return this; },
    json(value) { body = value; return this; },
  };
  return handler({ method }, response).then(() => ({ headers, statusCode, body }));
}

test('non-GET request is rejected before using secrets', async () => {
  const result = await invoke('POST');
  assert.equal(result.statusCode, 405);
  assert.equal(result.headers.get('allow'), 'GET');
  assert.deepEqual(result.body, { error: 'METHOD_NOT_ALLOWED' });
});

test('missing secrets do not appear in API response', async () => {
  const oldUrl = process.env.SUPABASE_URL;
  const oldKey = process.env.SUPABASE_SECRET_KEY;
  try {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SECRET_KEY;
    const result = await invoke('GET');
    assert.equal(result.statusCode, 503);
    assert.equal(result.headers.get('cache-control'), 'no-store');
    assert.deepEqual(result.body, { error: 'NOT_CONFIGURED' });
  } finally {
    if (oldUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_SECRET_KEY;
    else process.env.SUPABASE_SECRET_KEY = oldKey;
  }
});
