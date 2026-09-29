// All request validation for the API lives here, deliberately kept out of the
// route handlers and the service. The consequence is that the service trusts
// its input completely, so any in-process caller (a seed script, a future
// worker) can write invalid data straight to the store -- see BUG_REPORT.md.

// The canonical vocabularies. These are the values the code actually accepts;
// note that README.md documents a different set (`pending | in-progress |
// completed`) which matches neither of these nor ASSIGNMENT.md. Reported as
// bug #11 -- spec drift that will break any client written from the README.
const VALID_STATUSES = ['todo', 'in_progress', 'done'];
const VALID_PRIORITIES = ['low', 'medium', 'high'];

// Bound on the free-text assignee name. Arbitrary, but an unbounded free-text
// field on a task is a storage and abuse problem. Exported so the limit is
// stated in one place rather than repeated as a literal.
const MAX_ASSIGNEE_LENGTH = 100;

// Upper bound on how many tasks a single page can return, so one request
// cannot ask the server to serialise the entire store.
const MAX_PAGE_LIMIT = 100;
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;

// Returns an error message string, or null when the body is acceptable. A
// string (rather than throwing) keeps the route handlers to a single `if`.
const validateCreateTask = (body) => {
  if (!body.title || typeof body.title !== 'string' || body.title.trim() === '') {
    return 'title is required and must be a non-empty string';
  }
  // NOTE: the `body.status &&` guard is a truthiness check, so an empty string
  // is treated as "not supplied" and passes validation. Because `create`'s
  // destructuring default only applies to `undefined`, the empty string is then
  // stored, producing a task that no status filter matches and that stats does
  // not count. Reported as bug #7, not fixed. The correct guard is
  // `body.status !== undefined`.
  if (body.status && !VALID_STATUSES.includes(body.status)) {
    return `status must be one of: ${VALID_STATUSES.join(', ')}`;
  }
  if (body.priority && !VALID_PRIORITIES.includes(body.priority)) {
    return `priority must be one of: ${VALID_PRIORITIES.join(', ')}`;
  }
  if (body.dueDate && isNaN(Date.parse(body.dueDate))) {
    return 'dueDate must be a valid ISO date string';
  }
  return null;
};

// Partial update, so an absent title is fine -- but a supplied one must still be
// usable. Same empty-string caveat as above (bug #7).
const validateUpdateTask = (body) => {
  if (body.title !== undefined && (typeof body.title !== 'string' || body.title.trim() === '')) {
    return 'title must be a non-empty string';
  }
  if (body.status && !VALID_STATUSES.includes(body.status)) {
    return `status must be one of: ${VALID_STATUSES.join(', ')}`;
  }
  if (body.priority && !VALID_PRIORITIES.includes(body.priority)) {
    return `priority must be one of: ${VALID_PRIORITIES.join(', ')}`;
  }
  if (body.dueDate && isNaN(Date.parse(body.dueDate))) {
    return 'dueDate must be a valid ISO date string';
  }
  return null;
};

// Validation for PATCH /tasks/:id/assign.
//
// The field must be present: a PATCH with an unrelated body should not
// silently no-op and return 200, because the caller would read that as "the
// assignment worked". `hasOwnProperty` is used rather than a truthiness check
// so that an explicit `null` is distinguishable from an absent key.
//
// null is valid and means "unassign". Non-strings are rejected so that objects
// and arrays are not stored and later serialised as "[object Object]". The name
// is checked for non-blankness after trimming but stored untrimmed, so what
// the caller typed is what is stored rather than being silently rewritten.
const validateAssignTask = (body) => {
  if (!body || !Object.prototype.hasOwnProperty.call(body, 'assignee')) {
    return 'assignee is required';
  }
  if (body.assignee === null) return null;
  if (typeof body.assignee !== 'string') {
    return 'assignee must be a string or null';
  }
  if (body.assignee.trim() === '') {
    return 'assignee must not be empty';
  }
  if (body.assignee.length > MAX_ASSIGNEE_LENGTH) {
    return `assignee must be ${MAX_ASSIGNEE_LENGTH} characters or fewer`;
  }
  return null;
};

const isValidStatus = (status) => VALID_STATUSES.includes(status);

// Validates the `?status=` query filter. Added as part of the bug #3 fix: the
// previous substring matching meant a typo returned either the wrong tasks or a
// plausible-looking empty array, so an unknown status is now a 400.
const validateStatusQuery = (query = {}) => {
  if (query.status === undefined) return null;
  if (!isValidStatus(query.status)) {
    return `status must be one of: ${VALID_STATUSES.join(', ')}`;
  }
  return null;
};

// Accepts only a string of one or more digits. This deliberately rejects
// fractional, negative, zero and non-numeric values, all of which the previous
// `parseInt(page) || 1` silently coerced into a valid-looking page number -- so
// `?page=abc` quietly returned page 1 and `?page=0` quietly returned the
// second page.
const parsePositiveInt = (value) => {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return null;
  return parsed;
};

// Returns either { page, limit } or { error }. Defaults are applied per
// parameter, so `?page=2` alone uses DEFAULT_LIMIT for the limit.
const parsePaginationQuery = (query = {}) => {
  const page = query.page === undefined ? DEFAULT_PAGE : parsePositiveInt(query.page);
  if (page === null) return { error: 'page must be a positive integer' };

  const limit = query.limit === undefined ? DEFAULT_LIMIT : parsePositiveInt(query.limit);
  if (limit === null) return { error: 'limit must be a positive integer' };
  if (limit > MAX_PAGE_LIMIT) return { error: `limit must be ${MAX_PAGE_LIMIT} or fewer` };

  return { page, limit };
};

module.exports = {
  VALID_STATUSES,
  VALID_PRIORITIES,
  MAX_ASSIGNEE_LENGTH,
  MAX_PAGE_LIMIT,
  validateCreateTask,
  validateUpdateTask,
  validateAssignTask,
  validateStatusQuery,
  parsePaginationQuery,
};
