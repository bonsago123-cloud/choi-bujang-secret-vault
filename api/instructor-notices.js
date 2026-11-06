import config from '../aleph.config.json' with { type: 'json' };
import { createLoginVerifier } from '../src/verify-login.mjs';
import { hasAuthCookie, identifyRequest } from '../src/server-auth.mjs';
import { RESOURCE_IDS } from '../src/resource-ids.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const BEARER = /^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u;

// This route is student-readable in the engine policy, but no announcement data exists yet.
// All notice writes are denied here, even to callers claiming role=instructor.
// Future instructor editing must use a separate server-admin API backed by a stored grant.
export function createInstructorNoticesHandler({ verify } = {}) {
  return async function handler(request, response) {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Vary', 'Authorization, Cookie');
    response.setHeader('X-Resource-ID', RESOURCE_IDS.instructorNotices);

    if (request.method !== 'GET') {
      return response.status(403).json({ error: 'NOTICE_READ_ONLY' });
    }
    const authorization = request.headers?.authorization ?? request.headers?.Authorization;
    if ((authorization !== undefined && (typeof authorization !== 'string' || !BEARER.test(authorization)))
      || (authorization === undefined && !hasAuthCookie(request))) {
      response.setHeader('WWW-Authenticate', 'Bearer');
      return response.status(401).json({ error: 'UNAUTHORIZED' });
    }
    const secretKey = process.env.SUPABASE_SECRET_KEY;
    if (!verify && !secretKey) return response.status(503).json({ error: 'NOT_CONFIGURED' });
    try {
      const verifyLogin = verify ?? createLoginVerifier({ config, supabaseSecretKey: secretKey });
      const { identity } = await identifyRequest(request, response, verifyLogin);
      if (!identity || typeof identity.userId !== 'string' || !UUID.test(identity.userId)) {
        response.setHeader('WWW-Authenticate', 'Bearer');
        return response.status(401).json({ error: 'UNAUTHORIZED' });
      }
      // No stored instructor-role source or announcement database is configured.
      // Do not manufacture instructor permissions or return fictional content.
      return response.status(501).json({ error: 'INSTRUCTOR_NOTICES_NOT_IMPLEMENTED' });
    } catch {
      return response.status(502).json({ error: 'AUTH_UNAVAILABLE' });
    }
  };
}

export default createInstructorNoticesHandler();
