# PR description (paste this into the pull request body)

## What I did

Added a 115-test suite (98.97% statement / 97.52% branch coverage, target was 80%): unit
tests for `taskService` and the validators, integration tests for all six endpoints via
Supertest, and tests for the new endpoint.

Reported 11 bugs in `BUG_REPORT.md` and fixed three:

1. **Pagination was off by one.** `taskService.js:12` used `page * limit` instead of
   `(page - 1) * limit`, so `?page=1` returned tasks 2–11 and the first page was unreachable.
   Fixed, and added validation so `?page=0` or `?limit=abc` returns 400 instead of being
   silently ignored.
2. **`completeTask` destroyed the priority.** It hardcoded `priority: 'medium'`, silently
   downgrading every completed task with no way to recover the original. Removed. Also made
   repeat completion idempotent so the original `completedAt` is no longer overwritten.
3. **`getByStatus` matched on substrings.** It used `.includes()`, so `?status=do` returned
   both `done` **and** `todo` tasks. Now an exact match, plus a 400 for an unknown status so
   a typo can't be mistaken for "no matching tasks".

Added `PATCH /tasks/:id/assign`. Design decisions: reassigning is allowed and is
last-write-wins (idempotent, so a retried request after a dropped response can't fail — I
considered `409 Conflict` and rejected it as ceremony around a question with an obvious
answer); `{"assignee": null}` unassigns, since otherwise there's no way to express "nobody is
on this" and a separate `DELETE` endpoint would double the surface for one bit of state.
Validation rejects a missing field, an empty or whitespace-only string, and any non-string
non-null value (otherwise `{"assignee": {"name": "Ada"}}` gets stored as `[object Object]`),
with a 100-character cap. New tasks are created with `assignee: null` so the field is always
present in responses.

## What I'd test next

Property-based tests with `fast-check` on the store — random create/update/complete/delete
sequences asserting invariants after each step (no duplicate ids, `completedAt` non-null iff
status is `done`, every task reachable by exactly one page). Most of these bugs are invariant
violations, and hand-written examples only cover the invariants I already thought of. Then
whitelisting the fields `update` accepts, which is the mass-assignment hole below.

## What surprised me

`getByStatus` used `.includes()` on a status string, which reads like a deliberate fuzzy filter
but means `?status=do` returns the wrong tasks. And `completeTask` hardcoding
`priority: 'medium'` sits directly next to a legitimate `status: 'done'` assignment, which is
exactly why it survives a read-through. I also found the README and ASSIGNMENT document two
different status vocabularies (`pending | in-progress | completed` vs `todo | in_progress |
done`); I went with the code and the ASSIGNMENT.

## Questions before shipping

Is the in-memory store a placeholder or the intended architecture? Everything else depends on
the answer. Is `PUT` meant to be a full replacement or a partial update? It's currently a
merge, which is a risky API under a `PUT` name. And who is allowed to assign work? Right now
anyone who can reach the port can put a name on any task, with no record of who did it.

## Unfixed bugs worth flagging

Full detail and reproduction steps in `BUG_REPORT.md`.

- `PUT /tasks/:id` is a mass-assignment hole — `{"id": "hijacked", "createdAt": "1999-01-01"}`
  rewrites a task's primary key and back-dates its creation.
- Malformed JSON returns 500 instead of 400, because the error handler in `app.js` discards the
  `err.status` that `body-parser` already sets.
- `status: ""` slips past the truthiness check in the validators and creates a task that no
  status filter or stat can reach.
- `PUT {"status": "done"}` leaves `completedAt: null`, so the two fields can disagree.
- Unknown routes return Express's HTML 404, breaking the JSON error contract.
