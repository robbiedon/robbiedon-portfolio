/**
 * atomic-round-robin
 *
 * Round-robin assignment with a DERIVED pointer and an id-pinned undo, each in
 * one SQL statement, for drivers that have no cross-statement transactions
 * (neon-http, most serverless HTTP drivers) and for anyone who prefers not to
 * store a pointer that can drift.
 *
 * The idea
 * --------
 * Do not store "whose turn is next." Derive it: the next assignee is
 * rotation[(number of live assignments) % rotation.length]. Then:
 *
 *   - Assign = one INSERT that computes the slot from a count in a CTE.
 *   - Undo   = one UPDATE pinned to the id the operator confirmed, that only
 *              succeeds if that row is still the latest live one. The pointer
 *              rolls back automatically because the count went down.
 *
 * Concurrency
 * -----------
 * Two assignments racing would both read the same count and pick the same
 * slot. A per-scope `seq` column with UNIQUE (scope, seq), set to
 * max(seq) + 1 over ALL rows including undone ones, turns that race into a
 * unique-violation on the loser. Catch 23505 and retry. This is the cheapest
 * correct guard available without transactions or advisory locks.
 *
 * Driver-agnostic: the functions return { text, values } with $1-style
 * parameters. Adapt to your driver in two lines (see README).
 */

export interface Statement<Row> {
  text: string
  values: unknown[]
  /** Phantom type carrying the row shape; not used at runtime. */
  readonly _row?: Row
}

export interface AssignRow {
  id: string
  seq: number
  assignee: string
}

export interface UndoRow {
  latest_id: string | null
  undone_id: string | null
  assignee: string | null
  subject: string | null
}

export type UndoResult =
  | { status: 'ok'; id: string; assignee: string; subject: string }
  | { status: 'stale'; latestId: string }
  | { status: 'nothing' }

/** Pure: which assignee gets the n-th live assignment (0-based count of live rows so far). */
export function slotFor(liveCount: number, rotation: readonly string[]): string {
  if (rotation.length === 0) throw new Error('atomic-round-robin: rotation must not be empty')
  if (!Number.isInteger(liveCount) || liveCount < 0) throw new Error('atomic-round-robin: liveCount must be a non-negative integer')
  return rotation[liveCount % rotation.length]
}

/**
 * Build the single-statement assign. Returns the new row's id, seq, and assignee.
 * On a unique violation (SQLSTATE 23505) another assignment raced you: retry.
 */
export function assignStatement(args: {
  scope: string
  rotation: readonly string[]
  subject: string
  assignedBy: string
  table?: string
}): Statement<AssignRow> {
  if (args.rotation.length === 0) throw new Error('atomic-round-robin: rotation must not be empty')
  const table = ident(args.table ?? 'rr_assignments')
  return {
    text: `
WITH slot AS (
  SELECT count(*) FILTER (WHERE undone_at IS NULL)::int AS live,
         coalesce(max(seq), 0) + 1                        AS next_seq
  FROM ${table}
  WHERE scope = $1
), ins AS (
  INSERT INTO ${table} (scope, seq, assignee, subject, assigned_by)
  SELECT $1, slot.next_seq, ($2::text[])[(slot.live % $3::int) + 1], $4, $5
  FROM slot
  RETURNING id, seq, assignee
)
SELECT id, seq, assignee FROM ins`.trim(),
    values: [args.scope, [...args.rotation], args.rotation.length, args.subject, args.assignedBy],
  }
}

/**
 * Build the single-statement undo, pinned to the assignment id the operator saw.
 * Always returns exactly one row; feed it to interpretUndo().
 *
 *   latest_id null                     -> nothing live to undo
 *   latest_id set, undone_id null      -> stale: a newer assignment landed, or
 *                                         this undo already succeeded
 *   undone_id set                      -> ok
 */
export function undoStatement(args: { scope: string; expectedId: string; undoneBy: string; table?: string }): Statement<UndoRow> {
  const table = ident(args.table ?? 'rr_assignments')
  return {
    text: `
WITH latest AS (
  SELECT id FROM ${table}
  WHERE scope = $1 AND undone_at IS NULL
  ORDER BY seq DESC
  LIMIT 1
), upd AS (
  UPDATE ${table} a
  SET undone_at = now(), undone_by = $3
  FROM latest
  WHERE a.id = latest.id AND a.id = $2::uuid AND a.undone_at IS NULL
  RETURNING a.id, a.assignee, a.subject
)
SELECT latest.id AS latest_id, upd.id AS undone_id, upd.assignee, upd.subject
FROM (SELECT 1) one
LEFT JOIN latest ON true
LEFT JOIN upd ON true`.trim(),
    values: [args.scope, args.expectedId, args.undoneBy],
  }
}

/** Pure: turn the undo statement's one row into a discriminated result. */
export function interpretUndo(row: UndoRow | undefined): UndoResult {
  if (!row || row.latest_id == null) return { status: 'nothing' }
  if (row.undone_id == null) return { status: 'stale', latestId: row.latest_id }
  return { status: 'ok', id: row.undone_id, assignee: row.assignee ?? '', subject: row.subject ?? '' }
}

/** True for a Postgres unique-violation error from any common driver. */
export function isRaceCollision(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code
  return code === '23505'
}

/** Only plain identifiers are accepted; this is interpolated, not bound. */
function ident(name: string): string {
  if (!/^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?$/i.test(name)) {
    throw new Error(`atomic-round-robin: invalid table identifier "${name}"`)
  }
  return name
}
