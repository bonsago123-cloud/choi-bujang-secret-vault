import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runAttackChecks } from '../src/attack-check.mjs';

test('stage 4 self-check reports real anonymous response codes only', async () => {
  const previous = globalThis.fetch;
  const calls = [];
  try {
    globalThis.fetch = async (url) => {
      calls.push(new URL(url).pathname);
      return { status: 401 };
    };
    const actual = await runAttackChecks({
      step: 4,
      publicAppUrl: 'https://example.vercel.app',
    });
    assert.deepEqual(calls.sort(), ['/api/memos', '/api/notes']);
    assert.equal(actual.length, 1);
    assert.equal(actual[0].attackId, 'anonymous_note_read');
    assert.match(actual[0].observed, /401/);
    assert.doesNotMatch(actual[0].observed, /A\/B|교차|권한 검증 완료/u);
  } finally {
    globalThis.fetch = previous;
  }
});
