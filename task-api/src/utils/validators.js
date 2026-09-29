const VALID_STATUSES = ['todo', 'in_progress', 'done'];
const VALID_PRIORITIES = ['low', 'medium', 'high'];
const MAX_ASSIGNEE_LENGTH = 100;
const MAX_PAGE_LIMIT = 100;
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;

const validateCreateTask = (body) => {
  if (!body.title || typeof body.title !== 'string' || body.title.trim() === '') {
    return 'title is required and must be a non-empty string';
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

const validateStatusQuery = (query = {}) => {
  if (query.status === undefined) return null;
  if (!isValidStatus(query.status)) {
    return `status must be one of: ${VALID_STATUSES.join(', ')}`;
  }
  return null;
};

const parsePositiveInt = (value) => {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return null;
  return parsed;
};

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
