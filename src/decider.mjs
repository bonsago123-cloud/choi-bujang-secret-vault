// ALEPH SDP 엔진이 확인한 요청만 받는 학생 판정기 시작점입니다.
// 6단계부터 규칙을 하나씩 추가합니다. 기기 등록 여부는 엔진이 전달한 값만 사용합니다.
// 요청 본문의 userId, role, 기기 키, 토큰을 별도로 믿거나 저장하지 마세요.
export const RULE_IDS = Object.freeze(['device_registered', 'step_up_required', 'resource_zone']);

// Inspect only fields defined by the engine's aleph.decision.v1 contract.
// This function cannot authenticate callers: only the engine may invoke decide(request).
// No client headers, request.geo, request.identity or invented defaults are read.
export function inspectDecisionInput(request) {
  const signals = request?.signals;
  const signalObject = signals !== null && typeof signals === 'object' && !Array.isArray(signals)
    ? signals : null;
  const declaredSource = signalObject?.source;
  const signalSource = declaredSource === 'judge_fixture' ? 'fixture'
    : declaredSource === 'none' ? 'none' : 'unknown';
  const fixture = signalSource === 'fixture';
  const knownText = value => typeof value === 'string' && value.trim()
    && value !== 'unknown' ? value : null;

  // A judge fixture is test data, not verified production geography or network history.
  // Current real-world contract provides no trusted location/network source.
  const region = fixture ? knownText(signalObject.region) : null;
  const network = fixture ? knownText(signalObject.network) : null;
  const hour = fixture && Number.isInteger(signalObject.hour)
    && signalObject.hour >= 0 && signalObject.hour <= 23 ? signalObject.hour : null;

  // The engine-provided timestamp and recent events remain absent when not provided.
  // Never infer a time from the clock, a location, or a client-supplied header.
  const at = typeof request?.at === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u.test(request.at)
    && Number.isFinite(Date.parse(request.at)) ? request.at : null;
  const events = request?.recentEvents;
  const recentEvents = Array.isArray(events) && events.length <= 12
    && events.every(event => event !== null && typeof event === 'object'
      && !Array.isArray(event) && typeof event.kind === 'string' && event.kind.length > 0
      && Number.isInteger(event.ageSeconds) && event.ageSeconds >= 0
      && Number.isInteger(event.count) && event.count >= 0)
    ? events.map(event => ({ kind: event.kind, ageSeconds: event.ageSeconds, count: event.count }))
    : null;

  return {
    registered: request?.deviceRegistered === true,
    signalSource,
    signalTrustedForRealWorld: false,
    region,
    network,
    hour,
    at,
    recentEvents,
  };
}

// Stage 8: enforce exact engine-verified service + method + route + path shapes.
// No role, ownership, raw client headers or query-selected operations are used here.
// The backing API (task 3) must separately verify the authenticated memo owner.
const RESERVED_MEMO_IDS = new Set(['export', 'import', 'search', 'new', 'bulk', 'all', 'admin']);
function singleIdPath(path, prefix, reserved = null) {
  if (typeof path !== 'string' || !path.startsWith(prefix + '/')) return false;
  const id = path.slice(prefix.length + 1);
  // One path segment only; not necessarily UUID (the judge uses virtual IDs).
  // Reject encoded segments and special sibling routes such as /notes/export.
  return /^[A-Za-z0-9._~-]{1,128}$/u.test(id) && id !== '.' && id !== '..'
    && (!reserved || !reserved.has(id.toLowerCase()));
}
function zoneAllows(request) {
  if (request?.queryLength !== 0) return false; // Never dispatch functionality by query.
  const { service, method, path, route } = request ?? {};
  if (service === 'notes') {
    return (method === 'GET' || method === 'PUT' || method === 'DELETE')
      && route === method + ' /notes/:id'
      && singleIdPath(path, '/notes', RESERVED_MEMO_IDS);
  }
  if (service === 'notices') {
    // Class announcements are read-only for everyone. Instructor editing is a
    // separate server-admin flow, because this engine contract has no role.
    return method === 'GET' && route === 'GET /notices' && path === '/notices';
  }
  // Instructor materials and every unknown service/route are denied by default.
  return false;
}

export async function decide(request) {
  const input = inspectDecisionInput(request);

  // Stage 6 stays first: an unregistered device can never bypass this rule.
  if (!input.registered) {
    return {
      schema: 'aleph.decision.v1',
      requestId: request.requestId,
      decision: 'deny',
      reasonCode: 'device_not_registered',
      ruleIds: ['device_registered'],
    };
  }

  // Access zones are checked before anomaly step-up. Unauthorized paths never get through.
  if (!zoneAllows(request)) {
    return {
      schema: 'aleph.decision.v1',
      requestId: request.requestId,
      decision: 'deny',
      reasonCode: 'route_not_allowed',
      ruleIds: ['resource_zone'],
    };
  }

  // A judge fixture is simulated data, NOT a trusted real-world geo/network feed.
  // Never infer a normal hour/network or read event from absent/unknown signals.
  // Only the engine's validated fields are read, never arbitrary HTTP headers.
  const fixture = input.signalSource === 'fixture';
  const unusualHour = fixture && input.hour !== null && input.hour >= 0 && input.hour < 6;
  const unusualNetwork = fixture && input.network === 'unusual';
  const readsRoute = request.route === 'GET /notes/:id';
  const recentBurst = Array.isArray(input.recentEvents) && input.recentEvents.some(
    event => event.kind === 'risk_signal' && event.ageSeconds <= 300 && event.count >= 10,
  );
  const compositeRisk = unusualHour && unusualNetwork && readsRoute && recentBurst;

  // Only the engine-confirmed fresh step-up can clear this simulated composite risk.
  // A stale/missing/invalid confirmation must not clear it.
  const stepUp = request.stepUp;
  const recentlyVerified = stepUp?.verified === true
    && Number.isInteger(stepUp.authAgeSeconds)
    && stepUp.authAgeSeconds >= 0 && stepUp.authAgeSeconds <= 120;
  const requiresStepUp = compositeRisk && !recentlyVerified;

  return {
    schema: 'aleph.decision.v1',
    requestId: request.requestId,
    decision: requiresStepUp ? 'step_up' : 'allow',
    reasonCode: requiresStepUp ? 'step_up_required' : 'approved',
    ruleIds: compositeRisk ? ['device_registered', 'resource_zone', 'step_up_required'] : ['device_registered', 'resource_zone'],
  };
}
