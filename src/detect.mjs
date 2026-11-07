// 9단계 입력 처리: 반 엔진이 검증해서 전달한 가상 사건만 사용합니다.
// 사건의 at, method, identity.sub만 읽습니다. 다른 필드와 비밀값은 읽거나 출력하지 않습니다.
export function readDetectionEvents(events) {
  if (!Array.isArray(events)) throw new TypeError('invalid_detection_events');

  const readings = [];
  for (const event of events) {
    if (event === null || typeof event !== 'object' || Array.isArray(event)) {
      throw new TypeError('invalid_detection_event');
    }

    const at = event.at;
    const method = event.method;
    const identity = event.identity;
    const sub = identity !== null && typeof identity === 'object'
      ? identity.sub : undefined;
    const timestamp = typeof at === 'string' ? Date.parse(at) : NaN;

    if (!Number.isFinite(timestamp) || typeof method !== 'string' || !method
        || typeof sub !== 'string' || !sub) {
      throw new TypeError('invalid_detection_event');
    }
    // 원본 event나 identity 객체 전체를 복사하지 않습니다.
    readings.push({ at: timestamp, method, sub });
  }
  return readings;
}

export function detect(events) {
  const readings = readDetectionEvents(events);
  const getTimesBySubject = new Map();

  for (const event of readings) {
    if (event.method !== 'GET') continue;
    let times = getTimesBySubject.get(event.sub);
    if (times === undefined) {
      times = [];
      getTimesBySubject.set(event.sub, times);
    }
    times.push(event.at);
  }

  const windowMilliseconds = 10 * 60 * 1000;
  for (const [subject, times] of getTimesBySubject) {
    times.sort((left, right) => left - right);
    let start = 0;

    for (let end = 0; end < times.length; end += 1) {
      while (times[end] - times[start] > windowMilliseconds) {
        start += 1;
      }
      if (end - start + 1 > 120) {
        return { action: 'propose_revocation', reasonCode: 'burst_read', subject };
      }
    }
  }

  return { action: 'observe' };
}
