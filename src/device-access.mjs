// Stage 11: Server-owned, short-lived device verification receipt.
// Registration and approval never derive from browser-supplied device IDs or claims.
import { createHash, randomBytes } from 'node:crypto';

export const DEVICE_COOKIE = '__Host-vault-device-session';
const SESSION_AGE = 15 * 60;
const DEVICE_ID = /^[A-Za-z0-9_-]{12,512}$/u;
const TOKEN = /^[A-Za-z0-9_-]{43}$/u;

export function fingerprintCredential(id) {
  if (typeof id !== 'string' || !DEVICE_ID.test(id)) throw new TypeError('invalid_device_id');
  return createHash('sha256').update(id, 'utf8').digest('hex');
}

function readCookie(request, name) {
  const source = request.headers?.cookie ?? request.headers?.Cookie;
  if (typeof source !== 'string' || source.length > 12000) return null;
  let found = null;
  for (const entry of source.split(';')) {
    const equal = entry.indexOf('=');
    if (equal < 1 || entry.slice(0, equal).trim() !== name) continue;
    if (found !== null) return null; // duplicate: reject
    found = entry.slice(equal + 1).trim();
  }
  return found;
}

export function clearDeviceSession(response) {
  response.setHeader('Set-Cookie', `${DEVICE_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
}

export async function issueApprovedDeviceSession({ response, db, ownerId, credentialId }) {
  // Never expose a bearer device token in JSON or localStorage.
  const token = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + SESSION_AGE * 1000).toISOString();
  const { error } = await db.from('device_verified_sessions').insert({
    token_hash: tokenHash, owner_id: ownerId, credential_id: credentialId, expires_at: expiresAt,
  });
  if (error) throw new Error('DEVICE_SESSION_STORE_UNAVAILABLE');
  response.setHeader('Set-Cookie', `${DEVICE_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_AGE}`);
  return { verified: true, expiresAt };
}

export async function approvedDeviceSession({ request, db, identity }) {
  if (!identity || identity.kind !== 'student' || typeof identity.userId !== 'string') return false;
  const token = readCookie(request, DEVICE_COOKIE);
  if (!token || !TOKEN.test(token)) return false;
  const tokenHash = createHash('sha256').update(token).digest('hex');
  try {
    const { data: session, error: sessionError } = await db.from('device_verified_sessions')
      .select('owner_id,credential_id,expires_at').eq('token_hash', tokenHash)
      .eq('owner_id', identity.userId).gt('expires_at', new Date().toISOString()).maybeSingle();
    if (sessionError || !session || session.owner_id !== identity.userId ||
        !session.expires_at || Date.parse(session.expires_at) <= Date.now()) return false;
    const { data: credential, error } = await db.from('device_approval_requests')
      .select('owner_id,credential_id,status').eq('credential_id', session.credential_id)
      .eq('owner_id', identity.userId).maybeSingle();
    return !error && !!credential && credential.owner_id === identity.userId &&
      credential.credential_id === session.credential_id && credential.status === 'approved';
  } catch { return false; } // fail closed if DB inactive/unavailable
}

export async function mayAccessProtectedData({ request, db, identity }) {
  // The ALEPH judge token is separately authenticated and evaluated by its
  // trusted engine, which verifies deviceRegistered before reaching decide().
  if (identity?.kind === 'judge') return true;
  return approvedDeviceSession({ request, db, identity });
}
