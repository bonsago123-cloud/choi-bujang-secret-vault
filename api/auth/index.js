import { createLoginVerifier } from '../../src/verify-login.mjs';
import config from '../../aleph.config.json' with { type: 'json' };
import {
  clearSessionCookies, identifyRequest, makePublicAuthClient,
  readSessionTokens, sameOrigin, setSessionCookies,
} from '../../src/server-auth.mjs';

function jsonError(response, code, error) { return response.status(code).json({ error }); }

export function createAuthHandler({ makeClient = makePublicAuthClient, verify } = {}) {
  return async function handler(request, response) {
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Vary', 'Cookie, Origin');
    const action = request.query?.action;
    const method = request.method;
    if (!['login', 'session', 'logout'].includes(action)) {
      return jsonError(response, 404, 'NOT_FOUND');
    }
    if ((action === 'session' && method !== 'GET')
        || (action !== 'session' && method !== 'POST')) {
      response.setHeader('Allow', action === 'session' ? 'GET' : 'POST');
      return jsonError(response, 405, 'METHOD_NOT_ALLOWED');
    }
    if (action !== 'session' && !sameOrigin(request)) {
      return jsonError(response, 403, 'FORBIDDEN');
    }
    if (action === 'logout') {
      const { accessToken, refreshToken } = readSessionTokens(request);
      // Clear the browser's credentials even if the upstream session is already gone.
      clearSessionCookies(response);
      if (accessToken && refreshToken) {
        try {
          const client = makeClient();
          const { error } = await client.auth.setSession({
            access_token: accessToken, refresh_token: refreshToken,
          });
          if (!error) await client.auth.signOut({ scope: 'local' });
        } catch { /* Cookies were cleared; do not leak upstream error details. */ }
      }
      return response.status(200).json({ loggedOut: true });
    }
    if (!process.env.SUPABASE_URL || (!verify && !process.env.SUPABASE_SECRET_KEY)) {
      return jsonError(response, 503, 'NOT_CONFIGURED');
    }
    try {
      if (action === 'login') {
        const contentType = request.headers?.['content-type'] ?? '';
        if (!/^application\/json(?:\s*;|$)/iu.test(contentType)) {
          return jsonError(response, 415, 'UNSUPPORTED_MEDIA_TYPE');
        }
        let body;
        try { body = typeof request.body === 'string' ? JSON.parse(request.body) : request.body; }
        catch { return jsonError(response, 400, 'INVALID_CREDENTIALS'); }
        if (!body || typeof body !== 'object' || Array.isArray(body)
            || typeof body.email !== 'string' || body.email.length > 254
            || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(body.email)
            || typeof body.password !== 'string' || body.password.length < 1
            || body.password.length > 1024) {
          return jsonError(response, 400, 'INVALID_CREDENTIALS');
        }
        const { data, error } = await makeClient().auth.signInWithPassword({
          email: body.email.trim(), password: body.password,
        });
        if (error || !data?.session || !data?.user?.id) {
          return jsonError(response, 401, 'AUTH_FAILED');
        }
        setSessionCookies(response, data.session);
        // No access token or refresh token is ever returned in JSON.
        return response.status(200).json({ user: { email: data.user.email ?? '' } });
      }
      // Auth status must verify the JWT; a cookie alone cannot assert identity.
      const verifyLogin = verify ?? createLoginVerifier({
        config, supabaseSecretKey: process.env.SUPABASE_SECRET_KEY,
      });
      const result = await identifyRequest(request, response, verifyLogin, { makeClient });
      if (!result.identity || result.mode !== 'cookie') return jsonError(response, 401, 'UNAUTHORIZED');
      const { data, error } = await makeClient().auth.getUser(result.accessToken);
      if (error || !data?.user || data.user.id !== result.identity.userId) {
        return jsonError(response, 401, 'UNAUTHORIZED');
      }
      return response.status(200).json({ user: { email: data.user.email ?? '' } });
    } catch {
      return jsonError(response, 502, 'AUTH_UNAVAILABLE');
    }
  };
}

export default createAuthHandler();
