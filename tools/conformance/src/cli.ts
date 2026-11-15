#!/usr/bin/env node
// khp check --kit "<start command>" [--level …] [--package <folder>] [--fixtures <folder>]
//           [--kit-id <id>] [--env NAME=VALUE]… [--no-probes] [--sandbox [--allow-read <folder>]…]
//           [--report <file>] [--json]
// Exit status: 0 every phase of the tier passed, 1 one failed, 2 a usage error or a server that
// does not start (spec/conformance.md).

import * as fs from 'node:fs'
import { fileURLToPath } from 'node:url'

import { LEVELS, runCheck, UsageError, type CheckOptions, type Level, type Report } from './check.ts'
import { formatHarness, runHarnessCheck, type HarnessOptions } from './harness.ts'

const USAGE = `usage:
  khp check --harness "<adapter command>" [--scripted] [--harness-timeout <ms>]
            [--env NAME=VALUE]... [--report <file>] [--json]
  khp check --kit "<start command>" [--level basic|agent-ready|agent-ready-complete]
            [--package <folder>] [--fixtures <folder>] [--kit-id <id>]
            [--env NAME=VALUE]... [--no-probes] [--sandbox [--allow-read <folder>]...]
            [--report <file>] [--json]

  The workspace is a fresh copy of the fixtures; {workspace} in the start command, which it must
  name, is replaced by that folder's absolute path. The server starts in an empty folder with
  HOME, TMPDIR and XDG_* pointing at empty folders of khp check's own and, from khp check's own
  environment, only PATH; --env passes another variable (repeat it for several). TMPDIR (TEMP,
  TMP, XDG_RUNTIME_DIR, XDG_CACHE_HOME) is the server's private runtime folder (A58).
  --no-probes skips phase 12, which gives every string parameter a path outside the workspace.
  --sandbox lets the server read only the workspace, its package, its private runtime folder (A58),
  its executable and the system's folders; --allow-read adds a folder of the kit's own install
  (repeat it for several).`

interface Parsed {
  options: CheckOptions
  harness?: HarnessOptions
  report?: string
  json: boolean
}

function parse(args: string[]): Parsed {
  if (args[0] !== 'check') throw new UsageError('the only command is `khp check`')
  const options: Partial<CheckOptions> = {}
  const harness: Partial<HarnessOptions> = {}
  let report: string | undefined
  let json = false
  for (let index = 1; index < args.length; index++) {
    const arg = args[index] as string
    const value = () => {
      const next = args[++index]
      if (next === undefined) throw new UsageError(`${arg} needs a value`)
      return next
    }
    switch (arg) {
      case '--kit':
        options.kit = value()
        break
      case '--level': {
        const level = value()
        if (!LEVELS.includes(level as Level)) throw new UsageError(`--level is one of ${LEVELS.join(', ')}`)
        options.level = level as Level
        break
      }
      case '--package':
        options.package = value()
        break
      case '--fixtures':
        options.fixtures = value()
        break
      case '--kit-id':
        options.kitId = value()
        break
      case '--env': {
        const pair = value()
        const at = pair.indexOf('=')
        if (at <= 0) throw new UsageError(`--env takes NAME=VALUE, not ${pair}`)
        options.env = { ...options.env, [pair.slice(0, at)]: pair.slice(at + 1) }
        break
      }
      case '--no-probes':
        options.probes = false
        break
      case '--sandbox':
        options.sandbox = true
        break
      case '--allow-read':
        options.allowRead = [...(options.allowRead ?? []), value()]
        break
      case '--report':
        report = value()
        break
      case '--json':
        json = true
        break
      case '--harness':
        harness.harness = value()
        break
      case '--scripted':
        harness.scripted = true
        break
      case '--harness-timeout':
        harness.timeoutMs = Number(value())
        if (!Number.isFinite(harness.timeoutMs) || harness.timeoutMs <= 0) throw new UsageError('--harness-timeout needs positive milliseconds')
        break
      default:
        throw new UsageError(`unknown option ${arg}`)
    }
  }
  if (harness.harness !== undefined) {
    if (!harness.harness.trim()) throw new UsageError('--harness needs a nonempty command')
    if (Object.keys(options).some((name) => name !== 'env')) throw new UsageError('--harness cannot be combined with kit options')
    return { options: options as CheckOptions, harness: { ...harness, env: options.env } as HarnessOptions, report, json }
  }
  if (harness.scripted || harness.timeoutMs !== undefined) throw new UsageError('--scripted and --harness-timeout require --harness')
  if (!options.kit) throw new UsageError('--kit or --harness is required')
  if (options.allowRead && !options.sandbox) throw new UsageError('--allow-read widens the sandbox: pass it with --sandbox')
  return { options: options as CheckOptions, report, json }
}

export function format(report: Report): string {
  const lines = [`KHP ${report.khp} · ${report.kit.id ?? '?'} ${report.kit.version ?? ''} · tier ${report.level}: ${report.passed ? 'passed' : 'failed'}`]
  lines.push(`  ${report.claim.verified ? 'claim verified' : 'CLAIM NOT VERIFIED'}: ${report.claim.note}`)
  for (const phase of report.phases) {
    lines.push(`  ${phase.passed ? 'pass' : 'FAIL'}  ${phase.phase} ${phase.name}`)
    for (const failure of phase.failures) lines.push(`        - ${failure}`)
    for (const note of phase.notes) lines.push(`        · ${note}`)
  }
  lines.push(`  attested by the kit's own tests, not by khp check: ${report.attested.join(', ')}`)
  return lines.join('\n')
}

async function main(): Promise<number> {
  let parsed: Parsed
  try {
    parsed = parse(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n\n${USAGE}\n`)
    return 2
  }
  try {
    if (parsed.harness) {
      const { report, exit } = await runHarnessCheck(parsed.harness)
      if (parsed.report) fs.writeFileSync(parsed.report, `${JSON.stringify(report, null, 2)}\n`)
      process.stdout.write(`${parsed.json ? JSON.stringify(report, null, 2) : formatHarness(report)}\n`)
      return exit
    }
    const { report, exit } = await runCheck(parsed.options)
    if (parsed.report) fs.writeFileSync(parsed.report, `${JSON.stringify(report, null, 2)}\n`)
    process.stdout.write(`${parsed.json ? JSON.stringify(report, null, 2) : format(report)}\n`)
    return exit
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    return 2
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  main().then((code) => process.exit(code))
}
