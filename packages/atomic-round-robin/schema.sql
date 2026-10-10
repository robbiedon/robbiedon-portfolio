-- atomic-round-robin: one table, one partial index, one uniqueness rule.
--
-- scope      groups independent rotations (a promo id, a team, a queue name)
-- seq        monotonically increasing per scope, including undone rows; the
--            UNIQUE (scope, seq) constraint is what makes two concurrent
--            assignments collide instead of silently picking the same slot
-- undone_at  soft undo; the rotation pointer is derived from live rows only

CREATE TABLE IF NOT EXISTS rr_assignments (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  scope       text        NOT NULL,
  seq         integer     NOT NULL,
  assignee    text        NOT NULL,
  subject     text        NOT NULL,
  assigned_by text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  undone_at   timestamptz,
  undone_by   text,
  UNIQUE (scope, seq)
);

CREATE INDEX IF NOT EXISTS rr_assignments_live_idx
  ON rr_assignments (scope, seq DESC)
  WHERE undone_at IS NULL;
