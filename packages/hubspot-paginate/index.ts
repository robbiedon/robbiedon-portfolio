/**
 * hubspot-paginate
 *
 * Pull every record matching a HubSpot CRM search, past the API's 10,000-result
 * ceiling per query, without dropping ties at window boundaries.
 *
 * How it works
 * ------------
 * HubSpot's /crm/v3/objects/{type}/search returns at most 100 records per page
 * and refuses to page past result 10,000. To read a larger set you have to run
 * several searches ("windows"), each starting where the previous one stopped,
 * by filtering on a sortable property such as hs_createdate or hs_object_id.
 *
 * The trap is the boundary. A nightly sync can create dozens of records in the
 * same second. If the next window starts with a strict "greater than" the last
 * value seen, every record that shares that value is lost forever. This client
 * restarts each window with "greater than or equal" and dedupes by record id,
 * so ties are refetched once and emitted once.
 *
 * Also handled: 429 rate limits (exponential backoff), 403 scope errors
 * (fall through a list of tokens until one has the scope), and a cap on total
 * records so a runaway query cannot exhaust memory.
 *
 * Zero dependencies. Pass your own fetch for tests.
 */

export interface HubSpotRecord {
  id: string
  properties: Record<string, string | null>
  createdAt?: string
  updatedAt?: string
}

export interface HubSpotFilter {
  propertyName: string
  operator: string
  value?: string
  values?: string[]
  highValue?: string
}

export interface HubSpotFilterGroup {
  filters: HubSpotFilter[]
}

export interface SearchAllOptions {
  /** 'contacts', 'companies', 'deals', or a custom object id like '2-12345678'. */
  objectType: string
  /** One token, or several tried in order when a 403 says the current one lacks scope. */
  token: string | readonly string[]
  /** Properties to return. The window property is added automatically if missing. */
  properties: readonly string[]
  /**
   * Your own filters. HubSpot ORs filter groups and ANDs filters within a group,
   * so the window filter is added INTO every group. HubSpot allows at most 5
   * groups and 6 filters per group; leave room for one more filter per group.
   */
  filterGroups?: readonly HubSpotFilterGroup[]
  /** Sortable, filterable property used to window. Default 'hs_createdate'. */
  windowProperty?: string
  /** Only records whose window property is strictly greater than this. */
  since?: string
  /** Records per page. HubSpot max is 100. Default 100. */
  pageSize?: number
  /** Stop after this many records in total. Default 50,000. */
  cap?: number
  /** Pages per window before restarting. HubSpot stops at 10,000 results = 100 pages of 100. Default 95. */
  maxPagesPerWindow?: number
  /** Safety valve on the number of windows. Default 50. */
  maxWindows?: number
  /** Retries on 429. Default 4. */
  maxRetries?: number
  baseUrl?: string
  fetch?: typeof fetch
  sleep?: (ms: number) => Promise<void>
}

export class HubSpotSearchError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'HubSpotSearchError'
    this.status = status
  }
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * Stream every matching record exactly once. Prefer this over searchAll when
 * you want to process records as they arrive.
 */
export async function* searchIterate(opts: SearchAllOptions): AsyncGenerator<HubSpotRecord, void, undefined> {
  const tokens = typeof opts.token === 'string' ? [opts.token] : [...opts.token]
  if (tokens.length === 0) throw new Error('hubspot-paginate: at least one token is required')

  const windowProperty = opts.windowProperty ?? 'hs_createdate'
  const pageSize = Math.min(Math.max(opts.pageSize ?? 100, 1), 100)
  const cap = opts.cap ?? 50_000
  const maxPagesPerWindow = opts.maxPagesPerWindow ?? 95
  const maxWindows = opts.maxWindows ?? 50
  const maxRetries = opts.maxRetries ?? 4
  const baseUrl = (opts.baseUrl ?? 'https://api.hubapi.com').replace(/\/$/, '')
  const doFetch = opts.fetch ?? globalThis.fetch
  const sleep = opts.sleep ?? defaultSleep

  const properties = opts.properties.includes(windowProperty) ? [...opts.properties] : [...opts.properties, windowProperty]
  const userGroups: HubSpotFilterGroup[] = opts.filterGroups?.length
    ? opts.filterGroups.map((g) => ({ filters: [...g.filters] }))
    : [{ filters: [] }]

  const seen = new Set<string>()
  let emitted = 0
  let tokenIdx = 0

  // The first window honours the caller's `since` with strict GT ("created after").
  // Every later window restarts with GTE at the last value seen, and `seen`
  // absorbs the refetched ties.
  let windowStart: string | null = opts.since ?? null
  let windowOp: 'GT' | 'GTE' = 'GT'

  for (let window = 0; window < maxWindows; window++) {
    let after: string | undefined
    let pagesInWindow = 0
    let lastValue: string | null = null
    let newInWindow = 0
    let windowDone = false

    while (pagesInWindow < maxPagesPerWindow && emitted < cap) {
      const filterGroups = windowStart
        ? userGroups.map((g) => ({
            filters: [...g.filters, { propertyName: windowProperty, operator: windowOp, value: windowStart as string }],
          }))
        : userGroups.filter((g) => g.filters.length > 0)

      const body: Record<string, unknown> = {
        properties,
        sorts: [{ propertyName: windowProperty, direction: 'ASCENDING' }],
        limit: pageSize,
        ...(after ? { after } : {}),
        ...(filterGroups.length ? { filterGroups } : {}),
      }

      let res: Response | undefined
      let attempt = 0
      for (;;) {
        res = await doFetch(`${baseUrl}/crm/v3/objects/${encodeURIComponent(opts.objectType)}/search`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${tokens[tokenIdx]}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (res.status === 403 && tokenIdx < tokens.length - 1) {
          tokenIdx++ // this app lacks the scope for this object; try the next token
          continue
        }
        if (res.status === 429 && attempt < maxRetries) {
          await sleep(500 * 2 ** attempt)
          attempt++
          continue
        }
        break
      }

      const json = (await res!.json().catch(() => ({}))) as {
        results?: HubSpotRecord[]
        paging?: { next?: { after: string } }
        message?: string
      }
      if (!res!.ok) {
        throw new HubSpotSearchError(
          `HubSpot search ${opts.objectType}: ${res!.status} ${json.message ?? ''}`.trim(),
          res!.status,
        )
      }

      for (const r of json.results ?? []) {
        const v = r.properties?.[windowProperty] ?? (windowProperty === 'hs_createdate' ? r.createdAt : undefined) ?? null
        if (v != null) lastValue = v
        if (seen.has(r.id)) continue
        seen.add(r.id)
        newInWindow++
        emitted++
        yield r
        if (emitted >= cap) break
      }

      after = json.paging?.next?.after
      pagesInWindow++
      if (!after) {
        windowDone = true
        break
      }
    }

    if (windowDone || emitted >= cap || lastValue == null) return
    // Zero progress means the whole visible range is one tie group larger than
    // the page budget. Bail rather than loop forever on the same records.
    if (newInWindow === 0) return
    windowStart = lastValue
    windowOp = 'GTE'
  }
}

/** Collect every matching record into an array. */
export async function searchAll(opts: SearchAllOptions): Promise<HubSpotRecord[]> {
  const out: HubSpotRecord[] = []
  for await (const r of searchIterate(opts)) out.push(r)
  return out
}
