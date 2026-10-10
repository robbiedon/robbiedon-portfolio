# hubspot-paginate

Pull every record from a HubSpot CRM search, past the 10,000-result ceiling, without losing ties at window boundaries.

Zero dependencies. One file. Tests run on plain `node --test`.

## The problem

HubSpot's search endpoint returns at most 100 records per page and refuses to page past result 10,000. To read a bigger set you run several searches, each filtered to start where the last one ended, on a sortable property like `hs_createdate`.

The bug everyone writes first: start the next window with *greater than* the last value seen. A nightly sync creates dozens of records in the same second. Every record sharing that timestamp at the boundary is silently lost. You will not notice until a count is off by 37 and you cannot explain why.

## What this does

- Restarts each window with **greater than or equal** and dedupes by record id, so ties are refetched once and emitted once.
- ANDs the window filter into every one of your filter groups (HubSpot ORs groups and ANDs filters within a group).
- Backs off exponentially on **429**.
- Falls through a list of tokens on **403**, for portals where one private app has the custom-object scope and another does not.
- Stops at a configurable **cap** so a runaway query cannot exhaust memory.
- Bails if a window makes zero progress, which means one tie group is bigger than the page budget.

## Usage

```ts
import { searchAll, searchIterate } from './index.ts'

const affiliates = await searchAll({
  objectType: '2-12345678',           // a custom object, or 'contacts', 'companies', ...
  token: [process.env.HUBSPOT_READ_TOKEN!, process.env.HUBSPOT_FALLBACK_TOKEN!],
  properties: ['name', 'email', 'status'],
  filterGroups: [{ filters: [{ propertyName: 'status', operator: 'EQ', value: 'active' }] }],
  since: '2026-01-01T00:00:00.000Z',  // optional: strictly after this hs_createdate
  cap: 100_000,
})

// or stream
for await (const record of searchIterate({ objectType: 'contacts', token, properties: ['email'] })) {
  // ...
}
```

### Options

| Option | Default | Notes |
|--------|---------|-------|
| `windowProperty` | `hs_createdate` | Must be sortable and filterable. `hs_object_id` also works for a stable full-table pull. |
| `pageSize` | 100 | HubSpot's maximum. |
| `maxPagesPerWindow` | 95 | 95 × 100 = 9,500, under the 10,000 ceiling. |
| `cap` | 50,000 | Total records. |
| `maxWindows` | 50 | Safety valve. |
| `maxRetries` | 4 | On 429 only. |
| `fetch`, `sleep` | globals | Inject for tests. |

## Running the tests

```bash
node --test packages/hubspot-paginate/index.test.ts
```

The test file includes a small in-memory HubSpot that enforces the ceiling, serves offset cursors, rate-limits once, and rejects a scopeless token, so the windowing logic is exercised for real.

## Where it came from

Extracted from a production affiliate-roster sync that reads a 12,000-record custom object nightly. The tie bug above was found in review before it shipped; the comment explaining it is still in the production file.
