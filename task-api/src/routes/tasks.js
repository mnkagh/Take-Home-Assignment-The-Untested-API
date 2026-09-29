const express = require('express');
const router = express.Router();
const taskService = require('../services/taskService');
const {
  validateCreateTask,
  validateUpdateTask,
  validateAssignTask,
  validateStatusQuery,
  parsePaginationQuery,
} = require('../utils/validators');

// Registered before the '/' handler below because '/stats' would otherwise be
// swallowed by a future '/:id' route. There is no GET /:id today, which is
// itself an API gap -- the only way to read a single task is to fetch the whole
// list and filter client-side (bug #9).
router.get('/stats', (req, res) => {
  const stats = taskService.getStats();
  res.json(stats);
});

router.get('/', (req, res) => {
  const { status, page, limit } = req.query;

  // The status filter is checked first, so it wins over pagination when both
  // are supplied. `status !== undefined` rather than a truthiness check, so an
  // empty `?status=` is reported as invalid instead of being ignored.
  if (status !== undefined) {
    const error = validateStatusQuery(req.query);
    if (error) {
      return res.status(400).json({ error });
    }
    return res.json(taskService.getByStatus(status));
  }

  // Pagination only engages when explicitly asked for: a bare GET /tasks
  // returns the whole collection, which is the pre-existing behaviour and is
  // covered by a test so it cannot drift.
  if (page !== undefined || limit !== undefined) {
    const { error, page: pageNum, limit: limitNum } = parsePaginationQuery(req.query);
    if (error) {
      return res.status(400).json({ error });
    }
    return res.json(taskService.getPaginated(pageNum, limitNum));
  }

  const tasks = taskService.getAll();
  res.json(tasks);
});

router.post('/', (req, res) => {
  const error = validateCreateTask(req.body);
  if (error) {
    return res.status(400).json({ error });
  }

  const task = taskService.create(req.body);
  res.status(201).json(task);
});

// PUT here is a merge, not a full replacement, so it behaves like PATCH. Whether
// that is intended is an open question in NOTES.md. Note also that validation
// runs before the existence check, so a PUT to an unknown id with an invalid
// body returns 400 rather than 404 (bug #10).
router.put('/:id', (req, res) => {
  const error = validateUpdateTask(req.body);
  if (error) {
    return res.status(400).json({ error });
  }

  const task = taskService.update(req.params.id, req.body);
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }

  res.json(task);
});

router.delete('/:id', (req, res) => {
  const deleted = taskService.remove(req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: 'Task not found' });
  }

  // 204 No Content, so there is deliberately no body here.
  res.status(204).send();
});

router.patch('/:id/complete', (req, res) => {
  const task = taskService.completeTask(req.params.id);
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }

  res.json(task);
});

// PATCH /tasks/:id/assign -- the feature added for this assignment.
//
// Semantics and the reasoning behind each choice are in NOTES.md; the short
// version: reassignment is allowed and is last-write-wins (idempotent, so a
// retried request cannot fail), and an explicit `{"assignee": null}` unassigns.
// Validation runs before the existence check, matching the convention used by
// the other routes in this file.
router.patch('/:id/assign', (req, res) => {
  const error = validateAssignTask(req.body);
  if (error) {
    return res.status(400).json({ error });
  }

  const task = taskService.assign(req.params.id, req.body.assignee);
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }

  res.json(task);
});

module.exports = router;
