// Local self-check: only describe requests actually sent; not an official judge result.
// Never include credentials, note contents, tokens or personal information in results.
export async function runAttackChecks(config) {
  if (![1, 2, 3, 4, 5].includes(config.step)) throw new Error('이 단계의 공격 점검을 구현해 주세요.');
  let app;
  try { app = new URL(config.publicAppUrl); }
  catch { throw new Error('aleph.config.json에 실제 배포 주소를 설정해 주세요.'); }
  if (app.protocol !== 'https:' || app.username || app.password || app.search || app.hash
      || app.pathname !== '/' || app.hostname.endsWith('.example')) {
    throw new Error('aleph.config.json의 배포 주소를 확인해 주세요.');
  }

  if (config.step === 5) {
    let original;
    let issuer;
    try {
      original = new URL(config.originalApiUrl);
      issuer = new URL(config.identityProvider.issuer);
    } catch {
      throw new Error('5단계 원본 자료 API 주소와 인증 발급자를 확인해 주세요.');
    }
    if (original.protocol !== 'https:' || original.username || original.password
        || original.search || original.hash || original.origin !== issuer.origin
        || original.pathname !== '/rest/v1/study_notes') {
      throw new Error('5단계 원본 자료 API는 쿼리 없는 Supabase study_notes HTTPS 경로여야 합니다.');
    }

    const requestOptions = { redirect: 'error', signal: AbortSignal.timeout(10000) };
    // The publishable key is already public in the browser app; never print the key.
    const homepage = await fetch(app, requestOptions);
    if (!homepage.ok) throw new Error('배포 홈페이지에서 공개 API 키를 확인하지 못했습니다.');
    const html = await homepage.text();
    const key = /\bconst PUBLISHABLE_KEY\s*=\s*['"](sb_publishable_[A-Za-z0-9_-]+)['"]/u.exec(html)?.[1];
    if (!key) throw new Error('배포 홈페이지에서 Supabase 공개 키를 찾지 못했습니다.');

    const [direct, collection, sample] = await Promise.all([
      fetch(original, { ...requestOptions, headers: { apikey: key, Accept: 'application/json' } }),
      fetch(new URL('/api/memos', app), requestOptions),
      fetch(new URL('/api/notes', app), requestOptions),
    ]);
    // Record HTTP status codes only; never read or record memo bodies or credentials.
    return [
      {
        attackId: 'anon_direct_study_notes',
        expected: '공개 키의 anon 권한으로 원본 study_notes 직접 조회 시 HTTP 401 또는 403',
        observed: `실제 anon 원본 자료 HTTP ${direct.status}; ${[401, 403].includes(direct.status) ? '직접 조회 거부' : '접근 상태 추가 확인 필요'}`,
      },
      {
        attackId: 'anonymous_note_read',
        expected: '비로그인 서버 메모 API 두 경로 모두 HTTP 401',
        observed: `실제 비로그인 HTTP 상태: /api/memos ${collection.status}, /api/notes ${sample.status}`,
      },
    ];
  }

  if (config.step === 3 || config.step === 4) {
    const requestOptions = { redirect: 'error', signal: AbortSignal.timeout(10000) };
    const [collection, sample] = await Promise.all([
      fetch(new URL('/api/memos', app), requestOptions),
      fetch(new URL('/api/notes', app), requestOptions),
    ]);
    // Inspect the status, not the response body, to avoid accidentally storing any notes.
    return [{ attackId: 'anonymous_note_read',
      expected: '비로그인 GET /api/memos 및 GET /api/notes 모두 HTTP 401로 거부',
      observed: `실제 비로그인 HTTP 상태: /api/memos ${collection.status}, /api/notes ${sample.status}` }];
  }

  const response = await fetch(new URL('/data.json', app), {
    redirect: 'error', signal: AbortSignal.timeout(10000),
  });
  let visible = false;
  let empty = response.status === 404;
  if (response.ok) {
    try {
      const data = await response.json();
      const valid = data?.sampleMarker === config.sampleMarker && Array.isArray(data.notes);
      visible = valid && data.notes.length > 0;
      empty = valid && data.notes.length === 0;
    } catch { /* invalid JSON is not successful verification */ }
  }
  if (config.step === 2) {
    return [{ attackId: 'anonymous_note_read',
      expected: '비로그인에서 공개 data.json에 가상 메모 본문이 보이지 않음',
      observed: empty ? '비로그인에서 공개 data.json이 없거나 빈 목록임을 확인'
        : `비로그인에서 공개 자료 상태 확인 필요 (HTTP ${response.status})` }];
  }
  return [{ attackId: 'anonymous_note_read', expected: '비로그인 화면에서 가상 메모를 확인',
    observed: visible ? '비로그인 요청에서 공개 가상 메모 확인 표시가 보임'
      : `비로그인 요청에서 확인 표시가 보이지 않음 (HTTP ${response.status})` }];
}
