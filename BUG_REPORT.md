# Bug Report — Task Manager API

Found by reading `src/` and then writing tests against it. Every claim below was reproduced
before being written down (reproduction steps included). Three are **fixed** in this branch;
the rest are reported with a suggested patch but left alone, per the brief.

**Fixed:** #1, #2, #3
**Reported only:** #4 – #11

---

## 1. Pagination skips the first page (FIXED)

**Where:** `src/services/taskService.js:12` — `const offset = page * limit;`
(also `src/routes/tasks.js:19-24` in the original, which fed it)

**Expected:** `GET /tasks?page=1&limit=10` returns the first 10 tasks; `page=2` returns tasks 11–20.

**Actual:** The offset is computed as if pages were zero-based, so `page=1` returns tasks
**2–11** and the first `limit` tasks are unreachable through pagination. `page=0` returns the
first page, so callers that "work around" it by starting at 0 will break the moment the off-by-one
is fixed.

**How discovered:** unit test `getPaginated > returns the first page starting at the first task`
and integration test `GET /tasks > starts page 1 at the first task rather than skipping ahead`.

**Fix applied:** `const offset = (page - 1) * limit;` plus input validation — see #2 note below
for the route side, which I fixed at the same time because the two are the same bug.

---

## 2. Completing a task silently destroys its priority (FIXED)

**Where:** `src/services/taskService.js:67-72` — `completeTask` builds the new object with a
hardcoded `priority: 'medium'`.

**Expected:** `PATCH /tasks/:id/complete` changes `status` and sets `completedAt`. Nothing else.

**Actual:** Every completed task is silently downgraded to `medium` priority. A `high`-priority
task that someone finishes is permanently demoted, with no way to recover the original value and
no error. Nothing about completing work should change its importance — the assignment of
`priority` in that function looks like a copy-paste slip from the `create` defaults.

**Also fixed here:** completing an already-`done` task re-stamped `completedAt` with a new
timestamp, so the original completion time was lost on any double-submit (easy to trigger from a
retried request or a double-clicking user). `completeTask` is now idempotent: a task that is
already `done` is returned unchanged.

**How discovered:** unit test `completeTask > preserves the priority of the task`, after noticing
the `priority: 'medium'` line while reading.

**Fix applied:** removed the `priority` line; added an early return for `status === 'done'`.

---

## 3. Status filter matches on substrings, so `?status=do` returns the wrong tasks (FIXED)

**Where:** `src/services/taskService.js:9` — `tasks.filter((t) => t.status.includes(status))`

**Expected:** `GET /tasks?status=done` returns only tasks whose status is exactly `done`.

**Actual:** `String.prototype.includes` does a substring match, so:

| Filter sent   | Returned                                       |
| ------------- | ---------------------------------------------- |
| `?status=do`  | both `done` **and** `todo` tasks                |
| `?status=od`  | `todo` tasks                                    |
| `?status=o`   | `todo` **and** `done` tasks                     |
| `?status=progress` | `in_progress` tasks                         |

Any client that lets a user type a status filter gets plausible-looking wrong data instead of an
error, and there was no validation of the filter value at all.

**How discovered:** unit test `getByStatus > does not match on substrings`, plus the integration
test that asserts `?status=do` is a 400 rather than a wrong result set.

**Fix applied:** exact comparison (`t.status === status`), and the route now rejects an unknown
status with 400 using the same `VALID_STATUSES` list the create/update validators use, so a typo
fails loudly instead of returning an empty array the caller will misread as "no such tasks".

---

## 4. Malformed JSON returns 500 instead of 400 (not fixed)

**Where:** `src/app.js:9-12`

**Expected:** `POST /tasks` with body `{"title": ` returns `400 Bad Request` — the client sent
garbage, that is not the server's fault.

**Actual:** returns `500 Internal server error`. `body-parser` raises a `SyntaxError` that already
carries `status: 400`, but the error handler hardcodes `res.status(500)` and throws the status
away. It also `console.error`s the full stack for what is ordinary client noise, so a client
retrying with bad payloads can flood the logs and bury real errors. It also breaks the API's own
error contract: every other error path is JSON, this one happens to be JSON but the *class* of
error is wrong, which is what alerting keys on.

**Reproduce:** `curl -X POST localhost:3000/tasks -H 'Content-Type: application/json' -d '{"title": '`
→ `500`.

**Suggested fix:**

```js
app.use((err, req, res, next) => {
  const isClientError = err.status >= 400 && err.status < 500;
  if (!isClientError) console.error(err.stack);
  res.status(err.status || 500).json({ error: isClientError ? err.message : 'Internal server error' });
});
```

Test `error handling > returns a JSON 500 for malformed request bodies` currently pins the *buggy*
behaviour and should be flipped to 400 as part of the fix.

---

## 5. `PUT /tasks/:id` is a mass-assignment hole (not fixed)

**Where:** `src/services/taskService.js:50` — `const updated = { ...tasks[index], ...fields };`

**Expected:** a client can update the editable fields of a task, not its identity or provenance.

**Actual:** any field in the body is merged, including server-owned ones. Reproduced:

```
PUT /tasks/<id>  {"id": "hijacked", "createdAt": "1999-01-01"}
→ {"id":"hijacked", ..., "createdAt":"1999-01-01", ...}
```

A task's primary key can be rewritten (breaking every reference to it, and letting two tasks end
up sharing an id), `createdAt` can be back-dated, and `completedAt` can be forged to make an
unfinished task look done in an audit. After my change this also reaches the new fields:
`PUT /tasks/<id> {"assignee": ""}` writes an empty assignee and bypasses every rule
`PATCH /tasks/:id/assign` enforces.

**Suggested fix:** pick the fields explicitly rather than spreading the request body.

```js
const EDITABLE = ['title', 'description', 'status', 'priority', 'dueDate'];
const update = (id, fields) => {
  const index = tasks.findIndex((t) => t.id === id);
  if (index === -1) return null;
  const patch = {};
  for (const key of EDITABLE) if (fields[key] !== undefined) patch[key] = fields[key];
  tasks[index] = { ...tasks[index], ...patch };
  return tasks[index];
};
```

`completedAt`/`assignedAt` should be derived from the operations that set them, never from input.

---

## 6. `PUT` can mark a task done without setting `completedAt` (not fixed)

**Where:** `src/services/taskService.js:50`, in combination with the status validator.

**Expected:** a task is `done` if and only if `completedAt` is set.

**Actual:** `PUT /tasks/<id> {"status": "done"}` returns a task with `status: "done"` and
`completedAt: null` (reproduced). `GET /tasks/stats` counts it as done, so it drops out of the
overdue count, while any consumer that renders "completed on <date>" gets `null`. The two status
fields can now disagree in the stored data, and nothing detects it.

**Suggested fix:** derive `completedAt` in `update` when `status` transitions to `done`, and clear
it when a done task is moved back — or reject `status: "done"` in `validateUpdateTask` and make
`PATCH /tasks/:id/complete` the only way to finish a task. I'd take the second option: one
operation, one place that stamps the timestamp.

---

## 7. Empty-string `status`/`priority` slip past validation (not fixed)

**Where:** `src/utils/validators.js:8` and `:11` — `if (body.status && !VALID_STATUSES.includes(...))`

**Expected:** `status` is either absent or one of the three valid values.

**Actual:** the guard is a truthiness check, so `""` is treated as "not supplied" and passes
validation. `create`'s destructuring default (`status = 'todo'`) only applies to `undefined`, not
`""`, so the empty string is stored. Reproduced:

```
POST /tasks {"title": "x", "status": ""}  → 201 {"status": ""}
GET /tasks/stats                           → {"todo":0, "in_progress":0, "done":0, "overdue":0}
GET /tasks?status=todo                     → []  (the task exists but is in no bucket)
```

The task is now invisible to every status filter and uncounted in stats — it exists in the store
but no query can reach it. Same for `priority: ""`.

**Suggested fix:** test for `undefined` instead of truthiness in both validators:

```js
if (body.status !== undefined && !VALID_STATUSES.includes(body.status)) { ... }
```

---

## 8. `getAll()` leaks the store's objects (not fixed)

**Where:** `src/services/taskService.js:5` — `const getAll = () => [...tasks];`

**Expected:** callers get snapshots and cannot mutate the store by accident.

**Actual:** the array is copied but the task objects are shared references. Reproduced:

```js
taskService.getAll()[0].title = 'MUTATED VIA getAll';
taskService.getAll()[0].title; // → "MUTATED VIA getAll"
```

The same applies to `findById` and to the objects returned by `create`/`update`/`completeTask` —
every one of them hands out a live reference into module state. Any future code that does
`const t = findById(id); t.priority = 'x'` mutates the store without going through `update`, and
bypasses all validation. My test only covers the array half of this (`does not let callers mutate
the store through the returned array`); the object half is the part that bites.

**Suggested fix:** return structured clones from read paths
(`tasks.map((t) => ({ ...t }))`), or make the module truly private and expose only functions.

---

## 9. Unknown routes return an HTML 404 (not fixed)

**Where:** `src/app.js` — there is no 404 handler.

**Expected:** an unknown path returns the same JSON error shape as every other error.

**Actual:** Express's default 404 sends an HTML page (`text/html`). Reproduced:
`GET /tasks/does-not-exist` → `404` with `<!DOCTYPE html>...`. A JSON client that blindly calls
`res.json()` on every error will throw on this. Note the API also has **no `GET /tasks/:id`**
endpoint at all, so the only way to read a single task is to fetch the whole list and filter
client-side.

**Suggested fix:**

```js
app.use((req, res) => res.status(404).json({ error: 'Not found' }));
```

and add `GET /tasks/:id` for symmetry with `PUT`/`DELETE`/`PATCH`.

---

## 10. Validation runs before the 404 check, so the status code depends on the body (not fixed)

**Where:** `src/routes/tasks.js` — every handler validates `req.body` first, then looks up the id.

**Expected:** `PUT /tasks/does-not-exist` is a 404 — the resource does not exist, whatever you
send.

**Actual:** reproduced — `PUT /tasks/nope {"title": ""}` returns `400 title must be a non-empty
string`, while `PUT /tasks/nope {"title": "x"}` returns `404`. A client that treats 400 as
"fix my payload" and retries with the same payload on a non-existent id gets stuck in a loop,
and a monitoring dashboard counting 404s will under-count.

**Note on my own change:** `PATCH /tasks/:id/assign` follows the existing convention (validate,
then 404) for consistency with the other routes. I think 404-first is actually the right order
for a resource-scoped PATCH, but consistency inside one codebase seemed more valuable than
picking a side — flagging it as a question in `NOTES.md` rather than fixing it unilaterally.

---

## 11. Spec drift between README and ASSIGNMENT (not a code bug, but it will break clients)

**Where:** `README.md` vs `ASSIGNMENT.md`

**Expected:** one documented task shape.

**Actual:** the two documents disagree. `README.md` says status is
`pending | in-progress | completed`; `ASSIGNMENT.md` and the code say `todo | in_progress | done`.
`GET /tasks/stats` returns the code's values, so a client written from the README's task shape
reads `status` values that never appear and stats keys that do not exist. The README also
advertises `PATCH /tasks/:id/assign` as an existing endpoint before it exists.

**Suggested fix:** delete the two divergent shapes and keep one canonical table, ideally generated
from the `VALID_STATUSES`/`VALID_PRIORITIES` constants so it cannot drift again.

---

## Also worth noting (not bugs, but things I'd want before production)

- **The service layer has no validation at all.** Everything is enforced in the validators, so any
  in-process caller (a seed script, a future worker, an admin route) can write nonsense straight
  into the store. Validation belongs on the domain object, with the HTTP layer as a thin adapter.
- **The in-memory store is unbounded and process-local.** It grows without limit, disappears on
  restart, and is not shared between processes, so this cannot be scaled past one instance or
  restarted without data loss. Fine for a demo, a real problem the moment it is "heading to
  production".
- **Errors are strings.** `{ "error": "title is required and must be a non-empty string" }` gives a
  client nothing to branch on. `{ "error": { "code": "TITLE_REQUIRED", "field": "title", "message":
  "..." } }` would let clients handle errors without string matching, and would let the message be
  reworded without breaking anyone.
