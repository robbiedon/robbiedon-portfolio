import { test } from 'node:test'
import assert from 'node:assert/strict'
import { searchAll, HubSpotSearchError, type HubSpotRecord } from './index.ts'

/**
 * A small in-memory HubSpot. It honours: filterGroups (GT/GTE on one property,
 * plus an optional EQ), ascending sort on that property, offset cursors, the
 * 10,000-result ceiling (scaled down to CEILING here), one 429 on the first
 * call, and a 403 for a token without scope.
 */
function fakeHubSpot(records: HubSpotRecord[], opts: { ceiling: number; badToken?: string; rateLimitOnce?: boolean }) {
  let calls = 0
  let rateLimited = false
  const fetchImpl: typeof fetch = async (_url, init) => {
    calls++
    const auth = (init?.headers as Record<string, string>).Authorization
    if (opts.badToken && auth === `Bearer ${opts.badToken}`) {
      return new Response(JSON.stringify({ message: 'missing scope' }), { status: 403 })
    }
    if (opts.rateLimitOnce && !rateLimited) {
      rateLimited = true
      return new Response(JSON.stringify({ message: 'slow down' }), { status: 429 })
    }
    const body = JSON.parse(init!.body as string) as {
      limit: number
      after?: string
      sorts: Array<{ propertyName: string }>
      filterGroups?: Array<{ filters: Array<{ propertyName: string; operator: string; value: string }> }>
    }
    const prop = body.sorts[0].propertyName
    const groups = body.filterGroups ?? []
    const matches = (r: HubSpotRecord) =>
      groups.length === 0 ||
      groups.some((g) =>
        g.filters.every((f) => {
          const v = r.properties[f.propertyName] ?? ''
          if (f.operator === 'GT') return v > f.value
          if (f.operator === 'GTE') return v >= f.value
          if (f.operator === 'EQ') return v === f.value
          throw new Error(`unsupported operator ${f.operator}`)
        }),
      )
    const sorted = records
      .filter(matches)
      .sort((a, b) => (a.properties[prop]! < b.properties[prop]! ? -1 : a.properties[prop]! > b.properties[prop]! ? 1 : a.id < b.id ? -1 : 1))
    const offset = body.after ? Number(body.after) : 0
    if (offset >= opts.ceiling) {
      return new Response(JSON.stringify({ message: `paging past ${opts.ceiling} is not allowed` }), { status: 400 })
    }
    const page = sorted.slice(offset, offset + body.limit)
    const nextOffset = offset + body.limit
    const paging = nextOffset < sorted.length ? { next: { after: String(nextOffset) } } : undefined
    return new Response(JSON.stringify({ results: page, paging }), { status: 200 })
  }
  return { fetch: fetchImpl, calls: () => calls }
}

/** 2,300 records. Records 85..99 all share one timestamp, crossing the 90-record window boundary. */
function dataset(): HubSpotRecord[] {
  const out: HubSpotRecord[] = []
  for (let i = 0; i < 2300; i++) {
    const tieGroup = i >= 85 && i < 100 ? 85 : i
    const ts = new Date(Date.UTC(2026, 0, 1, 0, 0, tieGroup)).toISOString()
    out.push({ id: `rec-${String(i).padStart(5, '0')}`, properties: { hs_createdate: ts, kind: i % 2 ? 'odd' : 'even' } })
  }
  return out
}

const noSleep = async () => {}

test('returns every record exactly once across windows, including ties at the boundary', async () => {
  const records = dataset()
  const hs = fakeHubSpot(records, { ceiling: 100 })
  const got = await searchAll({
    objectType: '2-99999999',
    token: 'good',
    properties: ['kind'],
    pageSize: 10,
    maxPagesPerWindow: 9, // 90 per window, under the fake's ceiling of 100
    fetch: hs.fetch,
    sleep: noSleep,
  })
  assert.equal(got.length, records.length)
  assert.equal(new Set(got.map((r) => r.id)).size, records.length)
  assert.deepEqual(
    got.map((r) => r.id).sort(),
    records.map((r) => r.id).sort(),
  )
})

test('ANDs the window filter into every user filter group', async () => {
  const records = dataset()
  const hs = fakeHubSpot(records, { ceiling: 100 })
  const got = await searchAll({
    objectType: 'contacts',
    token: 'good',
    properties: ['kind'],
    filterGroups: [{ filters: [{ propertyName: 'kind', operator: 'EQ', value: 'odd' }] }],
    pageSize: 10,
    maxPagesPerWindow: 9,
    fetch: hs.fetch,
    sleep: noSleep,
  })
  assert.equal(got.length, 1150)
  assert.ok(got.every((r) => r.properties.kind === 'odd'))
})

test('honours `since` as strict greater-than on the first window', async () => {
  const records = dataset()
  const hs = fakeHubSpot(records, { ceiling: 100 })
  const since = records[2000].properties.hs_createdate!
  const got = await searchAll({
    objectType: 'contacts',
    token: 'good',
    properties: ['kind'],
    since,
    pageSize: 10,
    maxPagesPerWindow: 9,
    fetch: hs.fetch,
    sleep: noSleep,
  })
  assert.equal(got.length, 299)
  assert.ok(got.every((r) => r.properties.hs_createdate! > since))
})

test('falls through to the next token on 403 and retries once on 429', async () => {
  const records = dataset().slice(0, 25)
  const hs = fakeHubSpot(records, { ceiling: 100, badToken: 'no-scope', rateLimitOnce: true })
  const slept: number[] = []
  const got = await searchAll({
    objectType: 'contacts',
    token: ['no-scope', 'good'],
    properties: ['kind'],
    pageSize: 10,
    fetch: hs.fetch,
    sleep: async (ms) => {
      slept.push(ms)
    },
  })
  assert.equal(got.length, 25)
  assert.deepEqual(slept, [500])
})

test('throws a typed error when every token lacks scope', async () => {
  const hs = fakeHubSpot(dataset().slice(0, 5), { ceiling: 100, badToken: 'no-scope' })
  await assert.rejects(
    searchAll({ objectType: 'contacts', token: 'no-scope', properties: [], fetch: hs.fetch, sleep: noSleep }),
    (err: unknown) => err instanceof HubSpotSearchError && err.status === 403,
  )
})

test('stops at the cap', async () => {
  const hs = fakeHubSpot(dataset(), { ceiling: 100 })
  const got = await searchAll({
    objectType: 'contacts',
    token: 'good',
    properties: [],
    cap: 42,
    pageSize: 10,
    maxPagesPerWindow: 9,
    fetch: hs.fetch,
    sleep: noSleep,
  })
  assert.equal(got.length, 42)
})
