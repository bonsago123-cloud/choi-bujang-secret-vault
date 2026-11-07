// Stage 12: Operations-room read-only API; accessible only to a server-verified student device.
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import config from '../aleph.config.json' with { type: 'json' };
import { createLoginVerifier } from '../src/verify-login.mjs';
import { hasAuthCookie, identifyRequest } from '../src/server-auth.mjs';
import { approvedDeviceSession } from '../src/device-access.mjs';
import { buildOperationsReport } from '../src/operations-summary.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const BEARER = /^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u;
export function createOperationsHandler({ verify, makeDb, log = line => console.info(line) } = {}) {
  return async function handler(request, response) {
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Vary', 'Authorization, Cookie');
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET');
      return response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
    }
    const authorization = request.headers?.authorization ?? request.headers?.Authorization;
    if ((authorization !== undefined && (typeof authorization !== 'string' || !BEARER.test(authorization)))
        || (authorization === undefined && !hasAuthCookie(request))) {
      return response.status(401).json({ error: 'UNAUTHORIZED' });
    }
    const url = process.env.SUPABASE_URL;
    const secret = process.env.SUPABASE_SECRET_KEY;
    if ((!url || !secret) && (!verify || !makeDb)) {
      return response.status(503).json({ error: 'NOT_CONFIGURED' });
    }
    try {
      const verifyLogin = verify ?? createLoginVerifier({ config, supabaseSecretKey: secret });
      const { identity } = await identifyRequest(request, response, verifyLogin);
      if (!identity || identity.kind !== 'student' || !UUID.test(identity.userId ?? '')) {
        return response.status(401).json({ error: 'UNAUTHORIZED' });
      }
      const db = makeDb ? makeDb() : createClient(url, secret, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      if (!(await approvedDeviceSession({ request, db, identity }))) {
        return response.status(403).json({ error: 'DEVICE_APPROVAL_REQUIRED' });
      }
      const report = buildOperationsReport({
        requestId: randomUUID(), generatedAt: new Date().toISOString(),
      });
      // The exact object returned to the browser is written to the server log.
      // No request headers, user IDs, source events, tokens, or memo fields are logged.
      log('[STAGE12_OPERATIONS] ' + JSON.stringify(report.redactedServerLog));
      return response.status(200).json(report);
    } catch {
      return response.status(503).json({ error: 'OPERATIONS_UNAVAILABLE' });
    }
  };
}
export default createOperationsHandler();
