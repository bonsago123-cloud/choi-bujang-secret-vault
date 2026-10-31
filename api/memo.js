import { createClient } from '@supabase/supabase-js';
import config from '../aleph.config.json' with { type: 'json' };
import { createLoginVerifier } from '../src/verify-login.mjs';
import { cookieWriteForbidden, hasAuthCookie, identifyRequest } from '../src/server-auth.mjs';

const BEARER = /^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

// Stage 4: use the server-verified identity as a row-level condition on
// every item operation; a URL/body owner_id never establishes ownership.
export function createMemoItemHandler({ verify, makeDb } = {}) {
  return async function handler(request, response) {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Vary', 'Authorization');
    if (!['GET', 'PUT', 'DELETE'].includes(request.method)) {
      response.setHeader('Allow', 'GET, PUT, DELETE');
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
    const id = request.query?.id;
    if (typeof id !== 'string' || !UUID.test(id)) {
      return response.status(400).json({ error: 'INVALID_ID' });
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
      const supabase = makeDb ? makeDb() : createClient(url, secretKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      if (request.method === 'GET') {
        const { data, error } = await supabase.from('user_notes')
          .select('id,title,body').eq('id', id)
          .eq('owner_id', identity.userId).maybeSingle();
        if (error) return response.status(502).json({ error: 'NOTES_UNAVAILABLE' });
        if (!data) return response.status(404).json({ error: 'NOT_FOUND' });
        return response.status(200).json({ id: data.id, title: data.title, body: data.body });
      }
      if (request.method === 'PUT') {
        let body;
        try { body = typeof request.body === 'string' ? JSON.parse(request.body) : request.body; }
        catch { return response.status(400).json({ error: 'INVALID_NOTE' }); }
        if (!body || typeof body !== 'object' || Array.isArray(body)
            || Object.hasOwn(body, 'owner_id') || Object.hasOwn(body, 'id')
            || typeof body.title !== 'string' || !body.title.trim() || body.title.trim().length > 200
            || typeof body.body !== 'string' || body.body.length > 10000) {
          return response.status(400).json({ error: 'INVALID_NOTE' });
        }
        const { data, error } = await supabase.from('user_notes')
          .update({ title: body.title.trim(), body: body.body, updated_at: new Date().toISOString() })
          .eq('id', id).eq('owner_id', identity.userId)
          .select('id,title,body,owner_id').maybeSingle();
        if (error) return response.status(502).json({ error: 'NOTES_UNAVAILABLE' });
        if (!data) return response.status(404).json({ error: 'NOT_FOUND' });
        // The server never updates owner_id, and checks the returned row's owner too.
        if (data.owner_id !== identity.userId) {
          return response.status(502).json({ error: 'NOTES_UNAVAILABLE' });
        }
        return response.status(200).json({ id: data.id, title: data.title, body: data.body });
      }
      const { data, error } = await supabase.from('user_notes')
        .delete().eq('id', id).eq('owner_id', identity.userId)
        .select('id').maybeSingle();
      if (error) return response.status(502).json({ error: 'NOTES_UNAVAILABLE' });
      if (!data) return response.status(404).json({ error: 'NOT_FOUND' });
      return response.status(200).json({ id: data.id });
    } catch {
      return response.status(502).json({ error: 'NOTES_UNAVAILABLE' });
    }
  };
}

export default createMemoItemHandler();
