import { createClient } from '@supabase/supabase-js';

// Stage 2: this endpoint is deliberately PUBLIC. Return only the four synthetic notes.
// The server-only SUPABASE_SECRET_KEY must never be sent to the browser or logged.
const SAMPLE_TITLES = ['과제', '포트폴리오', '아침 리추얼', '훈련 행정 자료'];

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }

  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) {
    return response.status(503).json({ error: 'NOT_CONFIGURED' });
  }

  try {
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
    // Do not reflect Supabase errors, URLs, keys, or internal details to clients or logs.
    return response.status(502).json({ error: 'NOTES_UNAVAILABLE' });
  }
}
