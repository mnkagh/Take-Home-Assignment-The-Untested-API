const request = require('supertest');
const fs = require('fs');
const path = require('path');
const app = require('../src/app');
const taskService = require('../src/services/taskService');

const future = (days) => new Date(Date.now() + days * 86400000).toISOString();
const past = (days) => new Date(Date.now() - days * 86400000).toISOString();

let counter = 0;
const uniqueTitle = (label) => `${label} ${++counter}`;

const createTask = (body = {}) =>
  request(app).post('/tasks').send({ title: uniqueTitle('task'), ...body });

const seed = async (count) => {
  const created = [];
  for (let i = 0; i < count; i++) created.push((await createTask()).body);
  return created;
};

beforeEach(() => {
  taskService._reset();
  counter = 0;
});

describe('POST /tasks', () => {
  it('creates a task and returns 201 with the stored shape', async () => {
    const res = await createTask({ priority: 'high' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      title: expect.any(String),
      status: 'todo',
      priority: 'high',
      dueDate: null,
      completedAt: null,
      assignee: null,
    });
    expect(res.body.id).toEqual(expect.any(String));
  });

  it('persists the task so it shows up in the list', async () => {
    const { body } = await createTask();
    const list = await request(app).get('/tasks');

    expect(list.body).toHaveLength(1);
    expect(list.body[0].id).toBe(body.id);
  });

  it('returns 400 when the title is missing', async () => {
    const res = await request(app).post('/tasks').send({ description: 'no title' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/title is required/);
  });

  it('returns 400 for an unknown status or priority', async () => {
    expect((await createTask({ status: 'pending' })).status).toBe(400);
    expect((await createTask({ priority: 'urgent' })).status).toBe(400);
  });

  it('returns 400 for an unparseable dueDate', async () => {
    const res = await createTask({ dueDate: 'someday' });
    expect(res.status).toBe(400);
  });

  it('accepts an in_progress task with a due date', async () => {
    const res = await createTask({ status: 'in_progress', dueDate: future(2) });
    expect(res.status).toBe(201);
  });
});

describe('GET /tasks', () => {
  it('returns an empty array when there are no tasks', async () => {
    const res = await request(app).get('/tasks');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns all tasks', async () => {
    await seed(3);
    expect((await request(app).get('/tasks')).body).toHaveLength(3);
  });

  it('filters by exact status', async () => {
    await createTask({ status: 'todo' });
    await createTask({ status: 'in_progress' });
    await createTask({ status: 'done' });

    const res = await request(app).get('/tasks?status=in_progress');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].status).toBe('in_progress');
  });

  it('returns 400 for an unknown status filter instead of silently returning nothing', async () => {
    await createTask({ status: 'todo' });
    const res = await request(app).get('/tasks?status=do');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/status must be one of/);
  });

  it('returns 200 with an empty array for a valid status with no matches', async () => {
    await createTask({ status: 'todo' });
    const res = await request(app).get('/tasks?status=done');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('starts page 1 at the first task rather than skipping ahead', async () => {
    const all = await seed(5);

    const res = await request(app).get('/tasks?page=1&limit=2');

    expect(res.body.map((t) => t.id)).toEqual([all[0].id, all[1].id]);
  });

  it('gives each page a distinct, non-overlapping slice', async () => {
    const all = await seed(5);

    const page1 = (await request(app).get('/tasks?page=1&limit=2')).body.map((t) => t.id);
    const page2 = (await request(app).get('/tasks?page=2&limit=2')).body.map((t) => t.id);
    const page3 = (await request(app).get('/tasks?page=3&limit=2')).body.map((t) => t.id);

    expect([...page1, ...page2, ...page3]).toEqual(all.map((t) => t.id));
    expect(new Set([...page1, ...page2, ...page3]).size).toBe(5);
  });

  it('applies the default limit when only a page is given', async () => {
    await seed(12);
    const res = await request(app).get('/tasks?page=2');

    expect(res.body).toHaveLength(2);
  });

  it('returns an empty array past the last page', async () => {
    await seed(3);
    const res = await request(app).get('/tasks?page=99&limit=10');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns 400 for nonsense pagination input', async () => {
    expect((await request(app).get('/tasks?page=abc')).status).toBe(400);
    expect((await request(app).get('/tasks?page=0')).status).toBe(400);
    expect((await request(app).get('/tasks?limit=-1')).status).toBe(400);
    expect((await request(app).get('/tasks?limit=100000')).status).toBe(400);
  });

  it('lets the status filter take precedence over pagination', async () => {
    await createTask({ status: 'todo' });
    const res = await request(app).get('/tasks?status=todo&page=2&limit=1');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });
});

describe('PUT /tasks/:id', () => {
  it('updates the task and returns it', async () => {
    const { body: created } = await createTask({ description: 'original' });
    const res = await request(app).put(`/tasks/${created.id}`).send({ title: 'renamed' });

    expect(res.status).toBe(200);
    expect(res.body.title).toBe('renamed');
    expect(res.body.description).toBe('original');
  });

  it('persists the change', async () => {
    const { body: created } = await createTask();
    await request(app).put(`/tasks/${created.id}`).send({ priority: 'low' });

    const list = await request(app).get('/tasks');
    expect(list.body[0].priority).toBe('low');
  });

  it('returns 404 for an unknown id', async () => {
    const res = await request(app).put('/tasks/missing-id').send({ title: 'x' });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Task not found');
  });

  it('returns 400 for an invalid body', async () => {
    const { body: created } = await createTask();
    const res = await request(app).put(`/tasks/${created.id}`).send({ title: '' });

    expect(res.status).toBe(400);
  });

  it('accepts a change of status', async () => {
    const { body: created } = await createTask();
    const res = await request(app).put(`/tasks/${created.id}`).send({ status: 'in_progress' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('in_progress');
  });
});

describe('DELETE /tasks/:id', () => {
  it('deletes the task and returns 204 with no body', async () => {
    const { body: created } = await createTask();
    const res = await request(app).delete(`/tasks/${created.id}`);

    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    expect((await request(app).get('/tasks')).body).toHaveLength(0);
  });

  it('returns 404 for an unknown id', async () => {
    const res = await request(app).delete('/tasks/missing-id');

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Task not found');
  });

  it('is not idempotent-silent: deleting twice 404s the second time', async () => {
    const { body: created } = await createTask();
    await request(app).delete(`/tasks/${created.id}`);

    expect((await request(app).delete(`/tasks/${created.id}`)).status).toBe(404);
  });
});

describe('PATCH /tasks/:id/complete', () => {
  it('marks the task done and returns it', async () => {
    const { body: created } = await createTask({ status: 'in_progress' });
    const res = await request(app).patch(`/tasks/${created.id}/complete`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('done');
    expect(Number.isNaN(Date.parse(res.body.completedAt))).toBe(false);
  });

  it('persists the completion', async () => {
    const { body: created } = await createTask();
    await request(app).patch(`/tasks/${created.id}/complete`);

    const list = await request(app).get('/tasks');
    expect(list.body[0].status).toBe('done');
  });

  it('does not change the priority of the task', async () => {
    const { body: created } = await createTask({ priority: 'high' });
    const res = await request(app).patch(`/tasks/${created.id}/complete`);

    expect(res.body.priority).toBe('high');
  });

  it('removes the task from the overdue count', async () => {
    const { body: created } = await createTask({ dueDate: past(3) });
    expect((await request(app).get('/tasks/stats')).body.overdue).toBe(1);

    await request(app).patch(`/tasks/${created.id}/complete`);
    expect((await request(app).get('/tasks/stats')).body.overdue).toBe(0);
  });

  it('returns 404 for an unknown id', async () => {
    const res = await request(app).patch('/tasks/missing-id/complete');

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Task not found');
  });

  it('keeps the original completedAt when completed twice', async () => {
    const { body: created } = await createTask();
    const first = await request(app).patch(`/tasks/${created.id}/complete`);
    const second = await request(app).patch(`/tasks/${created.id}/complete`);

    expect(second.body.completedAt).toBe(first.body.completedAt);
  });
});

describe('PATCH /tasks/:id/assign', () => {
  it('assigns the task and returns the updated task', async () => {
    const { body: created } = await createTask();
    const res = await request(app).patch(`/tasks/${created.id}/assign`).send({ assignee: 'Ada' });

    expect(res.status).toBe(200);
    expect(res.body.assignee).toBe('Ada');
    expect(res.body.id).toBe(created.id);
  });

  it('persists the assignment', async () => {
    const { body: created } = await createTask();
    await request(app).patch(`/tasks/${created.id}/assign`).send({ assignee: 'Ada' });

    const list = await request(app).get('/tasks');
    expect(list.body[0].assignee).toBe('Ada');
  });

  it('does not disturb the other fields of the task', async () => {
    const { body: created } = await createTask({ priority: 'high', status: 'in_progress' });
    const res = await request(app).patch(`/tasks/${created.id}/assign`).send({ assignee: 'Ada' });

    expect(res.body).toMatchObject({
      title: created.title,
      priority: 'high',
      status: 'in_progress',
      createdAt: created.createdAt,
    });
  });

  it('reassigns a task that is already assigned', async () => {
    const { body: created } = await createTask();
    await request(app).patch(`/tasks/${created.id}/assign`).send({ assignee: 'Ada' });
    const res = await request(app).patch(`/tasks/${created.id}/assign`).send({ assignee: 'Grace' });

    expect(res.status).toBe(200);
    expect(res.body.assignee).toBe('Grace');
    expect((await request(app).get('/tasks')).body).toHaveLength(1);
  });

  it('unassigns when assignee is null', async () => {
    const { body: created } = await createTask();
    await request(app).patch(`/tasks/${created.id}/assign`).send({ assignee: 'Ada' });
    const res = await request(app).patch(`/tasks/${created.id}/assign`).send({ assignee: null });

    expect(res.status).toBe(200);
    expect(res.body.assignee).toBeNull();
    expect(res.body.assignedAt).toBeNull();
  });

  it('returns 404 for an unknown task', async () => {
    const res = await request(app).patch('/tasks/missing-id/assign').send({ assignee: 'Ada' });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Task not found');
  });

  it('returns 400 when assignee is missing', async () => {
    const { body: created } = await createTask();
    const res = await request(app).patch(`/tasks/${created.id}/assign`).send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/assignee is required/);
  });

  it('returns 400 for an empty or whitespace-only assignee', async () => {
    const { body: created } = await createTask();

    expect((await request(app).patch(`/tasks/${created.id}/assign`).send({ assignee: '' })).status).toBe(
      400
    );
    expect(
      (await request(app).patch(`/tasks/${created.id}/assign`).send({ assignee: '   ' })).status
    ).toBe(400);
  });

  it('returns 400 for a non-string assignee', async () => {
    const { body: created } = await createTask();
    const res = await request(app).patch(`/tasks/${created.id}/assign`).send({ assignee: 42 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/string or null/);
  });

  it('leaves the task unassigned when validation fails', async () => {
    const { body: created } = await createTask();
    await request(app).patch(`/tasks/${created.id}/assign`).send({ assignee: '' });

    expect((await request(app).get('/tasks')).body[0].assignee).toBeNull();
  });

  it('works on a completed task without changing its status', async () => {
    const { body: created } = await createTask();
    await request(app).patch(`/tasks/${created.id}/complete`);
    const res = await request(app).patch(`/tasks/${created.id}/assign`).send({ assignee: 'Ada' });

    expect(res.body.status).toBe('done');
    expect(res.body.assignee).toBe('Ada');
  });
});

describe('GET /tasks/stats', () => {
  it('returns zeroed stats for an empty store', async () => {
    const res = await request(app).get('/tasks/stats');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ todo: 0, in_progress: 0, done: 0, overdue: 0 });
  });

  it('counts tasks by status', async () => {
    await createTask();
    await createTask();
    await createTask({ status: 'in_progress' });
    await createTask({ status: 'done' });

    expect((await request(app).get('/tasks/stats')).body).toEqual({
      todo: 2,
      in_progress: 1,
      done: 1,
      overdue: 0,
    });
  });

  it('counts only unfinished tasks past their due date as overdue', async () => {
    await createTask({ dueDate: past(1) });
    await createTask({ dueDate: past(2) });
    await createTask({ dueDate: future(2) });
    await createTask();
    await createTask({ dueDate: past(5), status: 'done' });

    expect((await request(app).get('/tasks/stats')).body.overdue).toBe(2);
  });

  it('is not confused by the /:id route shape', async () => {
    await seed(2);
    const res = await request(app).get('/tasks/stats');
    expect(res.body.todo).toBe(2);
  });
});

describe('GET /health', () => {
  it('reports ok so the deployed service can be probed', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(typeof res.body.uptime).toBe('number');
  });

  it('does not depend on the task store', async () => {
    await request(app).get('/health');
    expect(taskService.getAll()).toEqual([]);
  });
});

describe('README accuracy', () => {
  it('documents the status values the API actually accepts', async () => {
    const readme = fs.readFileSync(path.join(__dirname, '../../README.md'), 'utf8');
    const documented = readme.match(/"status": "([^"]+)"/)[1].split(' | ');

    expect(documented).toEqual(['todo', 'in_progress', 'done']);

    for (const status of documented) {
      const res = await request(app).get(`/tasks?status=${status}`);
      expect(res.status).toBe(200);
    }
  });

  it('documents the assignee fields the API returns', () => {
    const readme = fs.readFileSync(path.join(__dirname, '../../README.md'), 'utf8');

    expect(readme).toContain('"assignee": "string or null"');
    expect(readme).toContain('"assignedAt": "ISO 8601 or null"');
  });

  it('no longer marks the assign endpoint as to-implement', () => {
    const readme = fs.readFileSync(path.join(__dirname, '../../README.md'), 'utf8');

    expect(readme).not.toContain('_(to implement)_');
  });
});

describe('error handling', () => {
  it('returns a JSON 500 for malformed request bodies (documents bug #4, see BUG_REPORT.md)', async () => {
    const res = await request(app)
      .post('/tasks')
      .set('Content-Type', 'application/json')
      .send('{"title": ');

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Internal server error');
  });

  it('rejects a JSON body sent with the wrong content type as a validation error', async () => {
    const res = await request(app)
      .post('/tasks')
      .set('Content-Type', 'text/plain')
      .send('title=hello');

    expect(res.status).toBe(400);
  });
});
