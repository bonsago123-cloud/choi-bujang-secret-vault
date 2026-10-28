// Local self-check: only describe responses actually received, never call them judge results.
// Never print personal data, tokens, keys or memo contents.
export async function runAttackChecks(config) {
  if (![1, 2].includes(config.step)) throw new Error('이 단계의 공격 점검을 구현해 주세요.');
  let app;
  try { app = new URL(config.publicAppUrl); }
  catch { throw new Error('aleph.config.json에 실제 배포 주소를 설정해 주세요.'); }
  if (app.protocol !== 'https:' || app.username || app.password || app.search || app.hash
      || app.pathname !== '/' || app.hostname.endsWith('.example')) {
    throw new Error('aleph.config.json의 배포 주소를 확인해 주세요.');
  }
  const response = await fetch(new URL('/data.json', app), {
    redirect: 'error', signal: AbortSignal.timeout(10000),
  });
  let visible = false;
  let empty = false;
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
      expected: '비로그인에서 가상 메모 본문이 보이지 않음',
      observed: empty ? '비로그인에서 빈 공개 메모 목록 확인'
        : `비로그인에서 공개 자료 상태 확인 필요 (HTTP ${response.status})` }];
  }
  return [{ attackId: 'anonymous_note_read', expected: '비로그인 화면에서 가상 메모를 확인',
    observed: visible ? '비로그인 요청에서 공개 가상 메모 확인 표시가 보임'
      : `비로그인 요청에서 확인 표시가 보이지 않음 (HTTP ${response.status})` }];
}
