import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scanSource } from './index.ts'

test('flags a bare template interpolation inside jsonb_build_object', () => {
  const src = [
    'await sql`',
    '  UPDATE events SET detail = detail',
    "    || jsonb_build_object('resolvedBy', ${by}, 'resolvedAt', now())",
    '  WHERE id = ${id}`',
  ].join('\n')
  const f = scanSource(src)
  assert.equal(f.length, 1)
  assert.equal(f[0].fn, 'jsonb_build_object')
  assert.equal(f[0].placeholder, '${by}')
  assert.equal(f[0].line, 3)
})

test('accepts a cast directly after the placeholder, with or without whitespace', () => {
  const src = "sql`SELECT jsonb_build_object('a', ${a}::text, 'b', ${b} ::int, 'c', ${c}::timestamptz)`"
  assert.deepEqual(scanSource(src), [])
})

test('ignores placeholders outside JSON builders', () => {
  const src = 'sql`SELECT * FROM t WHERE k = ${k} AND d > ${d}::date`'
  assert.deepEqual(scanSource(src), [])
})

test('handles nested braces and strings inside the interpolation', () => {
  const src = "sql`SELECT to_jsonb(${rows.map((r) => ({ id: r.id, s: '}' }))})`"
  const f = scanSource(src)
  assert.equal(f.length, 1)
  assert.equal(f[0].fn, 'to_jsonb')
})

test('does not trip on parentheses inside SQL string literals', () => {
  const src = "sql`SELECT jsonb_build_object('label (with parens)', ${v}::text, 'it''s', ${w}::text)`"
  assert.deepEqual(scanSource(src), [])
})

test('flags positional parameters for node-postgres style queries', () => {
  const src = "client.query('UPDATE t SET d = jsonb_build_object($1, $2::text) WHERE id = $3', [k, v, id])"
  const f = scanSource(src)
  assert.equal(f.length, 1)
  assert.equal(f[0].placeholder, '$1')
})

test('positional scanning can be disabled', () => {
  const src = "client.query('SELECT json_build_array($1, $2)')"
  assert.equal(scanSource(src).length, 2)
  assert.equal(scanSource(src, { positional: false }).length, 0)
})

test('is case-insensitive on the function name and reports every builder', () => {
  const src = 'sql`SELECT JSONB_BUILD_ARRAY(${a}), json_build_object(${b}, ${c}::text), To_Json(${d})`'
  const f = scanSource(src)
  assert.deepEqual(
    f.map((x) => [x.fn, x.placeholder]),
    [
      ['jsonb_build_array', '${a}'],
      ['json_build_object', '${b}'],
      ['to_json', '${d}'],
    ],
  )
})

test('nested builder calls are each scanned', () => {
  const src = "sql`SELECT jsonb_build_object('inner', jsonb_build_object('x', ${x}), 'y', ${y}::text)`"
  const f = scanSource(src)
  assert.equal(f.length, 2) // the outer call sees ${x} too; both reports point at the same fix
  assert.ok(f.every((x) => x.placeholder === '${x}'))
})

test('custom function list', () => {
  const src = 'sql`SELECT my_variadic(${a}), jsonb_build_object(${b})`'
  const f = scanSource(src, { functions: ['my_variadic'] })
  assert.deepEqual(
    f.map((x) => x.fn),
    ['my_variadic'],
  )
})
