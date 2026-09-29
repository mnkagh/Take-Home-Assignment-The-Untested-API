const { v4: uuidv4 } = require('uuid');

// The store is a module-level array rather than a property on an object so that
// the module's exported functions are the only way to reach it. It is in-memory
// and process-local: it is lost on restart and is not shared between processes,
// so it cannot be scaled past a single instance. See BUG_REPORT.md.
let tasks = [];

// Returns a shallow copy of the list, so callers cannot reorder or remove tasks
// through it. NOTE: the task objects themselves are shared references, so a
// caller can still mutate the store via getAll()[0].title = '...'. Reported as
// bug #8; not fixed, because deep-cloning every read is a real cost for a store
// that will be replaced anyway.
const getAll = () => [...tasks];

const findById = (id) => tasks.find((t) => t.id === id);

// Exact match on purpose. This previously used `t.status.includes(status)`,
// which is a substring match, so `?status=do` returned 'done' AND 'todo' tasks
// and `?status=progress` returned 'in_progress' tasks. Any client that lets a
// user type a status filter got plausible-looking wrong data instead of an
// error. Fixed as bug #3; the route now also rejects an unknown status with a
// 400 so a typo cannot be mistaken for "no matching tasks".
const getByStatus = (status) => tasks.filter((t) => t.status === status);

// Page numbers are 1-based, so the first page starts at offset 0.
// This previously computed `page * limit`, which made `page=1` return tasks
// 2..limit+1 and left the first `limit` tasks unreachable through pagination.
// Fixed as bug #1. The route validates and bounds `page`/`limit` before calling
// this, so callers here can assume positive integers.
const getPaginated = (page, limit) => {
  const offset = (page - 1) * limit;
  return tasks.slice(offset, offset + limit);
};

// Counts per status plus the number of unfinished tasks whose due date has
// passed. A completed task is never overdue even if its due date is in the
// past, which is why the two conditions are combined with &&.
const getStats = () => {
  const now = new Date();
  const counts = { todo: 0, in_progress: 0, done: 0 };
  let overdue = 0;

  tasks.forEach((t) => {
    if (counts[t.status] !== undefined) counts[t.status]++;
    if (t.dueDate && t.status !== 'done' && new Date(t.dueDate) < now) {
      overdue++;
    }
  });

  return { ...counts, overdue };
};

// `assignee`/`assignedAt` are initialised to null here rather than being left
// off the object, so the fields are always present in an API response and a
// client never has to distinguish "never assigned" from "field not implemented".
// Note the destructuring defaults only apply to `undefined`, not to `""` -- see
// bug #7 for what happens when a caller sends an empty string.
const create = ({ title, description = '', status = 'todo', priority = 'medium', dueDate = null }) => {
  const task = {
    id: uuidv4(),
    title,
    description,
    status,
    priority,
    dueDate,
    completedAt: null,
    createdAt: new Date().toISOString(),
    assignee: null,
    assignedAt: null,
  };
  tasks.push(task);
  return task;
};

// Merges `fields` over the stored task. This is a PATCH-style partial update
// despite being exposed as PUT -- flagged as an open question in NOTES.md.
//
// SECURITY: the merge is unfiltered, so any key in the request body is written,
// including server-owned ones. `{"id": "hijacked"}` rewrites the task's primary
// key and `{"completedAt": "..."}` forges a completion time. Reported as bug #5,
// not fixed, because the fix (an allow-list of editable fields) is a deliberate
// API change rather than a bug fix. Do not treat this function as safe for
// untrusted input until that is addressed.
const update = (id, fields) => {
  const index = tasks.findIndex((t) => t.id === id);
  if (index === -1) return null;

  const updated = { ...tasks[index], ...fields };
  tasks[index] = updated;
  return updated;
};

const remove = (id) => {
  const index = tasks.findIndex((t) => t.id === id);
  if (index === -1) return false;

  tasks.splice(index, 1);
  return true;
};

// Completing a task changes only the status and stamps the completion time.
//
// This previously also hardcoded `priority: 'medium'`, which silently demoted
// every completed task with no way to recover the original value. Fixed as
// bug #2. The early return makes the operation idempotent, so a retried request
// or a double-click no longer overwrites the original completedAt.
const completeTask = (id) => {
  const task = findById(id);
  if (!task) return null;
  if (task.status === 'done') return task;

  const updated = {
    ...task,
    status: 'done',
    completedAt: new Date().toISOString(),
  };

  const index = tasks.findIndex((t) => t.id === id);
  tasks[index] = updated;
  return updated;
};

// Assigns a task to a person, or clears the assignee when given null.
//
// Design decisions (full rationale in NOTES.md):
//   - Reassignment is allowed and is last-write-wins, rather than a 409
//     conflict. That makes the endpoint idempotent, so a retried request after
//     a dropped response cannot fail.
//   - `null` means "nobody is on this", so there is no separate unassign
//     endpoint and no sentinel value in a field typed as a name.
//   - Input validation lives in validateAssignTask, not here, so the service
//     stays free of HTTP-shaped concerns. Note that `update` above can still
//     write `assignee` without going through those rules (bug #5).
const assign = (id, assignee) => {
  const index = tasks.findIndex((t) => t.id === id);
  if (index === -1) return null;

  const updated = {
    ...tasks[index],
    assignee,
    assignedAt: assignee === null ? null : new Date().toISOString(),
  };
  tasks[index] = updated;
  return updated;
};

// Test-only hook. Exists so the integration tests can start each test from a
// known empty store without sharing state across suites.
const _reset = () => {
  tasks = [];
};

module.exports = {
  getAll,
  findById,
  getByStatus,
  getPaginated,
  getStats,
  create,
  update,
  remove,
  completeTask,
  assign,
  _reset,
};
