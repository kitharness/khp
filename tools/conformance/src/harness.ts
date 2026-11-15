// Harness mode owns the kit side of MCP. Adapter evidence is compared with the kit's trace;
// assertions about model reasoning are deliberately never inferred from a scripted replay.
import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'

import { TOOL, UsageError } from './check.ts'
import { harnessTurns, type HarnessConfig, type HarnessEvidence } from './harness-protocol.ts'
import { splitCommand } from './session.ts'

export interface HarnessOptions {
  harness: string
  scripted?: boolean
  /** Overall adapter deadline, independent of its per-call timeout. */
  timeoutMs?: number
  tempDir?: string
  env?: Record<string, string>
}

export interface HarnessFinding {
  requirement: string
  scope: 'mount' | 'scripted' | 'model'
  status: 'pass' | 'fail' | 'not checked'
  reason: string
}

export interface HarnessReport {
  khp: string
  mode: 'harness'
  tool: typeof TOOL
  platform: string
  /** Only the checks actually performed; never a claim of full conformance. */
  passed: boolean
  fullyChecked: false
  environment: { server: string; names: string[] }[]
  findings: HarnessFinding[]
}

interface Trace {
  type: 'launch' | 'list' | 'call' | 'result'
  server?: string
  time: number
  cwd?: string
  folders?: Record<string, string>
  resolvedFolders?: Record<string, { path: string; directory: boolean } | null>
  environment?: string[]
  name?: string
  args?: Record<string, unknown>
  result?: { content: { type: string }[]; structuredContent: Record<string, unknown> }
}

const forbidden = (name: string) => /(?:^|_)(?:probe_(?:merge|discard)|draft_(?:merge|discard))(?:_|$)/i.test(name)
const within = (parent: string, child: string) => {
  const relative = path.relative(parent, child)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

function runtime(launch: Trace, workspace: string): { folder?: string; problem?: string } {
  const folders = launch.folders ?? {}
  const names = process.platform === 'win32' ? ['TEMP', 'TMP']
    : process.platform === 'linux' || folders.XDG_RUNTIME_DIR || folders.XDG_CACHE_HOME
      ? ['TMPDIR', 'XDG_RUNTIME_DIR', 'XDG_CACHE_HOME'] : ['TMPDIR']
  try {
    const values = names.map((name) => folders[name])
    if (values.some((value) => !value)) return { problem: 'Required runtime variables must name a folder.' }
    const resolved = names.map((name) => launch.resolvedFolders?.[name])
    if (resolved.some((value) => !value?.directory)) return { problem: 'A runtime variable did not name an existing folder at launch.' }
    const canonical = resolved.map((value) => value?.path as string)
    const folder = canonical[0] as string
    if (canonical.some((value) => value !== folder)) return { problem: 'Runtime variables must name one existing folder.' }
    if (within(workspace, folder) || within(folder, workspace)) return { problem: 'The private runtime folder must be separate from the workspace.' }
    return { folder }
  } catch { return { problem: 'A designated runtime folder could not be inspected.' } }
}

function readTrace(file: string): Trace[] {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as Trace)
  } catch { return [] }
}

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)

function readEvidence(file: string): HarnessEvidence | undefined {
  try {
    const value: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!object(value) || value.format !== 1 || !Array.isArray(value.tools) || !value.tools.every((name) => typeof name === 'string')) return undefined
    if (value.log !== undefined && (!Array.isArray(value.log) || !value.log.every((entry) => object(entry) && typeof entry.server === 'string' && typeof entry.name === 'string' && object(entry.args)))) return undefined
    if (value.attachments !== undefined && (!Array.isArray(value.attachments) || !value.attachments.every((entry) => object(entry) && typeof entry.path === 'string' && object(entry.content)))) return undefined
    if (value.contextLog !== undefined && (!Array.isArray(value.contextLog) || !value.contextLog.every((entry) => object(entry) && typeof entry.path === 'string' && object(entry.content)))) return undefined
    if (value.turns !== undefined && (!Array.isArray(value.turns) || !value.turns.every((entry) => object(entry) && typeof entry.id === 'string' && (entry.failure === undefined || ['denied', 'timeout', 'crash', 'unsupported'].includes(String(entry.failure)))))) return undefined
    return value as unknown as HarnessEvidence
  } catch { return undefined }
}

export async function runHarnessCheck(options: HarnessOptions): Promise<{ report: HarnessReport; exit: number }> {
  const argv = splitCommand(options.harness)
  if (!argv[0]) throw new UsageError('--harness needs a nonempty command')
  if (argv[0].includes('/') || argv[0].includes('\\')) argv[0] = path.resolve(argv[0])
  const timeoutMs = options.timeoutMs ?? 30_000
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new UsageError('harness timeout must be positive')
  const root = fs.realpathSync(fs.mkdtempSync(path.join(options.tempDir ?? os.tmpdir(), 'khp-harness-')))
  const report: HarnessReport = { khp: '1.1', mode: 'harness', tool: TOOL, platform: `${os.arch()}-${os.platform()}`, passed: false, fullyChecked: false, environment: [], findings: [] }
  const finding = (requirement: string, scope: HarnessFinding['scope'], status: HarnessFinding['status'], reason: string) => report.findings.push({ requirement, scope, status, reason })
  try {
    const workspace = path.join(root, 'workspace')
    fs.mkdirSync(workspace)
    fs.writeFileSync(path.join(workspace, 'given.probe'), 'Original')
    fs.writeFileSync(path.join(workspace, 'not-given.probe'), 'Not given to this run')
    fs.writeFileSync(path.join(workspace, 'linked.probe'), 'Linked target')
    for (const name of ['links-a.probe', 'links-b.probe']) fs.writeFileSync(path.join(workspace, name), 'linked.probe\n')
    const evidencePath = path.join(root, 'evidence.json')
    // The extension follows the running checker, so both source and compiled entry points work.
    const kit = fileURLToPath(new URL(import.meta.url.endsWith('.ts') ? './harness-kit.ts' : './harness-kit.js', import.meta.url))
    const records = ['primary', 'secondary'].map((id) => ({ id, file: path.join(root, `${id}.jsonl`) }))
    const config: HarnessConfig = {
      format: 1, workspace, evidence: evidencePath, callTimeoutMs: 250,
      servers: records.map(({ id, file }) => ({ id, command: process.execPath, args: [kit, file, workspace] })),
    }
    if (options.scripted) {
      config.script = path.join(root, 'turns.json')
      fs.writeFileSync(config.script, JSON.stringify({ format: 1, turns: harnessTurns() }))
    }
    const configPath = path.join(root, 'config.json')
    fs.writeFileSync(configPath, JSON.stringify(config))
    const completion = await new Promise<'ok' | 'failed' | 'start' | 'timeout'>((resolve) => {
      const child = spawn(argv[0] as string, argv.slice(1), { env: { ...process.env, ...options.env, KHP_HARNESS_CONFIG: configPath }, stdio: 'ignore', windowsHide: true, detached: process.platform !== 'win32' })
      const cleanup = () => {
        if (process.platform !== 'win32' && child.pid) {
          try { process.kill(-child.pid, 'SIGKILL') } catch { /* The process group already exited. */ }
        } else child.kill('SIGKILL')
      }
      const timer = setTimeout(() => { cleanup(); resolve('timeout') }, timeoutMs)
      child.once('error', () => { clearTimeout(timer); resolve('start') })
      child.once('close', (code) => { clearTimeout(timer); cleanup(); resolve(code === 0 ? 'ok' : 'failed') })
    })
    finding('adapter', 'mount', completion === 'ok' ? 'pass' : 'fail', completion === 'ok' ? 'The adapter exited successfully.' : `The adapter did not complete (${completion}).`)
    const traces = records.map(({ id, file }) => ({ id, events: readTrace(file).map((event) => ({ ...event, server: id })) }))
    const launches = traces.flatMap(({ id, events }) => events.filter((event) => event.type === 'launch').map((event) => ({ id, event })))
    for (const { id, event } of launches) report.environment.push({ server: id, names: event.environment ?? [] })
    const mounted = traces.every(({ events }) => events.some((event) => event.type === 'launch') && events.some((event) => event.type === 'list'))
    finding('MCP binding (section 8)', 'mount', mounted ? 'pass' : 'fail', mounted ? 'Both probe servers were started and their tools listed.' : 'The adapter must mount and list both probe servers.')
    const runtimes = launches.map(({ id, event }) => ({ id, ...runtime(event, workspace) }))
    const shared = runtimes.some((a) => runtimes.some((b) => a.id !== b.id && a.folder && b.folder && (within(a.folder, b.folder) || within(b.folder, a.folder))))
    const runtimeProblem = runtimes.find((entry) => entry.problem)?.problem
    finding('A58 designation', 'mount', mounted && !runtimeProblem && !shared ? 'pass' : 'fail', runtimeProblem ?? (shared ? 'Two kit servers share runtime folders.' : mounted ? 'Each observed mount has its own runtime folder outside the workspace.' : 'Both mounts are required to observe runtime separation.'))
    finding('A58 other processes', 'mount', 'not checked', 'The probe cannot observe folders given to unrelated children of the harness.')
    // cwd and environment folders were recorded by each kit, but A58 does not constrain cwd/HOME.
    finding('launch folders', 'mount', launches.length ? 'pass' : 'not checked', 'Kit cwd and designated environment folders are recorded privately at launch; reports expose variable names only. Cwd and HOME isolation are not harness requirements.')
    const evidence = readEvidence(evidencePath)
    const events = traces.flatMap(({ events }) => events)
    const calls = events.filter((event) => event.type === 'call')
    finding('A14 tool exposure', 'mount', evidence ? evidence.tools.some(forbidden) ? 'fail' : 'pass' : 'not checked', evidence ? 'Compared the adapter export of model-visible tools with the person-only merge/discard traps.' : 'No valid export of model-visible tools; MCP listing alone cannot reveal what the model is offered.')
    finding('A14 native tool semantics', 'mount', 'not checked', 'Tool names cannot establish whether an unrelated native tool can merge or discard a draft; review those implementations separately.')
    const results = events.filter((event) => event.type === 'result')
    if (evidence?.log !== undefined && Array.isArray(evidence.log)) {
      const expected = results.map(({ server, name, args, result }) => ({ server, name, args, result }))
      const answered = evidence.log.filter((entry) => entry.server !== 'harness' && entry.result !== undefined)
      finding('A10, A30 results', 'scripted', results.length ? isDeepStrictEqual(answered, expected) ? 'pass' : 'fail' : 'not checked', results.length ? 'Compared exact requests and complete MCP results, including errors, diagnostics, layout, images and files, with the exported session record.' : 'No answered calls were observed.')
      const unanswered = calls.filter((call) => !results.some((result) => isDeepStrictEqual([result.server, result.name, result.args], [call.server, call.name, call.args])))
      const loggedRequests = evidence.log.filter((entry) => entry.server !== 'harness').map(({ server, name, args }) => ({ server, name, args }))
      const actualRequests = calls.map(({ server, name, args }) => ({ server, name, args }))
      finding('A10 failed calls', 'scripted', unanswered.length ? isDeepStrictEqual(loggedRequests, actualRequests) ? 'pass' : 'fail' : 'not checked', unanswered.length ? 'Compared the complete ordered request log, including unanswered timeout/crash requests, with the kit trace.' : 'No unanswered request was observed.')
    } else finding('A10, A30 results', 'scripted', 'not checked', 'No session record export; A10 is conditional on a harness keeping one. A30 written-file logging remains unverified.')
    const attachments = evidence?.attachments
    if (Array.isArray(attachments) && options.scripted) {
      const images = results.flatMap((event) => (event.result?.content ?? []).filter((block) => block.type === 'image'))
      const valid = attachments.every((entry) => entry.path === 'given.probe' && images.some((image) => isDeepStrictEqual(image, entry.content)))
      const loggedContext = isDeepStrictEqual(attachments, evidence?.contextLog) && attachments.every((entry) => results.some((event) =>
        event.result?.content.some((block) => isDeepStrictEqual(block, entry.content)) &&
        evidence?.log?.some((logged) => logged.server === event.server && isDeepStrictEqual(logged.result, event.result)),
      ))
      finding('A39 preview authorization', 'scripted', valid ? 'pass' : 'fail', 'Compared exported context attachments with given.probe and the kit images; no other document was authorized.')
      finding('A10 preview context', 'scripted', attachments.length && Array.isArray(evidence?.log) && Array.isArray(evidence?.contextLog) ? loggedContext ? 'pass' : 'fail' : 'not checked', attachments.length ? 'Compared attached images and their source paths with the saved context transcript and complete tool-result log; unavailable exports are not checked.' : 'The adapter attached no preview; attachment logging was not exercised.')
    } else finding('A10 preview context, A39', 'scripted', 'not checked', 'Scripted context-attachment evidence was not provided.')
    if (options.scripted) {
      const turns = harnessTurns()
      const expectedCalls = turns.filter((turn) => turn.server !== 'harness' && turn.failure !== 'denied').map(({ server, name, args }) => ({ server, name, args }))
      const actualCalls = calls.map(({ server, name, args }) => ({ server, name, args }))
      const noMoves = evidence?.turns?.some((turn) => turn.id === 'move' && turn.failure === 'unsupported')
      const replayed = isDeepStrictEqual(evidence?.turns, turns.map(({ id, failure, optional }) => ({ id, ...(optional && noMoves ? { failure: 'unsupported' } : failure ? { failure } : {}) })))
      const exact = isDeepStrictEqual(actualCalls, expectedCalls)
      finding('scripted driver', 'scripted', replayed && exact ? 'pass' : 'fail', 'Every scripted turn must complete in order; kit calls must match exactly, without omissions or unsolicited calls.')
      finding('A14 model output', 'scripted', replayed && !calls.some((call) => forbidden(call.name ?? '')) ? 'pass' : 'fail', 'Scripted merge and discard outputs must be denied without invoking the kit.')
      finding('A21 automatic fixes', 'scripted', exact ? 'pass' : 'fail', 'The diagnostic fix is allowed only at the explicit-fix turn; no automatic fix or injected command is permitted.')
      finding('A12, A18, A22 replay', 'scripted', exact && replayed ? 'pass' : 'fail', 'Exercised draft edits, ready/reopen, an edit followed by check on that draft, and a structured error. These are replay observations; A12 and A18 primarily constrain kits, and A22 adds no harness MUST to check after each edit.')
      const primary = traces[0]?.events ?? []
      const hang = calls.find((call) => (call.args?.target as { path?: string } | undefined)?.path === 'hang')
      const crash = calls.find((call) => (call.args?.target as { path?: string } | undefined)?.path === 'crash')
      const timedOut = hang && crash && crash.time - hang.time <= config.callTimeoutMs + 2000
      const restarted = crash && primary.some((event) => event.type === 'launch' && primary.indexOf(event) > primary.indexOf(crash))
      const recovered = results.some((event) => event.name === 'probe_inspect' && isDeepStrictEqual(event.args, { path: 'given.probe' }))
      finding('section 10.6 timeout/restart', 'scripted', exact && replayed && timedOut && restarted && recovered ? 'pass' : 'fail', 'The hanging call must time out within the configured deadline plus 2 seconds for recovery, the crashed server must restart, and the following inspect must answer.')
      finding('A42, section 10.6 data handling', 'scripted', exact ? 'pass' : 'fail', 'No unsolicited calls from injected document text, link targets or diagnostic messages in this deterministic replay.')
      if (noMoves) finding('A43 moves and renames', 'scripted', 'not checked', 'The adapter reports that native file moves are unsupported; applicability and native implementation still require review.')
      else {
        const move = turns.find((turn) => turn.id === 'move')
        const logged = evidence?.log?.find((entry) => entry.server === 'harness' && entry.name === 'move' && isDeepStrictEqual(entry.args, move?.args))
        const moveResult = logged?.result as { files?: { path: string; version: unknown; created: boolean }[] } | undefined
        let correct = false
        try {
          correct = !fs.existsSync(path.join(workspace, 'linked.probe')) && fs.readFileSync(path.join(workspace, 'renamed.probe'), 'utf8') === 'Linked target' &&
            ['links-a.probe', 'links-b.probe'].every((name) => fs.readFileSync(path.join(workspace, name), 'utf8') === 'renamed.probe\n')
        } catch { /* An absent or unreadable moved/linking file is a failed move. */ }
        const moveFiles = moveResult?.files
        const listed = Array.isArray(moveFiles) && ['renamed.probe', 'links-a.probe', 'links-b.probe'].every((name) => moveFiles.some((file) => object(file) && file.path === name && file.version !== undefined && file.created === false))
        finding('A43 moves and renames', 'scripted', !correct ? 'fail' : !Array.isArray(evidence?.log) ? 'not checked' : logged && listed && replayed ? 'pass' : 'fail', !Array.isArray(evidence?.log) ? 'Compared moved/linking files, but no native move result/session export is available to verify logging.' : 'Compared both editable linking files, the moved file, the native move result and session record; all changed paths must be listed with versions and created:false.')
      }
    } else {
      for (const requirement of ['scripted driver', 'A14 model output', 'A21 automatic fixes', 'A12, A18, A22 replay', 'section 10.6 timeout/restart', 'A42, section 10.6 data handling']) finding(requirement, 'scripted', 'not checked', 'Mount-only run; use --scripted with a deterministic replay adapter.')
      finding('A43 moves and renames', 'scripted', 'not checked', 'Mount-only run; native moves require the optional scripted move action.')
    }
    finding('A30 person display', 'model', 'not checked', 'Showing written files to the person is a SHOULD and requires UI inspection.')
    finding('A42, section 10.6 model reasoning', 'model', 'not checked', 'Scripted tool outputs do not establish how a real model treats untrusted data or uses diagnostic codes; no model was driven.')
    report.passed = report.findings.every((entry) => entry.status !== 'fail')
    return { report, exit: completion === 'start' || completion === 'timeout' ? 2 : report.passed ? 0 : 1 }
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
}

export function formatHarness(report: HarnessReport): string {
  return [`KHP ${report.khp} · harness: ${report.passed ? 'observed checks passed' : 'failed'} (full conformance not verified)`, ...report.findings.map((entry) => `  ${entry.status}  ${entry.requirement} [${entry.scope}]: ${entry.reason}`)].join('\n')
}
