import { createClient } from '@supabase/supabase-js';
import config from '../aleph.config.json' with { type: 'json' };
import { PUBLISHABLE_KEY } from './public-auth-key.mjs';

const ACCESS = '__Host-vault-access';
const REFRESH = '__Host-vault-refresh';
const JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u;
const REFRESH_FORMAT = /^[A-Za-z0-9._~+/-]{10,2048}={0,2}$/u;
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Never use the privileged service key for password login; the publishable key suffices.
export function makePublicAuthClient() {
  const url = process.env.SUPABASE_URL;
  if (typeof url !== 'string' || !/^https:\/\/[a-z0-9-]+\.supabase\.co$/u.test(url)) {
    throw new Error('SUPABASE_URL_NOT_CONFIGURED');
  }
  return createClient(url, PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function requestHeader(request, name) {
  const titleCase = name.replace(/(^|-)[a-z]/gu, part => part.toUpperCase());
  return request.headers?.[name] ?? request.headers?.[name.toLowerCase()]
    ?? request.headers?.[titleCase] ?? request.headers?.[name.toUpperCase()];
}

function cookiesFrom(request) {
  const raw = requestHeader(request, 'cookie');
  const output = Object.create(null);
  if (typeof raw !== 'string' || raw.length > 12000) return output;
  for (const part of raw.split(';')) {
    const equal = part.indexOf('=');
    if (equal <= 0) continue;
    const name = part.slice(0, equal).trim();
    if (name !== ACCESS && name !== REFRESH) continue;
    if (output[name] !== undefined) {
      output[name] = ''; // Ambiguous duplicate cookies are rejected.
      continue;
    }
    try { output[name] = decodeURIComponent(part.slice(equal + 1).trim()); }
    catch { output[name] = ''; }
  }
  return output;
}

export function hasAuthCookie(request) {
  const cookies = cookiesFrom(request);
  return Boolean(cookies[ACCESS] || cookies[REFRESH]);
}

export function cookieWriteForbidden(request) {
  // Explicit Authorization requests are preserved for the existing ALEPH judge.
  if (requestHeader(request, 'authorization') !== undefined || !hasAuthCookie(request)
      || !WRITE_METHODS.has(request.method)) return false;
  return !sameOrigin(request);
}

export function sameOrigin(request) {
  const origin = requestHeader(request, 'origin');
  // Never compare against a client-controlled Host header.
  return typeof origin === 'string' && origin === new URL(config.publicAppUrl).origin;
}

function cookie(name, value, seconds) {
  // __Host- prefix: HTTPS, path=/, and no Domain attribute.
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${seconds}`;
}

export function setSessionCookies(response, session) {
  if (!session || !JWT.test(session.access_token ?? '')
      || !REFRESH_FORMAT.test(session.refresh_token ?? '')) {
    throw new Error('INVALID_AUTH_SESSION');
  }
  const accessAge = Math.max(1, Math.min(3600, Number(session.expires_in) || 3600));
  response.setHeader('Set-Cookie', [
    cookie(ACCESS, session.access_token, accessAge),
    cookie(REFRESH, session.refresh_token, 30 * 24 * 3600),
  ]);
  response.setHeader('Cache-Control', 'private, no-store');
}

export function clearSessionCookies(response) {
  response.setHeader('Set-Cookie', [cookie(ACCESS, '', 0), cookie(REFRESH, '', 0)]);
  response.setHeader('Cache-Control', 'private, no-store');
}

export function readSessionTokens(request) {
  const values = cookiesFrom(request);
  return {
    accessToken: JWT.test(values[ACCESS] ?? '') ? values[ACCESS] : null,
    refreshToken: REFRESH_FORMAT.test(values[REFRESH] ?? '') ? values[REFRESH] : null,
  };
}

// Returns the VERIFIED identity, not a userId supplied by the browser.
// Old Bearer requests keep their existing verification semantics unchanged.
export async function identifyRequest(request, response, verifyLogin,
  { makeClient = makePublicAuthClient } = {}) {
  const explicit = requestHeader(request, 'authorization');
  if (explicit !== undefined) {
    return { identity: await verifyLogin(explicit), accessToken: null, mode: 'bearer' };
  }
  const { accessToken, refreshToken } = readSessionTokens(request);
  if (cookieWriteForbidden(request)) return { identity: null, forbidden: true };
  if (accessToken) {
    const identity = await verifyLogin(`Bearer ${accessToken}`);
    if (identity?.kind === 'student') return { identity, accessToken, mode: 'cookie' };
  }
  if (!refreshToken) return { identity: null };
  try {
    const { data, error } = await makeClient().auth.refreshSession({ refresh_token: refreshToken });
    if (error || !data?.session) throw new Error('REFRESH_FAILED');
    const token = data.session.access_token;
    if (!JWT.test(token ?? '')) throw new Error('INVALID_REFRESH_RESULT');
    const identity = await verifyLogin(`Bearer ${token}`);
    if (identity?.kind !== 'student') throw new Error('INVALID_REFRESH_IDENTITY');
    setSessionCookies(response, data.session);
    return { identity, accessToken: token, mode: 'cookie' };
  } catch {
    clearSessionCookies(response);
    return { identity: null };
  }
}
