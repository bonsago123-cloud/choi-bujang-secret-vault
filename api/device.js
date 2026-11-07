// Stage 11: WebAuthn device enrollment request + separate administrator approval.
// Browser cannot self-approve. Server verifies authenticator assertions and DB approval.
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import config from '../aleph.config.json' with { type: 'json' };
import { createLoginVerifier } from '../src/verify-login.mjs';
import { identifyRequest, sameOrigin } from '../src/server-auth.mjs';
import {
  approvedDeviceSession, clearDeviceSession, fingerprintCredential,
  issueApprovedDeviceSession,
} from '../src/device-access.mjs';

const ORIGIN = new URL(config.publicAppUrl).origin;
const RP_ID = new URL(config.publicAppUrl).hostname;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const B64 = /^[A-Za-z0-9_-]{12,512}$/u;
const CHALLENGE_LIFETIME_MS = 5 * 60 * 1000;

const fail = (res, code, error) => res.status(code).json({ error });
const createDb = () => createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
const isObj = obj => obj !== null && typeof obj === 'object' && !Array.isArray(obj);
function readBody(request) {
  const body = typeof request.body === 'string' ? JSON.parse(request.body) : request.body;
  if (!isObj(body) || JSON.stringify(body).length > 24000) throw new TypeError('INVALID_PAYLOAD');
  return body;
}
async function createChallenge(db, identity, purpose, challenge) {
  const id = randomUUID();
  const { error } = await db.from('device_auth_challenges').insert({
    id, owner_id: identity.userId, purpose, challenge,
    expires_at: new Date(Date.now() + CHALLENGE_LIFETIME_MS).toISOString(),
  });
  if (error) throw new Error('CHALLENGE_STORE_UNAVAILABLE');
  return id;
}
async function consumeChallenge(db, identity, id, purpose) {
  if (typeof id !== 'string' || !UUID.test(id)) throw new TypeError('INVALID_CHALLENGE');
  // Atomic conditional UPDATE: only one caller can consume a challenge.
  const { data, error } = await db.from('device_auth_challenges')
    .update({ used_at: new Date().toISOString() })
    .eq('id', id).eq('owner_id', identity.userId).eq('purpose', purpose)
    .is('used_at', null).gt('expires_at', new Date().toISOString())
    .select('challenge').maybeSingle();
  if (error || !data?.challenge) throw new TypeError('CHALLENGE_EXPIRED');
  return data.challenge;
}
async function devices(db, ownerId) {
  const { data, error } = await db.from('device_approval_requests')
    .select('credential_id,request_code,status,transports,counter,public_key,owner_id')
    .eq('owner_id', ownerId).order('created_at', { ascending: false });
  if (error || !Array.isArray(data)) throw new Error('DEVICE_REGISTRY_UNAVAILABLE');
  return data;
}

export function createDeviceHandler({ verify, makeDb = createDb } = {}) {
  return async function deviceHandler(request, response) {
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Vary', 'Cookie, Origin');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const action = request.query?.action;
    const statusRequest = action === 'status' && request.method === 'GET';
    if (!statusRequest && request.method !== 'POST') return fail(response, 405, 'METHOD_NOT_ALLOWED');
    if (!['status', 'request-options', 'request', 'verify-options', 'verify'].includes(action)) {
      return fail(response, 404, 'NOT_FOUND');
    }
    if (!statusRequest && !sameOrigin(request)) return fail(response, 403, 'FORBIDDEN');
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
      return fail(response, 503, 'DEVICE_APPROVAL_UNAVAILABLE');
    }
    try {
      const verifyLogin = verify ?? createLoginVerifier({
        config, supabaseSecretKey: process.env.SUPABASE_SECRET_KEY,
      });
      const session = await identifyRequest(request, response, verifyLogin);
      if (session.mode !== 'cookie' || session.identity?.kind !== 'student'
          || !UUID.test(session.identity.userId)) return fail(response, 401, 'UNAUTHORIZED');
      const identity = session.identity;
      const db = makeDb();
      if (action === 'status') {
        const registered = await devices(db, identity.userId);
        const verified = await approvedDeviceSession({ request, db, identity });
        const approved = registered.filter(d => d.status === 'approved');
        const pending = registered.filter(d => d.status === 'pending');
        return response.status(200).json({
          state: verified ? 'verified' : approved.length ? 'approved' : pending.length ? 'pending'
            : registered.some(d => d.status === 'denied') ? 'denied' : 'unregistered',
          verified,
          requestCode: pending[0]?.request_code ?? null,
        });
      }
      if (action === 'request-options') {
        const options = await generateRegistrationOptions({
          rpName: 'BYTE BACK 내 자료실', rpID: RP_ID,
          userID: new TextEncoder().encode(identity.userId), userName: 'BYTE BACK device',
          attestationType: 'none', supportedAlgorithmIDs: [-7, -257],
          authenticatorSelection: {
            authenticatorAttachment: 'platform', residentKey: 'discouraged',
            userVerification: 'required',
          },
        });
        const challengeId = await createChallenge(db, identity, 'register', options.challenge);
        return response.status(200).json({ options, challengeId });
      }
      if (action === 'request') {
        const payload = readBody(request);
        const challenge = await consumeChallenge(db, identity, payload.challengeId, 'register');
        const verification = await verifyRegistrationResponse({
          response: payload.credential, expectedChallenge: challenge,
          expectedOrigin: ORIGIN, expectedRPID: RP_ID, requireUserVerification: true,
          supportedAlgorithmIDs: [-7, -257],
        });
        if (!verification.verified || !verification.registrationInfo?.credential) {
          return fail(response, 403, 'DEVICE_PROOF_INVALID');
        }
        // Synced passkeys may work on other devices; do not call them device-bound.
        if (verification.registrationInfo.credentialDeviceType !== 'singleDevice'
            || verification.registrationInfo.credentialBackedUp) {
          return fail(response, 403, 'DEVICE_BOUND_AUTHENTICATOR_REQUIRED');
        }
        const credential = verification.registrationInfo.credential;
        if (!B64.test(credential.id) || !credential.publicKey?.length) {
          return fail(response, 400, 'DEVICE_CREDENTIAL_INVALID');
        }
        const requestCode = fingerprintCredential(credential.id);
        const { error } = await db.from('device_approval_requests').insert({
          owner_id: identity.userId, credential_id: credential.id, request_code: requestCode,
          public_key: Buffer.from(credential.publicKey).toString('base64url'),
          counter: Number(credential.counter) || 0,
          transports: Array.isArray(payload.credential?.response?.transports)
            ? payload.credential.response.transports.slice(0, 8) : [],
          status: 'pending',
        });
        if (error) return fail(response, error.code === '23505' ? 409 : 503,
          error.code === '23505' ? 'DEVICE_ALREADY_REQUESTED' : 'DEVICE_REGISTRY_UNAVAILABLE');
        // Only a separately authorized operator may change status to approved.
        return response.status(202).json({ state: 'pending', requestCode });
      }
      if (action === 'verify-options') {
        const registered = await devices(db, identity.userId);
        const approved = registered.filter(d => d.status === 'approved');
        if (!approved.length) return fail(response, 403, 'DEVICE_NOT_APPROVED');
        const options = await generateAuthenticationOptions({
          rpID: RP_ID, userVerification: 'required',
          allowCredentials: approved.map(d => ({
            id: d.credential_id, transports: Array.isArray(d.transports) ? d.transports : [],
          })),
        });
        const challengeId = await createChallenge(db, identity, 'authenticate', options.challenge);
        return response.status(200).json({ options, challengeId });
      }
      if (action === 'verify') {
        const payload = readBody(request);
        // Consume before signature verification: failed proof cannot retry the same challenge.
        const challenge = await consumeChallenge(db, identity, payload.challengeId, 'authenticate');
        const submittedId = payload.credential?.id;
        if (typeof submittedId !== 'string' || !B64.test(submittedId)) {
          return fail(response, 403, 'DEVICE_PROOF_INVALID');
        }
        const { data: registered, error: lookupError } = await db.from('device_approval_requests')
          .select('owner_id,credential_id,status,public_key,counter,transports')
          .eq('credential_id', submittedId).eq('owner_id', identity.userId).maybeSingle();
        if (lookupError || !registered || registered.status !== 'approved') {
          return fail(response, 403, 'DEVICE_NOT_APPROVED');
        }
        const key = Buffer.from(registered.public_key, 'base64url');
        const verification = await verifyAuthenticationResponse({
          response: payload.credential, expectedChallenge: challenge,
          expectedOrigin: ORIGIN, expectedRPID: RP_ID, requireUserVerification: true,
          credential: {
            id: registered.credential_id, publicKey: new Uint8Array(key),
            counter: Number(registered.counter),
            transports: Array.isArray(registered.transports) ? registered.transports : [],
          },
        });
        if (!verification.verified) return fail(response, 403, 'DEVICE_PROOF_INVALID');
        const newCounter = verification.authenticationInfo.newCounter;
        const { data: changed, error: counterError } = await db.from('device_approval_requests')
          .update({ counter: newCounter, last_verified_at: new Date().toISOString() })
          .eq('credential_id', submittedId).eq('owner_id', identity.userId)
          .eq('counter', registered.counter).eq('status', 'approved')
          .select('credential_id').maybeSingle();
        if (counterError || !changed) return fail(response, 409, 'DEVICE_PROOF_CONFLICT');
        const deviceSession = await issueApprovedDeviceSession({
          response, db, ownerId: identity.userId, credentialId: submittedId,
        });
        return response.status(200).json({ state: 'verified', expiresAt: deviceSession.expiresAt });
      }
      return fail(response, 404, 'NOT_FOUND');
    } catch (error) {
      if (error instanceof TypeError && /INVALID_|CHALLENGE_EXPIRED/.test(error.message)) {
        return fail(response, 400, 'DEVICE_PROOF_INVALID');
      }
      // No sensitive details returned; closed on any DB/verification failure.
      return fail(response, 503, 'DEVICE_APPROVAL_UNAVAILABLE');
    }
  };
}

export default createDeviceHandler();
