import assert from 'node:assert/strict';
import { test } from 'node:test';
import config from '../aleph.config.json' with { type: 'json' };
import { createAuthHandler } from '../api/auth/index.js';
import { cookieWriteForbidden, hasAuthCookie, identifyRequest, readSessionTokens } from '../src/server-auth.mjs';

const origin = new URL(config.publicAppUrl).origin;
const userId = '11111111-1111-4111-8111-111111111111';
const authSession = { access_token: 'abc.def.ghi', refresh_token: 'valid-refresh-000001', expires_in: 3600 };

async function invoke(handler, method, { action, cookie, authorization, hostOrigin = origin,
  body, contentType = 'application/json' } = {}) {
  const headers = {};
  if (hostOrigin) headers.origin = hostOrigin;
  if (cookie) headers.cookie = cookie;
  if (authorization) headers.authorization = authorization;
  if (body) headers['content-type'] = contentType;
  const recorded = new Map();
  let status = 200;
  let payload;
  const response = {
    setHeader(name, value) { recorded.set(name.toLowerCase(), value); return this; },
    status(n) { status = n; return this; },
    json(value) { payload = value; return this; },
  };
  await handler({ method, query: { action }, headers, body }, response);
  return { status, payload, headers: recorded };
}

function mockClient() {
  return { auth: {
    async signInWithPassword() { return { data: { session: authSession,
      user: { id: userId, email: 'example@invalid.test' } }, error: null }; },
    async refreshSession() { return { data: { session: authSession }, error: null }; },
    async getUser() { return { data: { user: { id: userId,
      email: 'example@invalid.test' } }, error: null }; },
    async setSession() { return { error: null }; },
    async signOut() { return { error: null }; },
  } };
}
const verify = async bearer => bearer === `Bearer ${authSession.access_token}`
  ? { kind: 'student', userId } : null;

function withFakeUrl(fn) {
  const old = process.env.SUPABASE_URL;
  process.env.SUPABASE_URL = 'https://test.supabase.co';
  return Promise.resolve().then(fn).finally(() => {
    if (old === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = old;
  });
}

test('password login uses HttpOnly cookies; JSON never contains JWT or refresh token', async () => withFakeUrl(async () => {
  const handler = createAuthHandler({ makeClient: mockClient, verify });
  const result = await invoke(handler, 'POST', {
    action: 'login', body: { email: 'example@invalid.test', password: 'fake-password' },
  });
  assert.equal(result.status, 200);
  assert.deepEqual(result.payload, { user: { email: 'example@invalid.test' } });
  const cookies = result.headers.get('set-cookie');
  assert.equal(cookies.length, 2);
  for (const item of cookies) {
    assert.match(item, /^__Host-vault-(?:access|refresh)=/u);
    assert.match(item, /HttpOnly; Secure; SameSite=Strict/u);
    assert.match(item, /Path=\//u);
    assert.doesNotMatch(JSON.stringify(result.payload), /abc\.def\.ghi|valid-refresh/u);
  }
  const header = cookies.map(item => item.split(';')[0]).join('; ');
  const session = await invoke(handler, 'GET', { action: 'session', cookie: header });
  assert.equal(session.status, 200);
  assert.deepEqual(session.payload, result.payload);
  assert.equal(readSessionTokens({ headers: { cookie: header } }).accessToken, authSession.access_token);
}));

test('cross-origin login is forbidden, and cookie mutations require same Origin', async () => withFakeUrl(async () => {
  const handler = createAuthHandler({ makeClient: mockClient, verify });
  const forged = await invoke(handler, 'POST', {
    action: 'login', hostOrigin: 'https://attacker.example',
    body: { email: 'example@invalid.test', password: 'fake-password' },
  });
  assert.equal(forged.status, 403);
  const request = { method: 'DELETE', headers: {
    origin: 'https://attacker.example',
    cookie: '__Host-vault-access=abc.def.ghi',
  } };
  assert.equal(hasAuthCookie(request), true);
  assert.equal(cookieWriteForbidden(request), true);
  request.headers.origin = origin;
  assert.equal(cookieWriteForbidden(request), false);
}));

test('Bearer judge path has priority and cannot inherit cookie permissions', async () => {
  const request = { method: 'POST', headers: {
    authorization: 'Bearer judge.valid.token',
    cookie: '__Host-vault-access=abc.def.ghi',
    origin: 'https://attacker.example',
  } };
  assert.equal(cookieWriteForbidden(request), false);
  const result = await identifyRequest(request, { setHeader() {} }, async token =>
    token === 'Bearer judge.valid.token' ? { kind: 'judge', userId } : null);
  assert.equal(result.identity.kind, 'judge');
  assert.equal(result.mode, 'bearer');
});

test('expired cookie access uses refresh token and sends rotated cookies', async () => {
  const request = { method: 'GET', headers: {
    cookie: '__Host-vault-access=expired.jwt.token; __Host-vault-refresh=valid-refresh-000001',
  } };
  const headers = new Map();
  const response = { setHeader(name, value) { headers.set(name, value); } };
  const result = await identifyRequest(request, response, verify, { makeClient: mockClient });
  assert.equal(result.identity.userId, userId);
  assert.equal(result.mode, 'cookie');
  assert.equal(headers.get('Set-Cookie').length, 2);
});

test('invalid cookies do not create identity; logout clears both cookies', async () => withFakeUrl(async () => {
  const handler = createAuthHandler({ makeClient: mockClient, verify });
  const noSession = await invoke(handler, 'GET', { action: 'session' });
  assert.equal(noSession.status, 401);
  const logout = await invoke(handler, 'POST', { action: 'logout' });
  assert.equal(logout.status, 200);
  assert.equal(logout.headers.get('set-cookie').length, 2);
  assert.ok(logout.headers.get('set-cookie').every(item => /Max-Age=0/u.test(item)));
}));

test('public HTML never contains Supabase publishable key or client Auth SDK', async () => {
  const { readFile } = await import('node:fs/promises');
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /sb_publishable_|PUBLISHABLE_KEY|supabase-js|localStorage|access_token/u);
  assert.match(html, /\/api\/auth\?action=login/u);
});
