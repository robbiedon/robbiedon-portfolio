import { test } from 'node:test'
import assert from 'node:assert/strict'
import { slotFor, assignStatement, undoStatement, interpretUndo, isRaceCollision } from './index.ts'

const AES = ['ana', 'ben', 'cho', 'dev'] as const

test('slotFor cycles through the rotation from the live count', () => {
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5, 9].map((n) => slotFor(n, AES)),
    ['ana', 'ben', 'cho', 'dev', 'ana', 'ben', 'ben'],
  )
})

test('slotFor rejects an empty rotation and bad counts', () => {
  assert.throws(() => slotFor(0, []))
  assert.throws(() => slotFor(-1, AES))
  assert.throws(() => slotFor(1.5, AES))
})

test('undoing the latest live row rolls the derived pointer back', () => {
  // Simulate: three assignments, undo the last, next assignment should repeat slot 2.
  let live = 0
  const picked = [slotFor(live++, AES), slotFor(live++, AES), slotFor(live++, AES)]
  assert.deepEqual(picked, ['ana', 'ben', 'cho'])
  live-- // undo
  assert.equal(slotFor(live, AES), 'cho')
})

test('assignStatement binds parameters in the order the SQL references them', () => {
  const s = assignStatement({ scope: 'promo-2026', rotation: AES, subject: 'Acme Events', assignedBy: 'rob' })
  assert.deepEqual(s.values, ['promo-2026', ['ana', 'ben', 'cho', 'dev'], 4, 'Acme Events', 'rob'])
  // every $N in the text has a value, and no value is unused
  const refs = new Set([...s.text.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])))
  assert.deepEqual([...refs].sort(), [1, 2, 3, 4, 5])
  assert.match(s.text, /UNIQUE|next_seq/) // seq is computed, not stored elsewhere
  assert.match(s.text, /\(\$2::text\[\]\)\[\(slot\.live % \$3::int\) \+ 1\]/)
})

test('undoStatement pins to the expected id and always yields one row', () => {
  const s = undoStatement({ scope: 'promo-2026', expectedId: '00000000-0000-0000-0000-000000000001', undoneBy: 'rob' })
  assert.deepEqual(s.values, ['promo-2026', '00000000-0000-0000-0000-000000000001', 'rob'])
  const refs = new Set([...s.text.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])))
  assert.deepEqual([...refs].sort(), [1, 2, 3])
  assert.match(s.text, /a\.id = latest\.id AND a\.id = \$2::uuid/)
  assert.match(s.text, /FROM \(SELECT 1\) one/)
})

test('interpretUndo distinguishes ok / stale / nothing', () => {
  assert.deepEqual(interpretUndo(undefined), { status: 'nothing' })
  assert.deepEqual(interpretUndo({ latest_id: null, undone_id: null, assignee: null, subject: null }), { status: 'nothing' })
  assert.deepEqual(interpretUndo({ latest_id: 'L', undone_id: null, assignee: null, subject: null }), { status: 'stale', latestId: 'L' })
  assert.deepEqual(interpretUndo({ latest_id: 'L', undone_id: 'L', assignee: 'ben', subject: 'Acme' }), {
    status: 'ok',
    id: 'L',
    assignee: 'ben',
    subject: 'Acme',
  })
})

test('table identifiers are validated, never bound', () => {
  assert.throws(() => assignStatement({ scope: 's', rotation: AES, subject: 'x', assignedBy: 'y', table: 'rr; DROP TABLE users' }))
  assert.doesNotThrow(() => assignStatement({ scope: 's', rotation: AES, subject: 'x', assignedBy: 'y', table: 'ops.assignments' }))
})

test('isRaceCollision recognises SQLSTATE 23505', () => {
  assert.equal(isRaceCollision({ code: '23505' }), true)
  assert.equal(isRaceCollision({ code: '42P01' }), false)
  assert.equal(isRaceCollision(new Error('x')), false)
  assert.equal(isRaceCollision(null), false)
})
