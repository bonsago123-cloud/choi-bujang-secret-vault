import { createClient } from '@supabase/supabase-js';
import config from '../aleph.config.json' with { type: 'json' };
import { createLoginVerifier } from '../src/verify-login.mjs';

// Stage 3: the server verifies an Authorization token BEFORE reading any notes.
// Never trust browser-provided userId or role values, or expose server credentials.
const SAMPLE_TITLES = ['과제', '포트폴리오', '아침 리추얼', '훈련 행정 자료'];

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Vary', 'Authorization');
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }

  const authorization = request.headers?.authorization ?? request.headers?.Authorization;
  if (typeof authorization !== 'string'
      || !/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(authorization)) {
    response.setHeader('WWW-Authenticate', 'Bearer');
    return response.status(401).json({ error: 'UNAUTHORIZED' });
  }

  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) {
    return response.status(503).json({ error: 'NOT_CONFIGURED' });
  }

  try {
    // The provided template handles Supabase student JWTs and operator judge JWTs.
    // Only a non-null result from its verified checks permits the DB query.
    const verifyLogin = createLoginVerifier({ config, supabaseSecretKey: secretKey });
    const verifiedIdentity = await verifyLogin(authorization);
    if (!verifiedIdentity) {
      response.setHeader('WWW-Authenticate', 'Bearer');
      return response.status(401).json({ error: 'UNAUTHORIZED' });
    }

    const supabase = createClient(url, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data, error } = await supabase
      .from('study_notes')
      .select('title,content')
      .is('owner_id', null)
      .in('title', SAMPLE_TITLES)
      .order('id', { ascending: true });

    // Fail closed on unexpected records, instead of accidentally returning new data.
    if (error || !Array.isArray(data) || data.length !== SAMPLE_TITLES.length
      || new Set(data.map((note) => note.title)).size !== SAMPLE_TITLES.length
      || data.some((note) => !SAMPLE_TITLES.includes(note.title)
        || typeof note.content !== 'string'
        || !/^실습용 가상 .+ 기록$/u.test(note.content))) {
      return response.status(502).json({ error: 'NOTES_UNAVAILABLE' });
    }

    return response.status(200).json({ notes: data.map(({ title, content }) => ({ title, content })) });
  } catch {
    // Do not reveal Supabase errors, secret keys, tokens, or server details.
    return response.status(502).json({ error: 'NOTES_UNAVAILABLE' });
  }
}
