# neon-jsonb-guard

A static check for a Postgres runtime error that TypeScript, your ORM, and code review all miss.

## The bug

```ts
await sql`
  UPDATE events
  SET detail = detail || jsonb_build_object('resolvedBy', ${by}, 'resolvedAt', now())
  WHERE id = ${id}`
```

This typechecks. It passes review. In production it fails on the first click:

```
ERROR: could not determine data type of parameter $1
```

Postgres infers a bound parameter's type from context: a comparison against a typed column (`WHERE id = $2` is fine), an explicit cast, a typed function argument. The JSON builders take `VARIADIC "any"`, so a parameter used *only* inside `jsonb_build_object`, `jsonb_build_array`, `json_build_object`, `json_build_array`, `to_jsonb`, or `to_json` has nothing to infer from.

The fix is one cast:

```ts
  SET detail = detail || jsonb_build_object('resolvedBy', ${by}::text, 'resolvedAt', now())
```

Nothing exercises this locally in a zero-secrets dev setup where the API proxies to production and the database is unreachable. It shipped twice in one week in two different modules before a grep became policy. This package is that grep, done properly.

## What it does

`scanSource(source)` finds every JSON-builder call, walks its argument list (honouring SQL string literals and nested `${...}` with braces or strings inside), and reports any placeholder not immediately followed by `::`. Two placeholder styles:

- template interpolations `${x}` (neon-http `neonSql`, drizzle `sql`, postgres.js, slonik)
- positional parameters `$1` (node-postgres `client.query(text, values)`)

Each finding carries line, column, the builder name, the placeholder text, and the source line.

## Usage

As a CI gate:

```bash
node packages/neon-jsonb-guard/check.ts api/_lib/*.ts api/routers/*.ts
```

Exits 1 with a readable report if anything is found. Add `--no-positional` when scanning TypeScript where `$1` is more likely a regex backreference.

As a library, inside your own check script:

```ts
import { scanSource, formatFindings } from './packages/neon-jsonb-guard/index.ts'

const findings = scanSource(readFileSync('api/_lib/store.ts', 'utf8'))
if (findings.length) {
  console.error(formatFindings('api/_lib/store.ts', findings).join('\n'))
  process.exit(1)
}
```

## Limits

- It is a lexical scanner, not a SQL parser. It will flag a placeholder inside a builder call even if the same parameter is also used in a typed position elsewhere in the statement (Postgres would actually infer that one). In practice that pattern is rare and the cast is harmless, so false positives are cheap.
- Nested builder calls are each scanned, so a bare placeholder in an inner call is reported twice. Same fix either way.
- It does not know about functions you have declared `VARIADIC "any"` yourself. Pass them in `functions`.

## Running the tests

```bash
node --test packages/neon-jsonb-guard/index.test.ts
```

## Where it came from

Two production incidents in September 2026: a "mark resolved" button returning 500 and a roster re-key failing silently, both `jsonb_build_object` with a bare parameter, both caught only after deploy. The check now runs in the owning repo's payload-check script.
