# Submission Notes

## Deploying / running it

```bash
cd task-api
npm install
npm start          # http://localhost:3000
npm test           # 117 tests
npm run coverage   # 98.98% statements
curl http://localhost:3000/health   # {"status":"ok",...} — used as the deploy health check
```

`render.yaml` at the repo root is a Render blueprint. On render.com: **New → Blueprint** →
select this repo → apply. Or **New → Web Service** with **Root Directory = `task-api`**,
build `npm install`, start `npm start`. The root directory matters because
`package.json` lives in `task-api/`, not at the repo root.

Two things to know about the free tier: the service sleeps after ~15 minutes idle, so the
first request afterwards takes ~30s, and because the store is in-memory the data resets on
every cold start. Both are properties of the demo store, not the deployment.

`GET /health` was added for the deployment requirement only — it is not part of the original
API surface, and it deliberately does not read the task store so a cold start still reports
healthy.

## What's here

- **Tests** — 115 tests, 3 suites, in `task-api/tests/`:
  - `taskService.test.js` — unit tests for every exported service function (happy path + edge cases)
  - `validators.test.js` — unit tests for every validator, including the new ones
  - `tasks.routes.test.js` — integration tests for every endpoint via Supertest
  - They test behaviour over HTTP and the service's public functions; nothing asserts on internals
    or pokes at the module-level `tasks` array.
- **`BUG_REPORT.md`** — 11 findings, each with location, expected vs actual, reproduction, and a
  suggested patch. 3 are fixed here.
- **Fixes** — pagination off-by-one (#1), priority destroyed on complete (#2), substring status
  filter (#3), plus the two closely-related defects found while fixing them: silently-ignored
  pagination input, and `completedAt` being re-stamped on a repeat completion.
- **New endpoint** — `PATCH /tasks/:id/assign`, with 12 integration tests.

## Coverage

```
File             | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
-----------------|---------|----------|---------|---------|-------------------
All files        |   98.97 |    97.52 |   97.05 |   98.83 |
 src             |   84.61 |       75 |      50 |   84.61 | 17-18
  app.js         |   84.61 |       75 |      50 |   84.61 | 17-18
 src/routes      |     100 |      100 |     100 |     100 |
  tasks.js       |     100 |      100 |     100 |     100 |
 src/services    |     100 |    95.65 |     100 |     100 |
  taskService.js |     100 |    95.65 |     100 |     100 | 22
 src/utils       |     100 |    98.57 |     100 |     100 |
  validators.js  |     100 |    98.57 |     100 |     100 | 74
```

`npm test` → 3 suites, 115 tests, all passing. `npm run coverage` reproduces the table above.

The only uncovered lines are `app.js:17-18` (`app.listen` inside the `require.main === module`
guard — starting a real server isn't something a unit test should do) and the 75% branch figure in
`app.js` is the same guard. The two partial branches in `taskService.js:22` and `validators.js:74`
are defensive guards that in-memory data plus HTTP-level validation make unreachable; I've left
them rather than write a contrived test that reaches into the store to force them.

## Design decisions — `PATCH /tasks/:id/assign`

`{ "assignee": "Ada Lovelace" }` → 200 with the updated task.

**Reassign rather than 409.** Re-assigning a task is a normal operation, not a conflict, so
overwriting is idempotent from the client's point of view: the same request twice leaves the same
state, and a retried PATCH after a dropped response can't fail. I considered `409 Conflict` for an
already-assigned task and rejected it — it forces every client to handle a state machine to do
something that has an obvious last-write-wins answer, and it makes retries unsafe.

**`null` unassigns.** `{"assignee": null}` clears the assignee, and `assignedAt` goes back to `null`
with it. I needed a way to express "nobody is on this"; reusing `""` for that would have meant
storing a sentinel value in a field typed as "name", and the alternative — a separate
`DELETE /tasks/:id/assign` — doubles the surface for one bit of state. `null` is the natural JSON
representation of "no value" and round-trips cleanly.

**Validation** (`validateAssignTask`, unit-tested in `validators.test.js`):
- field absent → `400 assignee is required` (a PATCH with an unrelated body shouldn't silently
  no-op and return `200`, which would read as "the assign worked")
- `""` or whitespace-only → `400 assignee must not be empty` — an empty assignee is never what the
  caller meant, and it is indistinguishable from "unassigned" once it reaches a UI
- non-string, non-null (number, array, object, boolean) → `400 assignee must be a string or null` —
  this is what stops `{"assignee": {"name": "Ada"}}` from being stored as `[object Object]`
- longer than 100 chars → `400`. Arbitrary, but an unbounded free-text field on a task is a
  storage/abuse problem; the number is a single exported constant, not a literal buried in the
  function.

**Trimming:** I validate that the name is non-blank after trimming but store it untrimmed, so
`"Ada "` is stored verbatim. Trimming on write would be defensible; I left the caller's data alone
so the API doesn't quietly rewrite what people type. Easy to change — one `.trim()` in the service.

**Shape:** new tasks get `assignee: null, assignedAt: null` at creation so the field is always
present in the response rather than appearing only after the first assignment. `assignedAt`
mirrors the existing `completedAt` convention. I did not add an `updatedAt` — nothing in the
existing model tracks it, and adding a half-maintained timestamp is worse than none.

**Consequence worth flagging:** `PUT /tasks/:id` can still write `assignee` directly, because
`update` spreads the whole request body. `PUT {"assignee": ""}` therefore bypasses every rule
above. That's bug #5 in the report, and it's the one I'd fix next — the fix is to make `update`
whitelist editable fields.

## What surprised me

- **`getByStatus` used `.includes()` on a status string.** I only noticed because I wrote the test
  `?status=do` → expect a 400, and then had to check why it returned tasks instead. Reading the
  one-liner, it looks like a deliberate fuzzy filter. It's the kind of bug that ships because it
  "works" in the happy path and nobody ever typed a partial status.
- **`completeTask` hardcoded `priority: 'medium'`.** It sits right next to a legitimate
  `status: 'done'` assignment, which is exactly why it survives a read-through. The "fix" I
  considered first — reading `priority` off the existing task — turned out to be the wrong move
  anyway, since the field was never meant to change.
- **`README.md` and `ASSIGNMENT.md` document two different status vocabularies.** A client built
  from the README is broken against the code. I went with the code + `ASSIGNMENT.md`
  (`todo | in_progress | done`) and left the README alone, but someone should pick a winner.
- **Validation lives entirely in the HTTP layer.** The service functions trust their input
  completely. Every test I wrote against `taskService` directly had to be careful not to encode
  "the service accepts garbage" as expected behaviour, which is an awkward thing to have to think
  about while writing tests for a service.

## What I'd test next

1. **Property-based tests for the store** (`fast-check`): random sequences of create/update/complete/
   delete/assign, asserting invariants after each step — no duplicate ids, `completedAt` non-null
   iff status is `done`, every task reachable by exactly one status filter, and every task returned
   by exactly one page. Most of the bugs here are invariant violations, and hand-written examples
   only cover the invariants I already thought of.
2. **Whitelist `update` (#5) and delete the mass-assignment hole**, then add the test that
   `PUT {"id": ..., "createdAt": ..., "completedAt": ...}` cannot move those fields.
3. **A contract test for the JSON error shape**, asserting every error path — 400s, 404s, unknown
   routes, malformed JSON — returns the same envelope. Right now they don't (bug #4, #9), and one
   test would have caught it.
4. **`GET /tasks` with a large store**, to check the O(n) scans and the unbounded growth.
5. **Multi-process/concurrency tests** once there is a real store: two assigns racing on the same
   task should not interleave into a lost update. Nothing in the in-memory design can catch this.
6. **Snapshot tests on the response body of a created task** — the shape is currently a de facto
   contract held together by this README, so a cheap `toMatchSnapshot` on the full object would
   make any accidental shape change (like the `assignee` fields I added) visible in review.

## Questions I'd ask before shipping this

1. **Is the in-memory store a placeholder or the intended architecture?** Everything else depends
   on the answer. If it's a placeholder, I'd move to a real store before spending more effort on
   the domain logic, because the concurrency and persistence bugs only appear at that layer.
2. **What is the source of truth for the status vocabulary**, given the two documents disagree, and
   who consumes it? Are there existing clients pinned to `pending | in-progress | completed`?
3. **Is `PUT` meant to be a full replacement or a partial update?** It's currently a merge, and the
   route is called `PUT`. A `PUT` that replaces would make `{"title": "x"}` wipe every other field,
   which is a much more dangerous API. I'd rename it `PATCH` if merge semantics are what's wanted.
4. **Should an invalid `?status=` be a 400 or an empty list?** I chose 400 (bug #3) on the
   reasoning that a typo should not look like "no matching tasks". If any client relies on
   filtering by an arbitrary string, that's a breaking change and I should know before shipping it.
5. **Should validation run before or after the 404 check?** See bug #10 — I matched the existing
   convention for the new endpoint rather than picking a side.
6. **Who is allowed to assign work, and should there be an audit trail?** Assignment implies
   accountability. Right now anyone who can reach the port can put a name on any task, there's no
   record of who did it, and `PUT` can set the field without any of it.
7. **What are the rate and payload limits?** `express.json()` defaults to 100 kB, which is fine
   today, but there's no auth, no rate limiting, and no CORS policy anywhere in the app.
