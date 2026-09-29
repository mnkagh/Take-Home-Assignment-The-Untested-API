const taskService = require('../src/services/taskService');

const future = (days) => new Date(Date.now() + days * 86400000).toISOString();
const past = (days) => new Date(Date.now() - days * 86400000).toISOString();

beforeEach(() => {
  taskService._reset();
});

describe('create', () => {
  it('applies documented defaults', () => {
    const task = taskService.create({ title: 'Write tests' });

    expect(task).toMatchObject({
      title: 'Write tests',
      description: '',
      status: 'todo',
      priority: 'medium',
      dueDate: null,
      completedAt: null,
      assignee: null,
      assignedAt: null,
    });
    expect(task.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(Number.isNaN(Date.parse(task.createdAt))).toBe(false);
  });

  it('honours explicit fields', () => {
    const dueDate = future(3);
    const task = taskService.create({
      title: 'Ship feature',
      description: 'with a description',
      status: 'in_progress',
      priority: 'high',
      dueDate,
    });

    expect(task).toMatchObject({
      description: 'with a description',
      status: 'in_progress',
      priority: 'high',
      dueDate,
    });
  });

  it('generates a unique id per task', () => {
    const ids = new Set([1, 2, 3, 4, 5].map(() => taskService.create({ title: 'x' }).id));
    expect(ids.size).toBe(5);
  });
});

describe('getAll / findById', () => {
  it('returns an empty array when there are no tasks', () => {
    expect(taskService.getAll()).toEqual([]);
  });

  it('returns every created task', () => {
    const a = taskService.create({ title: 'a' });
    const b = taskService.create({ title: 'b' });

    expect(taskService.getAll()).toHaveLength(2);
    expect(taskService.getAll().map((t) => t.id)).toEqual([a.id, b.id]);
  });

  it('does not let callers mutate the store through the returned array', () => {
    taskService.create({ title: 'a' });
    taskService.getAll().pop();
    expect(taskService.getAll()).toHaveLength(1);
  });

  it('finds a task by id and returns undefined for an unknown id', () => {
    const a = taskService.create({ title: 'a' });
    expect(taskService.findById(a.id).title).toBe('a');
    expect(taskService.findById('nope')).toBeUndefined();
  });
});

describe('getByStatus', () => {
  beforeEach(() => {
    taskService.create({ title: 'todo task', status: 'todo' });
    taskService.create({ title: 'working task', status: 'in_progress' });
    taskService.create({ title: 'done task', status: 'done' });
  });

  it('returns only tasks with the exact status', () => {
    expect(taskService.getByStatus('todo').map((t) => t.title)).toEqual(['todo task']);
    expect(taskService.getByStatus('in_progress').map((t) => t.title)).toEqual(['working task']);
    expect(taskService.getByStatus('done').map((t) => t.title)).toEqual(['done task']);
  });

  it('returns an empty array for an unknown status', () => {
    expect(taskService.getByStatus('archived')).toEqual([]);
  });

  it('does not match on substrings', () => {
    expect(taskService.getByStatus('do')).toEqual([]);
    expect(taskService.getByStatus('od')).toEqual([]);
    expect(taskService.getByStatus('progress')).toEqual([]);
  });
});

describe('getPaginated', () => {
  beforeEach(() => {
    for (let i = 1; i <= 5; i++) taskService.create({ title: `task ${i}` });
  });

  it('returns the first page starting at the first task', () => {
    expect(taskService.getPaginated(1, 2).map((t) => t.title)).toEqual(['task 1', 'task 2']);
  });

  it('returns the second page without overlapping the first', () => {
    expect(taskService.getPaginated(2, 2).map((t) => t.title)).toEqual(['task 3', 'task 4']);
  });

  it('returns a partial final page', () => {
    expect(taskService.getPaginated(3, 2).map((t) => t.title)).toEqual(['task 5']);
  });

  it('returns an empty array past the end of the collection', () => {
    expect(taskService.getPaginated(4, 2)).toEqual([]);
  });

  it('returns every task when the limit exceeds the collection size', () => {
    expect(taskService.getPaginated(1, 50)).toHaveLength(5);
  });
});

describe('getStats', () => {
  it('counts nothing for an empty store', () => {
    expect(taskService.getStats()).toEqual({ todo: 0, in_progress: 0, done: 0, overdue: 0 });
  });

  it('counts tasks by status', () => {
    taskService.create({ title: 'a' });
    taskService.create({ title: 'b' });
    taskService.create({ title: 'c', status: 'in_progress' });
    taskService.create({ title: 'd', status: 'done' });

    expect(taskService.getStats()).toEqual({ todo: 2, in_progress: 1, done: 1, overdue: 0 });
  });

  it('counts overdue tasks that are not done', () => {
    taskService.create({ title: 'late', dueDate: past(1) });
    taskService.create({ title: 'later', dueDate: future(1) });
    taskService.create({ title: 'no due date' });

    expect(taskService.getStats().overdue).toBe(1);
  });

  it('does not count a completed task as overdue', () => {
    taskService.create({ title: 'late but done', dueDate: past(30), status: 'done' });
    expect(taskService.getStats().overdue).toBe(0);
  });
});

describe('update', () => {
  it('merges the given fields into the stored task', () => {
    const created = taskService.create({ title: 'old', description: 'keep me' });
    const updated = taskService.update(created.id, { title: 'new' });

    expect(updated.title).toBe('new');
    expect(updated.description).toBe('keep me');
    expect(taskService.findById(created.id).title).toBe('new');
  });

  it('preserves fields that were not part of the update', () => {
    const created = taskService.create({ title: 'a', priority: 'high' });
    const updated = taskService.update(created.id, { status: 'in_progress' });

    expect(updated.priority).toBe('high');
    expect(updated.id).toBe(created.id);
    expect(updated.createdAt).toBe(created.createdAt);
  });

  it('returns null for an unknown id', () => {
    expect(taskService.update('missing', { title: 'x' })).toBeNull();
  });

  it('does not add a task when the id is unknown', () => {
    taskService.update('missing', { title: 'x' });
    expect(taskService.getAll()).toHaveLength(0);
  });
});

describe('remove', () => {
  it('deletes the task and returns true', () => {
    const created = taskService.create({ title: 'a' });

    expect(taskService.remove(created.id)).toBe(true);
    expect(taskService.getAll()).toHaveLength(0);
  });

  it('returns false for an unknown id', () => {
    expect(taskService.remove('missing')).toBe(false);
  });

  it('leaves the other tasks alone', () => {
    const a = taskService.create({ title: 'a' });
    const b = taskService.create({ title: 'b' });

    taskService.remove(a.id);
    expect(taskService.getAll().map((t) => t.id)).toEqual([b.id]);
  });
});

describe('completeTask', () => {
  it('marks the task done and stamps completedAt', () => {
    const created = taskService.create({ title: 'a' });
    const completed = taskService.completeTask(created.id);

    expect(completed.status).toBe('done');
    expect(Number.isNaN(Date.parse(completed.completedAt))).toBe(false);
    expect(taskService.findById(created.id).status).toBe('done');
  });

  it('preserves the priority of the task', () => {
    const created = taskService.create({ title: 'a', priority: 'high' });
    expect(taskService.completeTask(created.id).priority).toBe('high');
  });

  it('preserves other fields', () => {
    const dueDate = past(2);
    const created = taskService.create({ title: 'a', description: 'details', dueDate });
    const completed = taskService.completeTask(created.id);

    expect(completed.description).toBe('details');
    expect(completed.dueDate).toBe(dueDate);
    expect(completed.id).toBe(created.id);
  });

  it('does not move completedAt when completing an already done task', () => {
    const created = taskService.create({ title: 'a' });
    const first = taskService.completeTask(created.id);
    const second = taskService.completeTask(created.id);

    expect(second.completedAt).toBe(first.completedAt);
  });

  it('returns null for an unknown id', () => {
    expect(taskService.completeTask('missing')).toBeNull();
  });
});

describe('assign', () => {
  it('stores the assignee and an assignedAt timestamp', () => {
    const created = taskService.create({ title: 'a' });
    const assigned = taskService.assign(created.id, 'Ada Lovelace');

    expect(assigned.assignee).toBe('Ada Lovelace');
    expect(Number.isNaN(Date.parse(assigned.assignedAt))).toBe(false);
    expect(taskService.findById(created.id).assignee).toBe('Ada Lovelace');
  });

  it('reassigns a task that already has an assignee', () => {
    const created = taskService.create({ title: 'a' });
    taskService.assign(created.id, 'Ada Lovelace');
    const reassigned = taskService.assign(created.id, 'Grace Hopper');

    expect(reassigned.assignee).toBe('Grace Hopper');
    expect(taskService.getAll()).toHaveLength(1);
  });

  it('unassigns a task when given null', () => {
    const created = taskService.create({ title: 'a' });
    taskService.assign(created.id, 'Ada Lovelace');
    const unassigned = taskService.assign(created.id, null);

    expect(unassigned.assignee).toBeNull();
    expect(unassigned.assignedAt).toBeNull();
  });

  it('leaves other fields untouched', () => {
    const created = taskService.create({ title: 'a', priority: 'low' });
    const assigned = taskService.assign(created.id, 'Ada');

    expect(assigned.priority).toBe('low');
    expect(assigned.title).toBe('a');
    expect(assigned.id).toBe(created.id);
  });

  it('returns null for an unknown id', () => {
    expect(taskService.assign('missing', 'Ada')).toBeNull();
  });
});

describe('_reset', () => {
  it('empties the store', () => {
    taskService.create({ title: 'a' });
    taskService._reset();
    expect(taskService.getAll()).toEqual([]);
  });
});
