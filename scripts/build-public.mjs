import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { deploymentIdentity } from './deployment-identity.mjs';

const root = resolve(import.meta.dirname, '..');
const config = JSON.parse(await readFile(resolve(root, 'aleph.config.json'), 'utf8'));
if (config.step !== 2) throw new Error('현재 빌드는 방어전 2단계용입니다.');
const source = JSON.parse(await readFile(resolve(root, 'data.json'), 'utf8'));
if (!Array.isArray(source.notes) || source.notes.length !== 0) {
  throw new Error('2단계: GitHub data.json에 메모 본문을 넣지 마세요.');
}
if (source.sampleMarker !== config.sampleMarker) throw new Error('자료 확인 표시 불일치');
await mkdir(resolve(root, 'public'), { recursive: true });
await writeFile(resolve(root, 'public/data.json'),
  `${JSON.stringify({sampleMarker: config.sampleMarker, notes: []}, null, 2)}\n`, 'utf8');
console.log('2단계: 공개 메모 복사를 중단하고 빈 목록을 생성했습니다.');
if (!process.argv.includes('--local')) {
  const identity = deploymentIdentity(process.env, config);
  await writeFile(resolve(root, 'public/aleph.json'), `${JSON.stringify(identity, null, 2)}\n`, 'utf8');
}
