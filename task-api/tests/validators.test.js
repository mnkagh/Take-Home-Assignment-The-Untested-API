const {
  VALID_STATUSES,
  VALID_PRIORITIES,
  MAX_ASSIGNEE_LENGTH,
  MAX_PAGE_LIMIT,
  validateCreateTask,
  validateUpdateTask,
  validateAssignTask,
  validateStatusQuery,
  parsePaginationQuery,
} = require('../src/utils/validators');

describe('validateCreateTask', () => {
  it('accepts a minimal valid body', () => {
    expect(validateCreateTask({ title: 'Write tests' })).toBeNull();
  });

  it('accepts every valid status and priority', () => {
    for (const status of VALID_STATUSES) {
      expect(validateCreateTask({ title: 'x', status })).toBeNull();
    }
    for (const priority of VALID_PRIORITIES) {
      expect(validateCreateTask({ title: 'x', priority })).toBeNull();
    }
  });

  it('rejects a missing title', () => {
    expect(validateCreateTask({})).toMatch(/title is required/);
  });

  it('rejects a non-string title', () => {
    expect(validateCreateTask({ title: 42 })).toMatch(/title is required/);
    expect(validateCreateTask({ title: { name: 'x' } })).toMatch(/title is required/);
  });

  it('rejects a whitespace-only title', () => {
    expect(validateCreateTask({ title: '   ' })).toMatch(/title is required/);
  });

  it('rejects an unknown status', () => {
    expect(validateCreateTask({ title: 'x', status: 'pending' })).toMatch(/status must be one of/);
  });

  it('rejects an unknown priority', () => {
    expect(validateCreateTask({ title: 'x', priority: 'urgent' })).toMatch(/priority must be one of/);
  });

  it('rejects an unparseable dueDate', () => {
    expect(validateCreateTask({ title: 'x', dueDate: 'not-a-date' })).toMatch(/valid ISO date/);
  });

  it('accepts a valid dueDate and a null dueDate', () => {
    expect(validateCreateTask({ title: 'x', dueDate: '2026-01-01T00:00:00.000Z' })).toBeNull();
    expect(validateCreateTask({ title: 'x', dueDate: null })).toBeNull();
  });
});

describe('validateUpdateTask', () => {
  it('accepts an empty body (partial update of nothing)', () => {
    expect(validateUpdateTask({})).toBeNull();
  });

  it('rejects a blank title when one is supplied', () => {
    expect(validateUpdateTask({ title: '' })).toMatch(/title must be a non-empty string/);
    expect(validateUpdateTask({ title: '  ' })).toMatch(/title must be a non-empty string/);
    expect(validateUpdateTask({ title: 7 })).toMatch(/title must be a non-empty string/);
  });

  it('rejects an unknown status', () => {
    expect(validateUpdateTask({ status: 'archived' })).toMatch(/status must be one of/);
  });

  it('rejects an unknown priority', () => {
    expect(validateUpdateTask({ priority: 'urgent' })).toMatch(/priority must be one of/);
  });

  it('rejects an unparseable dueDate', () => {
    expect(validateUpdateTask({ dueDate: 'tomorrow-ish' })).toMatch(/valid ISO date/);
  });

  it('returns the first error it finds', () => {
    expect(validateUpdateTask({ title: '', status: 'nope' })).toMatch(/title/);
  });
});

describe('validateAssignTask', () => {
  it('accepts a name', () => {
    expect(validateAssignTask({ assignee: 'Ada Lovelace' })).toBeNull();
  });

  it('accepts null to unassign', () => {
    expect(validateAssignTask({ assignee: null })).toBeNull();
  });

  it('rejects a missing assignee field', () => {
    expect(validateAssignTask({})).toMatch(/assignee is required/);
  });

  it('rejects a missing body', () => {
    expect(validateAssignTask(undefined)).toMatch(/assignee is required/);
  });

  it('rejects an empty or whitespace-only name', () => {
    expect(validateAssignTask({ assignee: '' })).toMatch(/must not be empty/);
    expect(validateAssignTask({ assignee: '   ' })).toMatch(/must not be empty/);
  });

  it('rejects a non-string, non-null value', () => {
    expect(validateAssignTask({ assignee: 42 })).toMatch(/string or null/);
    expect(validateAssignTask({ assignee: ['Ada'] })).toMatch(/string or null/);
    expect(validateAssignTask({ assignee: true })).toMatch(/string or null/);
  });

  it('rejects an absurdly long name', () => {
    expect(validateAssignTask({ assignee: 'a'.repeat(MAX_ASSIGNEE_LENGTH + 1) })).toMatch(
      /characters or fewer/
    );
    expect(validateAssignTask({ assignee: 'a'.repeat(MAX_ASSIGNEE_LENGTH) })).toBeNull();
  });
});

describe('validateStatusQuery', () => {
  it('passes when no status is supplied', () => {
    expect(validateStatusQuery({})).toBeNull();
    expect(validateStatusQuery()).toBeNull();
  });

  it('passes for a valid status', () => {
    for (const status of VALID_STATUSES) {
      expect(validateStatusQuery({ status })).toBeNull();
    }
  });

  it('rejects an unknown status so typos are not silently ignored', () => {
    expect(validateStatusQuery({ status: 'do' })).toMatch(/status must be one of/);
    expect(validateStatusQuery({ status: 'pending' })).toMatch(/status must be one of/);
    expect(validateStatusQuery({ status: '' })).toMatch(/status must be one of/);
  });
});

describe('parsePaginationQuery', () => {
  it('defaults to page 1, limit 10', () => {
    expect(parsePaginationQuery({})).toEqual({ page: 1, limit: 10 });
  });

  it('parses valid values', () => {
    expect(parsePaginationQuery({ page: '2', limit: '25' })).toEqual({ page: 2, limit: 25 });
  });

  it('rejects non-numeric values', () => {
    expect(parsePaginationQuery({ page: 'abc' }).error).toMatch(/page must be a positive integer/);
    expect(parsePaginationQuery({ limit: 'ten' }).error).toMatch(/limit must be a positive integer/);
    expect(parsePaginationQuery({ page: '' }).error).toMatch(/page must be a positive integer/);
  });

  it('rejects zero, negative and fractional values', () => {
    expect(parsePaginationQuery({ page: '0' }).error).toMatch(/page must be a positive integer/);
    expect(parsePaginationQuery({ page: '-1' }).error).toMatch(/page must be a positive integer/);
    expect(parsePaginationQuery({ limit: '0' }).error).toMatch(/limit must be a positive integer/);
    expect(parsePaginationQuery({ limit: '-5' }).error).toMatch(/limit must be a positive integer/);
    expect(parsePaginationQuery({ page: '1.5' }).error).toMatch(/page must be a positive integer/);
  });

  it('caps the limit', () => {
    expect(parsePaginationQuery({ limit: String(MAX_PAGE_LIMIT) })).toEqual({
      page: 1,
      limit: MAX_PAGE_LIMIT,
    });
    expect(parsePaginationQuery({ limit: String(MAX_PAGE_LIMIT + 1) }).error).toMatch(/or fewer/);
  });
});
