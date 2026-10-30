// Local self-check: only describe requests actually sent; not an official judge result.
// Never include credentials, note contents, tokens or personal information in results.
export async function runAttackChecks(config) {
  if (![1, 2, 3, 4].includes(config.step)) throw new Error('이 단계의 공격 점검을 구현해 주세요.');
  let app;
  try { app = new URL(config.publicAppUrl); }
  catch { throw new Error('aleph.config.json에 실제 배포 주소를 설정해 주세요.'); }
  if (app.protocol !== 'https:' || app.username || app.password || app.search || app.hash
      || app.pathname !== '/' || app.hostname.endsWith('.example')) {
    throw new Error('aleph.config.json의 배포 주소를 확인해 주세요.');
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
