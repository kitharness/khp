import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { test } from 'node:test'

import { Guard } from '../src/containment.ts'

test('planting checker fixtures preserves kit runtime ownership and outside-write evidence', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'khp-ownership-'))
  try {
    const workspace = path.join(root, 'workspace')
    fs.mkdirSync(workspace)
    const guard = new Guard(root, workspace)
    const cache = path.join(guard.folder('private'), 'cache.json')
    fs.writeFileSync(cache, '{}')
    fs.writeFileSync(path.join(root, 'kit-output.txt'), 'outside the workspace')
    const planted = path.join(root, 'outside', 'fixture.txt')
    guard.plant(planted, 'checker fixture')
    guard.plantFolder(path.join(root, 'outside', 'folder'))

    assert.deepEqual(guard.leftovers(), ['private/cache.json'])
    assert.match(guard.check(undefined).join('\n'), /wrote outside its workspace.*kit-output\.txt/)
    assert.equal(guard.runtimeWrites, 1)
    fs.writeFileSync(cache, '{"updated":true}')
    assert.deepEqual(guard.check(undefined), [])
    fs.unlinkSync(cache)
    assert.deepEqual(guard.check(undefined), [])
    assert.deepEqual(guard.leftovers(), [])

    fs.writeFileSync(planted, 'changed checker fixture')
    assert.match(guard.check(undefined).join('\n'), /changed a file outside its workspace.*outside\/fixture\.txt/)
    fs.unlinkSync(planted)
    assert.match(guard.check(undefined).join('\n'), /deleted a file outside its workspace.*outside\/fixture\.txt/)

    fs.writeFileSync(path.join(guard.folder('private'), 'khp-canary.txt'), 'changed canary')
    guard.plant(path.join(root, 'outside', 'another.txt'), 'another checker fixture')
    assert.match(guard.check(undefined).join('\n'), /changed a file outside its workspace.*private\/khp-canary\.txt/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
