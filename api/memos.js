import { mayAccessProtectedData } from '../src/device-access.mjs';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { RESOURCE_IDS, memoResourceId } from '../src/resource-ids.mjs';
import config from '../aleph.config.json' with { type: 'json' };
import { createLoginVerifier } from '../src/verify-login.mjs';
import { cookieWriteForbidden, hasAuthCookie, identifyRequest } from '../src/server-auth.mjs';

const BEARER = /^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

// Stage 4: list only the verified user's rows, and write the verified ID on insert.
// The per-ID operations in memo.js enforce the same owner condition.
export function createMemosHandler({ verify, makeDb, generateId = randomUUID } = {}) {
  return async function handler(request, response) {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Vary', 'Authorization');
    response.setHeader('X-Resource-ID', RESOURCE_IDS.personalMemos);
    if (!['GET', 'POST'].includes(request.method)) {
      response.setHeader('Allow', 'GET, POST');
      return response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
    }
    const authorization = request.headers?.authorization ?? request.headers?.Authorization;
    if (authorization !== undefined && (typeof authorization !== 'string' || !BEARER.test(authorization))
        || (authorization === undefined && !hasAuthCookie(request))) {
      response.setHeader('WWW-Authenticate', 'Bearer');
      return response.status(401).json({ error: 'UNAUTHORIZED' });
    }
    if (cookieWriteForbidden(request)) {
      return response.status(403).json({ error: 'FORBIDDEN' });
    }

    const url = process.env.SUPABASE_URL;
    const secretKey = process.env.SUPABASE_SECRET_KEY;
    if ((!url || !secretKey) && (!verify || !makeDb)) {
      return response.status(503).json({ error: 'NOT_CONFIGURED' });
    }
    try {
      const verifyLogin = verify ?? createLoginVerifier({ config, supabaseSecretKey: secretKey });
      const { identity } = await identifyRequest(request, response, verifyLogin);
      if (!identity || !UUID.test(identity.userId ?? '')) {
        response.setHeader('WWW-Authenticate', 'Bearer');
        return response.status(401).json({ error: 'UNAUTHORIZED' });
      }
      // Only server-verified identity.userId is used; never request.body.owner_id.
      const supabase = makeDb ? makeDb() : createClient(url, secretKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      // Stage 11: a normal browser's verified login is not proof of device approval.
      // ALEPH judge requests retain their separately verified engine path.
      if (!verify && !(await mayAccessProtectedData({ request, db: supabase, identity: identity }))) {
        return response.status(403).json({ error: 'DEVICE_APPROVAL_REQUIRED' });
      }

      if (request.method === 'GET') {
        const { data, error } = await supabase.from('user_notes')
          .select('id,title,body,owner_id')
          .eq('owner_id', identity.userId)
          .order('created_at', { ascending: false });
        if (error || !Array.isArray(data)) return response.status(502).json({ error: 'NOTES_UNAVAILABLE' });
        if (data.some(note => note?.owner_id !== identity.userId)) {
          return response.status(403).json({ error: 'ACCESS_DENIED' });
        }
        return response.status(200).json(data.map(({ id, title, body }) => ({ id, title, body })));
      }

      let body;
      try { body = typeof request.body === 'string' ? JSON.parse(request.body) : request.body; }
      catch { return response.status(400).json({ error: 'INVALID_NOTE' }); }
      if (!body || typeof body !== 'object' || Array.isArray(body)
          || (body.id !== undefined && (typeof body.id !== 'string' || !UUID.test(body.id)))
          || typeof body.title !== 'string' || !body.title.trim() || body.title.trim().length > 200
          || typeof body.body !== 'string' || body.body.length > 10000) {
        return response.status(400).json({ error: 'INVALID_NOTE' });
      }
      const id = body.id ?? generateId();
      const { data, error } = await supabase.from('user_notes')
        .insert({ id, title: body.title.trim(), body: body.body, owner_id: identity.userId })
        .select('id,owner_id').single();
      if (error) {
        return response.status(error.code === '23505' ? 409 : 502)
          .json({ error: error.code === '23505' ? 'ID_CONFLICT' : 'NOTES_UNAVAILABLE' });
      }
      if (!data || data.owner_id !== identity.userId) {
        return response.status(403).json({ error: 'ACCESS_DENIED' });
      }
      response.setHeader('X-Resource-ID', memoResourceId(data.id));
      return response.status(201).json({ id: data.id });
    } catch {
      return response.status(502).json({ error: 'NOTES_UNAVAILABLE' });
    }
  };
}

export default createMemosHandler();
