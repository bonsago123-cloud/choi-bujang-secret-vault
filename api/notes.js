import { createClient } from '@supabase/supabase-js';
import config from '../aleph.config.json' with { type: 'json' };
import { createLoginVerifier } from '../src/verify-login.mjs';

// Stage 4: read only the verified user's learning notes. Preserve /api/notes shape.
const SAMPLE_TITLES = ['과제', '포트폴리오', '아침 리추얼', '훈련 행정 자료',
  'B 계정 시험 메모'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const BEARER = /^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u;

// Dependency injection is used by local tests, not by the deployed default handler.
export function createNotesHandler({ verify, makeDb } = {}) {
  return async function handler(request, response) {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Vary', 'Authorization');
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET');
      return response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
    }

    const authorization = request.headers?.authorization ?? request.headers?.Authorization;
    if (typeof authorization !== 'string' || !BEARER.test(authorization)) {
      response.setHeader('WWW-Authenticate', 'Bearer');
      return response.status(401).json({ error: 'UNAUTHORIZED' });
    }

    const url = process.env.SUPABASE_URL;
    const secretKey = process.env.SUPABASE_SECRET_KEY;
    if ((!url || !secretKey) && (!verify || !makeDb)) {
      return response.status(503).json({ error: 'NOT_CONFIGURED' });
    }

    try {
      const verifyLogin = verify ?? createLoginVerifier({ config, supabaseSecretKey: secretKey });
      const verifiedIdentity = await verifyLogin(authorization);
      if (!verifiedIdentity || !UUID.test(verifiedIdentity.userId ?? '')) {
        response.setHeader('WWW-Authenticate', 'Bearer');
        return response.status(401).json({ error: 'UNAUTHORIZED' });
      }

      const supabase = makeDb ? makeDb() : createClient(url, secretKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      const { data, error } = await supabase
        .from('study_notes')
        .select('title,content')
        .eq('owner_id', verifiedIdentity.userId)
        .in('title', SAMPLE_TITLES)
        .order('id', { ascending: true });

      // Reject unexpected data without requiring every account to have four notes.
      if (error || !Array.isArray(data) || data.length > SAMPLE_TITLES.length
        || new Set(data.map(note => note.title)).size !== data.length
        || data.some(note => !SAMPLE_TITLES.includes(note.title)
          || typeof note.content !== 'string'
          || !/^실습용 가상 .+ 기록$/u.test(note.content))) {
        return response.status(502).json({ error: 'NOTES_UNAVAILABLE' });
      }

      return response.status(200).json({ notes: data.map(({ title, content }) => ({ title, content })) });
    } catch {
      return response.status(502).json({ error: 'NOTES_UNAVAILABLE' });
    }
  };
}

export default createNotesHandler();
