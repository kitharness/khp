// Deterministic reference adapter. Broken variants exercise the checker without any model.
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { HarnessConfig, HarnessEvidence, HarnessTurn } from '../src/harness-protocol.ts'
import { KitSession } from '../src/session.ts'

async function main(): Promise<void> {
  const config = JSON.parse(fs.readFileSync(process.env.KHP_HARNESS_CONFIG as string, 'utf8')) as HarnessConfig
  const broken = process.argv[2]
  const sessions = new Map<string, KitSession>()
  const evidence: HarnessEvidence = { format: 1, tools: [], log: [], attachments: [], contextLog: [], turns: [] }
  const start = async (id: string) => {
    const server = config.servers.find((entry) => entry.id === id)
    if (!server) throw new Error('unknown probe server')
    const base = path.dirname(config.workspace)
    const runtime = broken === 'workspace-runtime' ? config.workspace : path.join(base, broken === 'shared-runtime' ? 'shared' : `runtime-${id}`)
    if (broken === 'shared-runtime-link' && id === 'secondary') fs.symlinkSync(path.join(base, 'runtime-primary'), runtime, process.platform === 'win32' ? 'junction' : 'dir')
    else fs.mkdirSync(runtime, { recursive: true })
    const env: Record<string, string> = { PATH: process.env.PATH ?? '' }
    for (const name of ['SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT']) if (process.env[name]) env[name] = process.env[name] as string
    if (broken !== 'missing-runtime') for (const name of ['TMPDIR', 'TEMP', 'TMP', 'XDG_RUNTIME_DIR', 'XDG_CACHE_HOME']) env[name] = runtime
    if (broken === 'split-runtime') {
      const other = path.join(base, `other-${id}`)
      fs.mkdirSync(other, { recursive: true })
      env[process.platform === 'win32' ? 'TMP' : 'TMPDIR'] = other
    }
    const session = await KitSession.start({ argv: [server.command, ...server.args], cwd: base, env })
    sessions.set(id, session)
    return session
  }
  try {
    for (const server of config.servers) await start(server.id)
    evidence.tools = (sessions.get('primary')?.tools ?? []).map((tool) => tool.name)
      .filter((name) => ['tools', 'namespaced-tools'].includes(broken ?? '') || !['probe_merge', 'probe_discard'].includes(name))
      .map((name) => broken === 'namespaced-tools' ? `mcp__primary__${name}` : name)
    const invoke = async (turn: HarnessTurn) => {
      const session = sessions.get(turn.server) as KitSession
      const result = await session.call(turn.name, turn.args, broken === 'no-timeout' && turn.id === 'hang' ? 3000 : config.callTimeoutMs)
      const raw = result.failure ? undefined : { content: result.content, structuredContent: result.structured, isError: result.isError }
      if (broken !== 'log') evidence.log?.push({ server: turn.server, name: turn.name, args: turn.args, result: raw })
      if (raw && broken === 'files' && turn.name === 'probe_export') {
        // Drop only the file metadata from the session record, retaining the rest of the result.
        const last = evidence.log?.at(-1)
        if (last) last.result = { ...raw, structuredContent: {} }
      }
      if (raw && turn.args.preview) for (const content of raw.content.filter((block) => block.type === 'image')) {
        const attachment = { path: broken === 'foreign-preview' ? 'not-given.probe' : 'given.probe', content }
        evidence.attachments?.push(attachment)
        if (broken !== 'preview-log') evidence.contextLog?.push(attachment)
      }
      if (result.failure) {
        if (broken !== 'no-restart') { await session.close(); await start(turn.server) }
        return turn.failure
      }
      return undefined
    }
    if (config.script) {
      const script = JSON.parse(fs.readFileSync(config.script, 'utf8')) as { format: 1; turns: HarnessTurn[] }
      for (const turn of script.turns) {
        if (turn.server === 'harness' && turn.name === 'move') {
          if (broken === 'no-moves') { evidence.turns?.push({ id: turn.id, failure: 'unsupported' }); continue }
          const from = path.join(config.workspace, 'linked.probe')
          fs.renameSync(from, path.join(config.workspace, 'renamed.probe'))
          for (const name of ['links-a.probe', 'links-b.probe']) {
            if (broken !== 'move-links' || name !== 'links-b.probe') fs.writeFileSync(path.join(config.workspace, name), 'renamed.probe\n')
          }
          const files = (broken === 'move-files' ? ['renamed.probe'] : ['renamed.probe', 'links-a.probe', 'links-b.probe']).map((name) => ({ path: name, version: '2', created: false }))
          if (broken !== 'no-log') evidence.log?.push({ server: turn.server, name: turn.name, args: turn.args, result: { files } })
          evidence.turns?.push({ id: turn.id })
          continue
        }
        if (turn.failure === 'denied') {
          if (broken === 'model-merge' && turn.name === 'probe_merge') await invoke(turn)
          evidence.turns?.push({ id: turn.id, failure: 'denied' })
          continue
        }
        if ((broken === 'drafts' && turn.name === 'probe_draft_ready') || (broken === 'no-check' && turn.name === 'probe_check') || (broken === 'error' && turn.id === 'error')) {
          evidence.turns?.push({ id: turn.id })
          continue
        }
        const failure = await invoke(turn)
        evidence.turns?.push({ id: turn.id, ...(failure ? { failure } : {}) })
        if (turn.id === 'verify' && ['autofix', 'injection'].includes(broken ?? '')) await invoke({ ...turn, name: 'probe_run', args: { path: 'given.probe', steps: [{ command: broken === 'autofix' ? 'text.fix' : 'text.injected' }] } })
      }
    }
    if (broken === 'no-evidence') return
    if (broken === 'no-log') delete evidence.log
    if (broken === 'no-context') delete evidence.attachments
    fs.writeFileSync(config.evidence, JSON.stringify(evidence))
  } finally {
    await Promise.all([...sessions.values()].map((session) => session.close()))
    if (broken === 'clean-runtime') for (const server of config.servers) fs.rmSync(path.join(path.dirname(config.workspace), `runtime-${server.id}`), { recursive: true, force: true })
  }
}

main().catch(() => { process.stderr.write('fixture harness failed\n'); process.exitCode = 1 })
