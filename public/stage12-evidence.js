// Stage 12 second task: client-observed, read-only GET evidence only.
// These are CURRENT regression probes, not proof of historical 1~11 stage execution.
// Never read response bodies or collect cookies, tokens, memo contents or identifiers.
const define = (stage, kind, title, request, expectedHTTP, credentialMode, why = '') =>
  Object.freeze({ caseId: 'S' + String(stage).padStart(2, '0') + '-' + (kind === 'normal' ? 'N' : 'D'),
    stage, kind, title, request, expectedHTTP, credentialMode, why });
export const EVIDENCE_CASES = Object.freeze([
  define(1, 'normal', '현행 공개 배포 식별', 'GET /aleph.json', 200, 'omit'),
  define(1, 'forbidden', '현행 공개 메모 파일 차단', 'GET /data.json', 404, 'omit'),
  define(2, 'normal', '현행 서버 경유 실습 메모 조회', 'GET /api/notes', 200, 'include'),
  define(2, 'forbidden', '현행 익명 실습 메모 조회 차단', 'GET /api/notes', 401, 'omit'),
  define(3, 'normal', '현행 개인 메모 목록 조회', 'GET /api/memos', 200, 'include'),
  define(3, 'forbidden', '현행 익명 개인 메모 목록 차단', 'GET /api/memos', 401, 'omit'),
  define(4, 'normal', '현행 소유자별 목록 조회', 'GET /api/memos', 200, 'include'),
  define(4, 'forbidden', '타인 메모 개별 조회 차단', 'GET /api/memos/:id', null, null, '다른 소유자의 실제 자료 ID를 자동 수집하지 않음'),
  define(5, 'normal', '현행 서버 경유 본인 실습 메모', 'GET /api/notes', 200, 'include'),
  define(5, 'forbidden', '원본 Supabase REST 익명 직통 차단', 'GET <originalApiUrl>', null, null, '원본 DB 직통 시험은 별도 공식 증거 필요'),
  define(6, 'normal', '판정기 등록 기기 허용', 'decide(등록 기기)', null, null, '보안 엔진의 가상 요청이며 실제 HTTP API 아님'),
  define(6, 'forbidden', '판정기 미등록 기기 거부', 'decide(미등록 기기)', null, null, '실제 엔진의 검증된 요청 이벤트 없음'),
  define(7, 'normal', '판정기 일반 접속 허용', 'decide(정상 신호)', null, null, '실제 엔진 이벤트 미수집'),
  define(7, 'forbidden', '복합 이상 접속 추가 확인', 'decide(복합 위험 신호)', null, null, '실제 step-up 운영 실행 미연결'),
  define(8, 'normal', '허용된 메모 경로 조회', 'GET /api/memos/:id', null, null, '승인된 본인 메모 ID를 별도 안전하게 정해야 함'),
  define(8, 'forbidden', '금지된 자원 구역 거부', 'decide(미허용 경로)', null, null, '실제 심판 엔진 거부 결과 미수집'),
  define(9, 'normal', '평상시 조회 사건 관찰', 'detect(일반 사건)', null, null, '탐지 엔진 운영 사건 미연결'),
  define(9, 'forbidden', '폭주 조회 권한 회수 제안', 'detect(대량 사건)', null, null, '탐지 엔진 운영 사건 및 실제 회수 미연결'),
  define(10, 'normal', '백업에서 정상 복원', 'POST /api/memos/restore', null, null, '운영 DB를 변경할 수 있어 자동 실행하지 않음'),
  define(10, 'forbidden', '타인 복원 요청 거부', 'POST /api/memos/restore', null, null, '타 계정·변경 요청 시험 미실행'),
  define(11, 'normal', '승인 기기의 보호 작전실 조회', 'GET /api/operations', 200, 'include'),
  define(11, 'forbidden', '비로그인 보호 작전실 접근 거부', 'GET /api/operations', 401, 'omit'),
]);
export const OFFICIAL_41_STATUS = Object.freeze({casesMentioned:41, result:'not_assessed', measuredCases:null});

export function emptyEvidenceRows() {
  return EVIDENCE_CASES.map(item => ({...item,actualHTTP:null,requestId:null,checkedAt:null,
    serverDate:null,result:'not_executed',source:'none'}));
}
export async function measureEvidence({fetcher, idFactory, clock, stillValid = () => true} = {}) {
  if (typeof fetcher !== 'function' || typeof idFactory !== 'function' || typeof clock !== 'function')
    throw new TypeError('invalid_evidence_measurement_dependencies');
  const rows = [];
  for (const item of EVIDENCE_CASES) {
    const row = {...item,actualHTTP:null,requestId:null,checkedAt:null,serverDate:null,
      result:'not_executed',source:'none'};
    if (item.expectedHTTP === null || item.credentialMode === null || !stillValid()) {
      rows.push(row);
      continue;
    }
    row.requestId = idFactory(); // Browser-created probe ID; NOT a server-issued ID.
    try {
      const url = item.request.slice(4); // Only fixed relative GET paths from this manifest.
      if (!/^\/(?!\/)[A-Za-z0-9/?._=-]+$/u.test(url)) throw new Error('invalid_probe_path');
      const response = await fetcher(url, {
        method:'GET', credentials:item.credentialMode === 'include' ? 'same-origin' : 'omit',
        cache:'no-store', redirect:'manual',
      });
      row.checkedAt = clock().toISOString(); // Browser clock after actual response.
      if (!Number.isInteger(response?.status) || response.status < 100 || response.status > 599) {
        row.result = 'transport_error';
      } else {
        row.actualHTTP = response.status;
        row.serverDate = response.headers?.get?.('date') || null;
        row.source = 'http_response';
        row.result = response.status === item.expectedHTTP ? 'measured_match' : 'measured_mismatch';
      }
      // Deliberately never call response.text(), json() or arrayBuffer().
    } catch {
      row.checkedAt = clock().toISOString();
      row.result = 'transport_error';
    }
    rows.push(row);
  }
  return rows;
}
export function evidenceCounts(rows) {
  if (!Array.isArray(rows) || rows.length !== EVIDENCE_CASES.length)
    throw new TypeError('invalid_evidence_rows');
  const matching = rows.filter(r => r.result === 'measured_match' && r.source === 'http_response');
  const normal = matching.filter(r => r.kind === 'normal').length;
  const forbidden = matching.filter(r => r.kind === 'forbidden').length;
  const mismatch = rows.filter(r => r.result === 'measured_mismatch').length;
  const unexecuted = rows.filter(r => r.result === 'not_executed').length;
  const errors = rows.filter(r => r.result === 'transport_error').length;
  return {normal,forbidden,mismatch,unexecuted,errors,
    bothMeasured:normal > 0 && forbidden > 0};
}
export function evidenceExport(rows, time) {
  const counts = evidenceCounts(rows);
  if (!counts.bothMeasured) throw new Error('normal_and_forbidden_measurements_required');
  return {
    schema:'aleph.stage12.http-evidence.v1',
    generatedAt:time,
    collection:'browser_observed_HTTP_only',
    idSource:'client_generated_not_server_correlation',
    timeSource:'browser_clock_after_response',
    official41:OFFICIAL_41_STATUS,
    counts,
    cases:rows,
  };
}
