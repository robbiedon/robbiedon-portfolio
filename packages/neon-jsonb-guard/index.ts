/**
 * neon-jsonb-guard
 *
 * A static check for a Postgres error that TypeScript cannot catch.
 *
 * Postgres infers the type of a bound parameter from where it is used: a
 * comparison against a typed column, an explicit cast, a typed function
 * argument. The JSON builders (`jsonb_build_object`, `to_jsonb`, …) take
 * `VARIADIC "any"`, so a parameter used ONLY inside one of them has nothing
 * to infer from. The statement compiles in your editor and fails at runtime:
 *
 *     ERROR: could not determine data type of parameter $3
 *
 * The fix is a cast on the parameter: `${by}::text`. This module finds the
 * places you forgot one. It understands two placeholder styles:
 *
 *   - template interpolations: sql`... jsonb_build_object('k', ${v}) ...`
 *     (neon-http `neonSql`, drizzle `sql`, postgres.js, slonik)
 *   - positional parameters: 'SELECT jsonb_build_object($1, $2)'
 *     (node-postgres `client.query(text, values)`)
 */

export interface Finding {
  /** 1-based line of the placeholder. */
  line: number
  /** 1-based column of the placeholder. */
  column: number
  /** The JSON builder the placeholder sits inside. */
  fn: string
  /** The placeholder text, e.g. "${by}" or "$3". */
  placeholder: string
  /** The source line, trimmed, for the report. */
  snippet: string
}

export interface ScanOptions {
  /** Function names to treat as untyped-variadic. Case-insensitive. */
  functions?: readonly string[]
  /** Also flag positional parameters like $1. Default true. */
  positional?: boolean
  /** Also flag template interpolations like ${x}. Default true. */
  template?: boolean
}

/** Postgres functions declared VARIADIC "any" whose arguments Postgres cannot type. */
export const DEFAULT_FUNCTIONS = [
  'jsonb_build_object',
  'jsonb_build_array',
  'json_build_object',
  'json_build_array',
  'to_jsonb',
  'to_json',
] as const

/** Scan one source file (SQL or TS/JS containing SQL) and report bare placeholders inside JSON builders. */
export function scanSource(source: string, opts: ScanOptions = {}): Finding[] {
  const fns = (opts.functions ?? DEFAULT_FUNCTIONS).map((f) => f.toLowerCase())
  const wantPositional = opts.positional ?? true
  const wantTemplate = opts.template ?? true
  const findings: Finding[] = []

  const callRe = new RegExp(`\\b(${fns.map(escapeRe).join('|')})\\s*\\(`, 'gi')
  let m: RegExpExecArray | null
  while ((m = callRe.exec(source)) !== null) {
    const fn = m[1].toLowerCase()
    const open = m.index + m[0].length - 1 // index of '('
    const close = matchParen(source, open)
    if (close < 0) continue
    // Walk the argument list, skipping SQL string literals and nested ${...}.
    let i = open + 1
    while (i < close) {
      const ch = source[i]
      if (ch === "'") {
        i = skipSqlString(source, i)
        continue
      }
      if (ch === '$' && source[i + 1] === '{') {
        const end = matchBrace(source, i + 1)
        if (end < 0) break
        if (wantTemplate && !followedByCast(source, end + 1)) {
          findings.push(mkFinding(source, i, fn, source.slice(i, end + 1)))
        }
        i = end + 1
        continue
      }
      if (ch === '$' && /[0-9]/.test(source[i + 1] ?? '')) {
        let j = i + 1
        while (j < close && /[0-9]/.test(source[j])) j++
        if (wantPositional && !followedByCast(source, j)) {
          findings.push(mkFinding(source, i, fn, source.slice(i, j)))
        }
        i = j
        continue
      }
      i++
    }
  }
  return findings
}

/** Convenience: scan several files and prefix findings with their path. */
export function formatFindings(path: string, findings: Finding[]): string[] {
  return findings.map(
    (f) => `${path}:${f.line}:${f.column}  bare ${f.placeholder} inside ${f.fn}(): add a cast (e.g. ${f.placeholder}::text)\n    ${f.snippet}`,
  )
}

// ─── helpers ────────────────────────────────────────────────────────────────

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** `::` may follow with optional whitespace: `${x} ::text` is fine. */
function followedByCast(src: string, from: number): boolean {
  let i = from
  while (i < src.length && /\s/.test(src[i])) i++
  return src[i] === ':' && src[i + 1] === ':'
}

/** Index of the ')' matching the '(' at `open`, honouring SQL strings and ${...}. */
function matchParen(src: string, open: number): number {
  let depth = 0
  for (let i = open; i < src.length; i++) {
    const ch = src[i]
    if (ch === "'") {
      i = skipSqlString(src, i) - 1
      continue
    }
    if (ch === '$' && src[i + 1] === '{') {
      const end = matchBrace(src, i + 1)
      if (end < 0) return -1
      i = end
      continue
    }
    if (ch === '(') depth++
    else if (ch === ')') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/** Index of the '}' matching the '{' at `open`, tolerating nested braces and JS strings. */
function matchBrace(src: string, open: number): number {
  let depth = 0
  for (let i = open; i < src.length; i++) {
    const ch = src[i]
    if (ch === '"' || ch === "'" || ch === '`') {
      i = skipJsString(src, i) - 1
      continue
    }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/** Index just past a SQL single-quoted literal starting at `i` ('' escapes a quote). */
function skipSqlString(src: string, i: number): number {
  let j = i + 1
  while (j < src.length) {
    if (src[j] === "'") {
      if (src[j + 1] === "'") {
        j += 2
        continue
      }
      return j + 1
    }
    j++
  }
  return src.length
}

/** Index just past a JS string literal starting at `i` (backslash escapes). */
function skipJsString(src: string, i: number): number {
  const q = src[i]
  let j = i + 1
  while (j < src.length) {
    if (src[j] === '\\') {
      j += 2
      continue
    }
    if (src[j] === q) return j + 1
    j++
  }
  return src.length
}

function mkFinding(src: string, at: number, fn: string, placeholder: string): Finding {
  let line = 1
  let lineStart = 0
  for (let i = 0; i < at; i++) {
    if (src[i] === '\n') {
      line++
      lineStart = i + 1
    }
  }
  let lineEnd = src.indexOf('\n', at)
  if (lineEnd < 0) lineEnd = src.length
  return {
    line,
    column: at - lineStart + 1,
    fn,
    placeholder,
    snippet: src.slice(lineStart, lineEnd).trim(),
  }
}
