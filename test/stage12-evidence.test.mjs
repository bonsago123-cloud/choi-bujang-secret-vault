import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EVIDENCE_CASES, OFFICIAL_41_STATUS, emptyEvidenceRows,
  measureEvidence, evidenceCounts, evidenceExport } from '../public/stage12-evidence.js';

const clock = () => new Date('2026-11-08T05:04:03.000Z');
const idFactory = (() => {let i=0;return()=> 'test-probe-' + String(++i);})();
test('1~11단계 정상·금지 행 22개, 실측 전 값은 전부 미실행이며 41종 통과로 둔갑하지 않음', () => {
  const rows = emptyEvidenceRows();
  assert.equal(EVIDENCE_CASES.length,22);
  assert.deepEqual([...new Set(rows.map(x=>x.stage))], [1,2,3,4,5,6,7,8,9,10,11]);
  for (let stage=1;stage<=11;stage++) {
    assert.equal(rows.filter(x=>x.stage===stage&&x.kind==='normal').length,1);
    assert.equal(rows.filter(x=>x.stage===stage&&x.kind==='forbidden').length,1);
  }
  assert.ok(rows.every(r => r.actualHTTP===null && r.requestId===null && r.checkedAt===null && r.result==='not_executed'));
  assert.deepEqual(OFFICIAL_41_STATUS,{casesMentioned:41,result:'not_assessed',measuredCases:null});
  assert.equal(evidenceCounts(rows).bothMeasured,false);
  assert.throws(() => evidenceExport(rows,clock().toISOString()),/normal_and_forbidden/);
});
test('모의 fetch 응답의 HTTP 상태 코드만 측정하고 실측 구조와 41종 미검증을 확인', async () => {
  const calls=[];
  const fetcher=async (url,options) => {
    calls.push({url,options});
    return {status:options.credentials==='omit' && url!=='/aleph.json' ? (url==='/data.json'?404:401) : 200,
      headers:{get:k=> k==='date'?'Sun, 08 Nov 2026 05:04:03 GMT':null},
      json(){throw Error('response body read forbidden');},
      text(){throw Error('response body read forbidden');}};
  };
  const rows=await measureEvidence({fetcher,clock,idFactory});
  const counts=evidenceCounts(rows);
  assert.equal(calls.length,10);
  assert.ok(calls.every(c=>c.options.method==='GET'&&c.options.cache==='no-store'&&c.options.redirect==='manual' && !('body' in c.options)));
  assert.equal(counts.normal,6);
  assert.equal(counts.forbidden,4);
  assert.equal(counts.mismatch,0);
  assert.equal(counts.unexecuted,12);
  assert.equal(counts.bothMeasured,true);
  const out=evidenceExport(rows,clock().toISOString());
  assert.equal(out.official41.result,'not_assessed');
  assert.ok(rows.filter(r=>r.source==='http_response').every(r=> r.requestId&&r.checkedAt&&r.serverDate));
  assert.ok(rows.filter(r=>r.result==='not_executed').every(r=>r.actualHTTP===null&&r.requestId===null));
  assert.ok(!/password|token|cookie|body|content|owner_id|email/i.test(JSON.stringify(out)));
});
test('실제 HTTP 불일치·네트워크 오류는 통과 처리하지 않음',async()=>{
  const rows=await measureEvidence({clock,idFactory,fetcher:async (url,opts)=>{
    if (url==='/api/operations') throw Error('offline');
    return {status:500,headers:{get:()=>null}};
  }});
  const c=evidenceCounts(rows);
  assert.equal(c.normal,0);
  assert.equal(c.forbidden,0);
  assert.equal(c.bothMeasured,false);
  assert.ok(c.errors>=2);
  assert.ok(c.mismatch>=1);
  assert.throws(()=>evidenceExport(rows,clock().toISOString()),/normal_and_forbidden/);
});
test('기존 자료실 보호와 작전실 동작을 유지하고 evidence는 인증 구역 안에만 배치',()=>{
  const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  const ops=html.indexOf('id="operations-section" hidden');
  const evidence=html.indexOf('id="stage12-evidence"');
  const endOps=html.indexOf('id="legacy-notes-title"');
  assert.ok(ops>=0&&evidence>ops&&endOps>evidence);
  assert.match(html,/loadOperations\(true\)/);
  assert.match(html,/hideOperations\(\)/);
  assert.match(html,/measureEvidence\(/);
  assert.doesNotMatch(html,/localStorage|sessionStorage|indexedDB/u);
  assert.equal(JSON.parse(readFileSync(new URL('../aleph.config.json',import.meta.url))).step,12);
});
