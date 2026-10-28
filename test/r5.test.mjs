import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deploymentIdentity } from '../scripts/deployment-identity.mjs';
import { runAttackChecks } from '../src/attack-check.mjs';

const config = {
  step: 1,
  judgeIssuer: 'https://aleph-judge-production.up.railway.app/defense/judge',
  sampleMarker: 'SAMPLE_NOTE_1',
  publicAppUrl: 'https://student-defense.vercel.app',
};
const env = {
  VERCEL_GIT_PROVIDER: 'github',
  VERCEL_GIT_REPO_OWNER: 'Student-A',
  VERCEL_GIT_REPO_SLUG: 'aleph-defense',
  VERCEL_GIT_COMMIT_SHA: 'a'.repeat(40),
  VERCEL_URL: 'student-defense-123.vercel.app',
};

test('build identity uses Vercel Git and deployment metadata for step 2 and later', () => {
  for (const step of [2, 3, 12]) {
    const configAtStep = { ...config, step };
    assert.deepEqual(deploymentIdentity(env, configAtStep), {
      schema: 'aleph.defense.deployment.v1',
      step,
      repoUrl: 'https://github.com/student-a/aleph-defense',
      commit: 'a'.repeat(40),
      publicAppUrl: 'https://student-defense-123.vercel.app',
      judgeIssuer: configAtStep.judgeIssuer,
      sampleMarker: configAtStep.sampleMarker,
    });
  }
  assert.throws(() => deploymentIdentity(env, config));
  assert.throws(() => deploymentIdentity({ ...env, VERCEL_GIT_PROVIDER: undefined }, { ...config, step: 2 }));
  assert.throws(() => deploymentIdentity({ ...env, VERCEL_GIT_COMMIT_SHA: 'short' }, { ...config, step: 2 }));
});

test('first attack check reads public data.json without credentials', async () => {
  const originalFetch = globalThis.fetch;
  let requestUrl;
  let options;
  try {
    globalThis.fetch = async (url, init) => {
      requestUrl = String(url);
      options = init;
      return new Response(JSON.stringify({ sampleMarker: 'SAMPLE_NOTE_1', notes: [{ title: '가상' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    const [result] = await runAttackChecks(config);
    assert.equal(requestUrl, 'https://student-defense.vercel.app/data.json');
    assert.equal(options.redirect, 'error');
    assert.match(result.observed, /확인 표시가 보임/u);
    globalThis.fetch = async () => new Response('<html>not the data</html>', { status: 200 });
    const [failed] = await runAttackChecks(config);
    assert.match(failed.observed, /보이지 않음/u);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('second attack check accepts missing public data.json, but not exposed notes', async () => {
  const originalFetch = globalThis.fetch;
  const stage2 = { ...config, step: 2 };
  try {
    globalThis.fetch = async () => new Response('Not Found', { status: 404 });
    const [missing] = await runAttackChecks(stage2);
    assert.match(missing.observed, /없거나 빈 목록/u);

    globalThis.fetch = async () => new Response(JSON.stringify({ sampleMarker: 'SAMPLE_NOTE_1', notes: [{ title: '가상' }] }), { status: 200 });
    const [exposed] = await runAttackChecks(stage2);
    assert.match(exposed.observed, /확인 필요/u);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
