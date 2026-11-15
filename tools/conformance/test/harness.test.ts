import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { formatHarness, runHarnessCheck, type HarnessReport } from '../src/harness.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const harness = (broken = '') => `${JSON.stringify(process.execPath)} ${JSON.stringify(path.join(here, 'fixture-harness.ts'))} ${broken}`
const status = (report: HarnessReport, requirement: string) => report.findings.find((entry) => entry.requirement === requirement)?.status

async function check(broken = '', scripted = true) {
  return await runHarnessCheck({ harness: harness(broken), scripted, timeoutMs: 20_000 })
}

describe('khp check --harness', () => {
  test('observes mounts without claiming scripted or model conformance', async () => {
    const { report, exit } = await check('', false)
    assert.equal(exit, 0, formatHarness(report))
    assert.equal(status(report, 'A58 designation'), 'pass')
    assert.equal(status(report, 'A14 tool exposure'), 'pass')
    assert.equal(status(report, 'A21 automatic fixes'), 'not checked')
    assert.equal(status(report, 'A10, A30 results'), 'not checked')
    assert.equal(report.fullyChecked, false)
    assert.equal(report.environment.length, 2)
  })

  test('replays draft, error, preview, file and restart scenarios without a model', async () => {
    const { report, exit } = await check()
    assert.equal(exit, 0, formatHarness(report))
    for (const requirement of ['scripted driver', 'A10, A30 results', 'A10 failed calls', 'A10 preview context', 'A39 preview authorization', 'A14 model output', 'A21 automatic fixes', 'section 10.6 timeout/restart']) assert.equal(status(report, requirement), 'pass', formatHarness(report))
    assert.equal(status(report, 'A43 moves and renames'), 'pass', formatHarness(report))
    for (const requirement of ['A58 other processes', 'A42, section 10.6 model reasoning']) assert.equal(status(report, requirement), 'not checked')
    assert.equal(report.fullyChecked, false)
    assert.equal(JSON.stringify(report).includes(os.tmpdir()), false, 'reports must not expose launch folder values')
  })

  const violations: [string, string][] = [
    ['shared-runtime', 'A58 designation'],
    ['shared-runtime-link', 'A58 designation'],
    ['split-runtime', 'A58 designation'],
    ['workspace-runtime', 'A58 designation'],
    ['missing-runtime', 'A58 designation'],
    ['tools', 'A14 tool exposure'],
    ['namespaced-tools', 'A14 tool exposure'],
    ['model-merge', 'A14 model output'],
    ['log', 'A10, A30 results'],
    ['files', 'A10, A30 results'],
    ['foreign-preview', 'A39 preview authorization'],
    ['preview-log', 'A10 preview context'],
    ['autofix', 'A21 automatic fixes'],
    ['injection', 'A42, section 10.6 data handling'],
    ['drafts', 'scripted driver'],
    ['error', 'scripted driver'],
    ['no-check', 'A12, A18, A22 replay'],
    ['no-restart', 'section 10.6 timeout/restart'],
    ['no-timeout', 'section 10.6 timeout/restart'],
    ['move-links', 'A43 moves and renames'],
    ['move-files', 'A43 moves and renames'],
  ]
  for (const [broken, requirement] of violations) test(`rejects ${broken}`, async () => {
    const { report, exit } = await check(broken, requirement !== 'A58 designation' && requirement !== 'A14 tool exposure')
    assert.equal(exit, 1, formatHarness(report))
    assert.equal(status(report, requirement), 'fail', formatHarness(report))
  })

  test('runtime folders are observed at launch even when cleaned up at exit', async () => {
    const { report, exit } = await check('clean-runtime', false)
    assert.equal(exit, 0, formatHarness(report))
    assert.equal(status(report, 'A58 designation'), 'pass')
  })

  test('unavailable session, tool and context exports never pass those checks', async () => {
    const missingLog = await check('no-log')
    assert.equal(status(missingLog.report, 'A10, A30 results'), 'not checked')
    const missingContext = await check('no-context')
    assert.equal(status(missingContext.report, 'A10 preview context, A39'), 'not checked')
    const noEvidence = await check('no-evidence', false)
    assert.equal(status(noEvidence.report, 'A14 tool exposure'), 'not checked')
    const noMoves = await check('no-moves')
    assert.equal(noMoves.exit, 0, formatHarness(noMoves.report))
    assert.equal(status(noMoves.report, 'A43 moves and renames'), 'not checked')
  })

  test('startup failures and deadlines use exit 2', async () => {
    const missing = await runHarnessCheck({ harness: 'khp-no-such-harness-command' })
    assert.equal(missing.exit, 2)
    const deadline = await runHarnessCheck({ harness: `${JSON.stringify(process.execPath)} -e "setInterval(() => {}, 1000)"`, timeoutMs: 100 })
    assert.equal(deadline.exit, 2)
    assert.equal(status(deadline.report, 'adapter'), 'fail')
  })

  test('CLI emits the harness report and rejects mixed modes', () => {
    const cli = path.join(here, '..', 'src', 'cli.ts')
    const result = spawnSync(process.execPath, [cli, 'check', '--harness', harness(), '--json'], { encoding: 'utf8', timeout: 20_000 })
    assert.equal(result.status, 0, result.stderr)
    assert.equal((JSON.parse(result.stdout) as HarnessReport).mode, 'harness')
    for (const args of [ ['--kit', 'kit', '--harness', harness()], ['--scripted'], ['--harness', ''], ['--harness', harness(), '--level', 'basic'] ]) {
      const invalid = spawnSync(process.execPath, [cli, 'check', ...args], { encoding: 'utf8' })
      assert.equal(invalid.status, 2, invalid.stdout)
    }
  })

  test('exports a persisted JSON report', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'khp-harness-report-'))
    try {
      const reportFile = path.join(root, 'report.json')
      const result = spawnSync(process.execPath, [path.join(here, '..', 'src', 'cli.ts'), 'check', '--harness', harness(), '--report', reportFile], { encoding: 'utf8', timeout: 20_000 })
      assert.equal(result.status, 0, result.stderr)
      const report = JSON.parse(fs.readFileSync(reportFile, 'utf8')) as HarnessReport
      assert.equal(report.mode, 'harness')
      assert.match(result.stdout, /full conformance not verified/)
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })
})
