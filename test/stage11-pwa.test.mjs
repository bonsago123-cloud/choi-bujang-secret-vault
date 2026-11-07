import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
const r = path => readFileSync(new URL('../'+path, import.meta.url),'utf8');
test('11단계 매니페스트 이름·범위 및 아이콘', () => { const m=JSON.parse(r('public/manifest.webmanifest'));assert.equal(m.name,'BYTE BACK 내 자료실');assert.equal(m.scope,'/');assert.equal(m.display,'standalone');assert.deepEqual(m.icons.map(x=>x.sizes),['192x192','512x512']);for(const n of [192,512])assert.ok(statSync(new URL('../public/icon-'+n+'.png',import.meta.url)).size>500);});
test('기기 상태는 서버 미확인으로 명시하고 설치를 승인으로 보지 않음', () => {const h=r('public/index.html');assert.match(h,/rel="manifest"/);assert.match(h,/기기 승인 상태: 확인되지 않음/);assert.match(h,/설치하거나 로그인해도 기기 승인이 완료되는 것은 아닙니다/);assert.doesNotMatch(h,/기기 승인 완료/);});
test('오프라인 캐시는 정적 안내만, 인증과 API 응답 제외',()=>{const w=r('public/sw.js');assert.match(w,/mode !== 'navigate'/);assert.match(w,/fetch\(req\)/);assert.match(w,/offline.html/);assert.doesNotMatch(w,/cache.put/);assert.doesNotMatch(w,/cache.add\(req/);assert.doesNotMatch(w,/api\//);});
test('이전 서버 정책과 보호 경로 그대로 유지',()=>{const c=JSON.parse(r('aleph.config.json'));assert.equal(c.step,11);assert.equal(c.allowedRoutes.length,4);assert.equal(c.restoreRoute,'POST /api/memos/restore');const h=r('public/index.html');assert.ok(h.includes("fetch('/api/auth?action=session'"));assert.ok(h.includes("memoRequest('/api/memos')"));});
