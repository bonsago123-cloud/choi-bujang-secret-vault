import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { deploymentIdentity } from './deployment-identity.mjs';

const root = resolve(import.meta.dirname, '..');
const config = JSON.parse(await readFile(resolve(root, 'aleph.config.json'), 'utf8'));
if (!Number.isInteger(config.step) || config.step < 2 || config.step > 12) {
  throw new Error('현재 빌드는 방어전 2단계 이후 설정이 필요합니다.');
}
const source = JSON.parse(await readFile(resolve(root, 'data.json'), 'utf8'));
if (!Array.isArray(source.notes) || source.notes.length !== 0) {
  throw new Error('공개 GitHub data.json에 메모 본문을 넣지 마세요.');
}
if (source.sampleMarker !== config.sampleMarker) throw new Error('자료 확인 표시 불일치');
await mkdir(resolve(root, 'public'), { recursive: true });
// Never publish the old static endpoint, including on builds from older checkouts.
await rm(resolve(root, 'public/data.json'), { force: true });
console.log('2단계 이후: 공개 data.json 생성 중단 및 기존 파일 제거 완료.');
if (!process.argv.includes('--local')) {
  const identity = deploymentIdentity(process.env, config);
  await writeFile(resolve(root, 'public/aleph.json'), `${JSON.stringify(identity, null, 2)}\n`, 'utf8');
}
