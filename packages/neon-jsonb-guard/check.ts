#!/usr/bin/env node
/**
 * CLI: scan files for bare bound parameters inside Postgres JSON builders.
 *
 *   node packages/neon-jsonb-guard/check.ts api/**\/*.ts
 *
 * Exit code 1 if anything is found, so it can gate CI. Pass `--no-positional`
 * to ignore `$1`-style placeholders (useful when scanning TS files where `$1`
 * is more likely a regex backreference than a SQL parameter).
 */
import { readFileSync } from 'node:fs'
import { scanSource, formatFindings } from './index.ts'

const args = process.argv.slice(2)
const positional = !args.includes('--no-positional')
const files = args.filter((a) => !a.startsWith('--'))

if (files.length === 0) {
  console.error('usage: check.ts [--no-positional] <file> [file...]')
  process.exit(2)
}

let total = 0
for (const file of files) {
  const src = readFileSync(file, 'utf8')
  const findings = scanSource(src, { positional })
  total += findings.length
  for (const line of formatFindings(file, findings)) console.log(line)
}

if (total > 0) {
  console.error(`\n${total} bare parameter${total === 1 ? '' : 's'} inside JSON builder calls. Postgres will fail at runtime with "could not determine data type of parameter".`)
  process.exit(1)
}
console.log(`neon-jsonb-guard: ${files.length} file${files.length === 1 ? '' : 's'} clean`)
