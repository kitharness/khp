import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

test('the CLI runs through an installed-package symlink in a path with spaces', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'khp cli '))
  try {
    const entry = path.join(root, 'cli.ts')
    fs.symlinkSync(path.join(here, '..', 'src', 'cli.ts'), entry)
    const invalid = spawnSync(process.execPath, [entry], { encoding: 'utf8', timeout: 20_000 })
    assert.equal(invalid.status, 2, invalid.stderr)
    assert.match(invalid.stderr, /usage:/)

    const reportFile = path.join(root, 'report.json')
    const harness = `${JSON.stringify(process.execPath)} ${JSON.stringify(path.join(here, 'fixture-harness.ts'))}`
    const result = spawnSync(process.execPath, [entry, 'check', '--harness', harness, '--scripted', '--json', '--report', reportFile], { encoding: 'utf8', timeout: 20_000 })
    assert.equal(result.status, 0, result.stderr)
    const report = JSON.parse(result.stdout)
    assert.equal(report.mode, 'harness')
    assert.equal(report.fullyChecked, false)
    assert.deepEqual(JSON.parse(fs.readFileSync(reportFile, 'utf8')), report)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
