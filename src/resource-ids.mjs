// Stable, server-owned identifiers; never accept an X-Resource-ID supplied by a client.
// A resource ID labels a target; it is not proof of authorization.
export const RESOURCE_IDS = Object.freeze({
  personalMemos: 'personal_memo:collection',
  studyNotes: 'study_note:collection',
  instructorNotices: 'instructor_notice:collection',
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
export function memoResourceId(id) {
  if (typeof id !== 'string' || !UUID.test(id)) return RESOURCE_IDS.personalMemos;
  return `personal_memo:${id.toLowerCase()}`;
}
