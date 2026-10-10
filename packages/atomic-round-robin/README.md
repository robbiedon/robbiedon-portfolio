# atomic-round-robin

Round-robin assignment in Postgres with a **derived** pointer and an **id-pinned undo**, each as a single SQL statement. Built for drivers that have no cross-statement transactions (neon-http and most serverless HTTP drivers), and for anyone who would rather not store a pointer that can drift.

Zero dependencies. Driver-agnostic: the functions return `{ text, values }` with `$1`-style parameters.

## The idea

Do not store "whose turn is next." Derive it:

```
next assignee = rotation[ (number of live assignments) % rotation.length ]
```

Then:

- **Assign** is one `INSERT` whose slot comes from a `count(*)` in a CTE.
- **Undo** is one `UPDATE` pinned to the id the operator confirmed in the dialog. It only succeeds if that row is still the latest live one. Otherwise nothing is touched and you get `stale` back, so the UI refreshes instead of guessing. The pointer rolls back automatically because the live count went down.

Why single statements matter: a split version could mark a row undone, fail the companion write, and send the natural retry to the *wrong* (previous, legitimate) assignee. With no transactions available, the only atomic unit is the statement.

## Concurrency

Two assignments racing would both read the same count and pick the same slot. The schema has a per-scope `seq` column set to `max(seq) + 1` over **all** rows, including undone ones, with `UNIQUE (scope, seq)`. The loser of a race gets SQLSTATE `23505` instead of a silent duplicate slot. Catch it and retry.

`seq` must include undone rows, not just live ones. If it counted only live rows, undoing a middle row would make the next `seq` collide with an existing one forever.

## Usage

```sql
-- once
\i packages/atomic-round-robin/schema.sql
```

```ts
import { assignStatement, undoStatement, interpretUndo, isRaceCollision } from './index.ts'

// Adapt to your driver. neon-http:
import { neon } from '@neondatabase/serverless'
const sql = neon(process.env.DATABASE_URL!)
const run = <R,>(s: { text: string; values: unknown[] }) => sql.query(s.text, s.values) as Promise<R[]>

// node-postgres:
// const run = <R,>(s) => client.query<R>(s.text, s.values).then((r) => r.rows)

async function assign(subject: string, by: string) {
  const rotation = ['ana', 'ben', 'cho', 'dev']
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const [row] = await run<AssignRow>(assignStatement({ scope: 'promo-2026', rotation, subject, assignedBy: by }))
      return row // { id, seq, assignee }
    } catch (err) {
      if (!isRaceCollision(err)) throw err
    }
  }
  throw new Error('round-robin: too many concurrent assignments')
}

async function undo(expectedId: string, by: string) {
  const [row] = await run<UndoRow>(undoStatement({ scope: 'promo-2026', expectedId, undoneBy: by }))
  return interpretUndo(row) // { status: 'ok' | 'stale' | 'nothing', ... }
}
```

`slotFor(liveCount, rotation)` is exported as a pure function so you can show "next up: Ben" in the UI without a query.

## Running the tests

```bash
node --test packages/atomic-round-robin/index.test.ts
```

The tests cover the pure pointer math, parameter alignment in both statements (every `$N` bound, none unused), undo interpretation, identifier validation, and collision detection. They do not need a database.

## Where it came from

A seasonal referral promo where every manual "+1 intro" also had to hand the intro to the next account executive, with an "Undo last" button that reversed the assignment, the counter, and the pointer together. The derived-pointer design meant there was nothing to drift; the `seq` uniqueness guard was added for this extraction, since the original ran under a single operator.
