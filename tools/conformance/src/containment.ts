// Containment (section 10.6: "a kit server reads and writes only inside its workspace", its own
// package, and its private runtime folder, A58), checked at every tier without an OS sandbox. khp
// check owns a folder per server start:
//
//   <root>/workspace/           the copy of the fixtures, the kit's workspace
//   <root>/outside-canary.bin   a canary beside the workspace (`../outside-canary.bin` from it)
//   <root>/outside/             files of the A29 path checks (phase 9)
//   <root>/cwd/                 the server's current folder, empty
//   <root>/home/                HOME and USERPROFILE, empty but for the canary khp-canary.txt
//   <root>/private/             the private runtime folder (A58): TMPDIR, TEMP, TMP, XDG_RUNTIME_DIR,
//                               and XDG_CACHE_HOME, empty but for the canary khp-canary.txt
//   <root>/xdg-*/               XDG_CONFIG_HOME, XDG_DATA_HOME (and APPDATA, LOCALAPPDATA),
//                               XDG_STATE_HOME
//
// Everything under <root> but the workspace is listed before the server starts; after each phase
// (and after each probe call) whatever appeared, vanished, or changed there is a finding, except
// what the kit made in private/, the canaries are back as they were, and no tool result or written
// file may hold a canary's content: not even the one in private/, which was there before the kit
// started and so is not its own runtime state (A58).

import { createHash, randomBytes } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'

import type { KitSession } from './session.ts'

/** khp check's own folders under the root, by the name reports use for them. */
export const SCRATCH = ['cwd', 'home', 'private', 'xdg-config', 'xdg-data', 'xdg-state'] as const
export type Scratch = (typeof SCRATCH)[number]

/** The variables khp check points at its own empty folders. `--env` cannot set them. */
export const OWNED: Record<string, Scratch> = {
  HOME: 'home',
  USERPROFILE: 'home',
  TMPDIR: 'private',
  TEMP: 'private',
  TMP: 'private',
  XDG_RUNTIME_DIR: 'private',
  XDG_CACHE_HOME: 'private',
  XDG_CONFIG_HOME: 'xdg-config',
  XDG_DATA_HOME: 'xdg-data',
  XDG_STATE_HOME: 'xdg-state',
  APPDATA: 'xdg-data',
  LOCALAPPDATA: 'xdg-data',
}

/**
 * The variables taken from khp check's own environment: PATH, to find the start command; on
 * Windows also the ones a Windows program needs to start at all.
 */
export const INHERITED = process.platform === 'win32' ? ['PATH', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT'] : ['PATH']

/**
 * The private runtime folder of A58, at every tier: the one folder the platform's temporary-folder
 * variables (TMPDIR; TEMP, TMP) and XDG_RUNTIME_DIR and XDG_CACHE_HOME name. The kit server may make
 * its sockets, caches, and scratch files there, and should remove them when it exits.
 */
export const PRIVATE: Scratch = 'private'

/** Why `--env` cannot pass `name`, or undefined when it can. */
export function envProblem(name: string): string | undefined {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return `--env ${name}: not a variable name`
  const upper = name.toUpperCase()
  if (upper in OWNED || upper.startsWith('XDG_')) {
    return `--env cannot set ${name}: khp check points it at an empty folder of its own and checks that the kit server leaves it empty (section 10.6)`
  }
  return undefined
}

/** The kit server's whole environment. */
export function environment(root: string, extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {}
  for (const name of INHERITED) {
    const value = process.env[name]
    if (value !== undefined) env[name] = value
  }
  Object.assign(env, extra)
  for (const [name, folder] of Object.entries(OWNED)) env[name] = path.join(root, folder)
  return env
}

/** The names of the variables a kit server gets, for the report. */
export function environmentNames(extra: Record<string, string>): string[] {
  return [...new Set([...INHERITED.filter((name) => process.env[name] !== undefined), ...Object.keys(extra), ...Object.keys(OWNED)])].sort()
}

interface Canary {
  /** Relative to the root. */
  file: string
  bytes: Buffer
  /** What a result or file holding the canary's content contains: the content, and its base64. */
  needles: string[]
  /** The rules a canary's content in an answer or a file breaks. */
  rules: string
}

function canary(root: string, file: string, rules = 'section 10.6, A29'): Canary {
  const bytes = Buffer.from(`khp-canary-${randomBytes(16).toString('hex')}\n`)
  fs.writeFileSync(path.join(root, file), bytes)
  const text = bytes.toString('utf8').trim()
  // The content as base64 from its first byte, cut to whole groups so a longer file encodes the same.
  const base64 = bytes.toString('base64').slice(0, Math.floor(bytes.length / 3) * 4)
  return { file, bytes, needles: [text, base64], rules }
}

/** What a path under the root is: a folder, a link and its target, or a file and its hash. */
function signature(file: string): string {
  const stat = fs.lstatSync(file)
  if (stat.isSymbolicLink()) return `link:${fs.readlinkSync(file)}`
  if (stat.isDirectory()) return 'dir'
  if (!stat.isFile()) return 'other'
  return `file:${createHash('sha1').update(fs.readFileSync(file)).digest('hex')}`
}

const MAX_ENTRIES = 20_000
const MAX_SEARCHED_BYTES = 64 * 1024 * 1024

/** Every path under `dir` (relative to `base`, with `/`), not following links, without `skip`. */
function listing(base: string, dir: string, skip: string | undefined, into = new Map<string, string>()): Map<string, string> {
  let names: string[]
  try {
    names = fs.readdirSync(dir)
  } catch {
    return into
  }
  for (const name of names.sort()) {
    if (into.size >= MAX_ENTRIES) break
    const full = path.join(dir, name)
    if (full === skip) continue
    const rel = path.relative(base, full).split(path.sep).join('/')
    let sig: string
    try {
      sig = signature(full)
    } catch {
      continue
    }
    into.set(rel, sig)
    if (sig === 'dir') listing(base, full, skip, into)
  }
  return into
}

const list = (paths: string[]) => (paths.length > 8 ? `${paths.slice(0, 8).join(', ')} and ${paths.length - 8} more` : paths.join(', '))

/** Watches one server start's folders: see the top of this file. */
export class Guard {
  readonly root: string
  readonly workspace: string
  private readonly canaries: Canary[]
  private baseline: Map<string, string>
  /** What khp check made outside the workspace: only these can be deleted or changed by the kit. */
  private readonly owned = new Set<string>()
  private seenResults = 0
  /** Workspace files already reported as holding a canary's content. */
  private readonly reported = new Set<string>()
  /** Entries the kit made in its private runtime folder (A58). */
  runtimeWrites = 0
  /** Canaries khp check took away before the server started, which are not put back. */
  private readonly withheld = new Set<string>()

  /** Makes the folders and canaries around `workspace` (already copied), and lists them. */
  constructor(root: string, workspace: string) {
    this.root = root
    this.workspace = workspace
    for (const folder of SCRATCH) fs.mkdirSync(path.join(root, folder), { recursive: true })
    this.canaries = [
      canary(root, 'outside-canary.bin'),
      canary(root, 'home/khp-canary.txt'),
      // A58: a file in the private runtime folder that the kit did not make is not its runtime state.
      canary(root, `${PRIVATE}/khp-canary.txt`, 'section 10.6, A29, A58'),
    ]
    this.baseline = listing(root, root, workspace)
    for (const rel of this.baseline.keys()) this.owned.add(rel)
  }

  /** Register only checker-created paths; the running kit may have written other files meanwhile. */
  private own(file: string) {
    const rel = path.relative(this.root, file)
    if (!rel || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw new Error('Checker fixtures must be inside the guard root.')
    const parts = rel.split(path.sep)
    for (let count = 1; count <= parts.length; count++) {
      const name = parts.slice(0, count).join('/')
      this.owned.add(name)
      this.baseline.set(name, signature(path.join(this.root, ...parts.slice(0, count))))
    }
  }

  /** The canary beside the workspace, which `../outside-canary.bin` names from it. */
  get outsideCanary(): string {
    return path.join(this.root, 'outside-canary.bin')
  }

  /**
   * Takes the canary beside the workspace away before the server starts, for a run in which
   * `../outside-canary.bin` does not exist (A42: a link outside the workspace is answered the same).
   */
  withholdOutsideCanary() {
    fs.rmSync(this.outsideCanary, { force: true })
    this.withheld.add('outside-canary.bin')
    this.baseline.delete('outside-canary.bin')
    this.owned.delete('outside-canary.bin')
  }

  folder(name: Scratch): string {
    return path.join(this.root, name)
  }

  /** Writes a file of khp check's own outside the workspace, so it is not taken for the kit's. */
  plant(file: string, bytes: Buffer | string) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, bytes)
    this.own(file)
  }

  /** Folders and links of khp check's own outside the workspace. */
  plantFolder(folder: string) {
    fs.mkdirSync(folder, { recursive: true })
    this.own(folder)
  }

  private inPrivate(rel: string): boolean {
    return rel === PRIVATE || rel.startsWith(`${PRIVATE}/`)
  }

  /**
   * What the kit made in its private runtime folder and left there: after the server stopped, the
   * entries there that are not khp check's (A58: a kit server SHOULD remove them when it exits).
   */
  leftovers(): string[] {
    const now = [...listing(this.root, path.join(this.root, PRIVATE), undefined).keys()].filter((rel) => !this.owned.has(rel))
    return now.filter((rel) => !now.some((other) => other.startsWith(`${rel}/`)))
  }

  private holds(bytes: Buffer | string): Canary | undefined {
    return this.canaries.find((entry) => entry.needles.some((needle) => bytes.includes(needle)))
  }

  /**
   * What the kit did outside its workspace since the last check: files written, deleted, or changed
   * there, and a canary's content in a tool result `session` answered or a file in the workspace.
   * Afterwards the canaries are put back, so the next check starts from the same state.
   */
  check(session: KitSession | undefined): string[] {
    const findings: string[] = []
    const now = listing(this.root, this.root, this.workspace)
    const added = [...now.keys()].filter((rel) => !this.baseline.has(rel))
    const fresh = added.filter((rel) => !this.inPrivate(rel))
    this.runtimeWrites += added.length - fresh.length
    const leaves = fresh.filter((rel) => !fresh.some((other) => other.startsWith(`${rel}/`)))
    if (leaves.length > 0) findings.push(`the kit wrote outside its workspace (section 10.6): ${list(leaves)}`)
    // A file the kit wrote and removed again was reported when it appeared; only khp check's own count here.
    const removed = [...this.baseline.keys()].filter((rel) => !now.has(rel) && this.owned.has(rel))
    const top = removed.filter((rel) => !removed.some((other) => rel.startsWith(`${other}/`)))
    if (top.length > 0) findings.push(`the kit deleted a file outside its workspace (section 10.6, A29): ${list(top)}`)
    const changed = [...now.keys()].filter((rel) => this.owned.has(rel) && this.baseline.get(rel) !== now.get(rel))
    if (changed.length > 0) findings.push(`the kit changed a file outside its workspace (section 10.6, A29): ${list(changed)}`)
    // A canary's content in an answer.
    for (const { name, args, result } of session?.results.slice(this.seenResults) ?? []) {
      const texts = [JSON.stringify(result.structured ?? null), ...result.content.map((item) => item.text ?? ''), result.failure ?? '']
      const pictures = result.content.filter((item) => item.data).map((item) => Buffer.from(item.data as string, 'base64'))
      const found = this.holds(texts.join('\n')) ?? pictures.map((picture) => this.holds(picture)).find(Boolean)
      if (found) findings.push(`the kit read a file outside its workspace and answered its content (${found.rules}): the content of ${found.file} is in the answer of ${name} ${this.shown(args)}`)
    }
    this.seenResults = session?.results.length ?? 0
    // A canary's content in a file the kit wrote, in the workspace or outside it.
    const written = [
      ...[...listing(this.root, this.workspace, undefined)].map(([rel, sig]) => ({ rel, sig })),
      ...added.map((rel) => ({ rel, sig: now.get(rel) as string })),
    ]
    let searched = 0
    for (const { rel, sig } of written) {
      if (!sig.startsWith('file:') || this.reported.has(`${rel} ${sig}`)) continue
      let bytes: Buffer
      try {
        const file = path.join(this.root, rel)
        if (searched + fs.statSync(file).size > MAX_SEARCHED_BYTES) break
        bytes = fs.readFileSync(file)
      } catch {
        continue
      }
      searched += bytes.length
      const found = this.holds(bytes)
      if (!found) continue
      this.reported.add(`${rel} ${sig}`)
      findings.push(`the kit read a file outside its workspace and wrote its content (${found.rules}): the content of ${found.file} is in ${rel}`)
    }
    // Put the canaries back for the next check.
    for (const entry of this.canaries) {
      if (this.withheld.has(entry.file)) continue
      const file = path.join(this.root, entry.file)
      let bytes: Buffer | undefined
      try {
        bytes = fs.lstatSync(file).isFile() ? fs.readFileSync(file) : undefined
      } catch {
        bytes = undefined
      }
      if (!bytes || !bytes.equals(entry.bytes)) {
        fs.rmSync(file, { recursive: true, force: true })
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.writeFileSync(file, entry.bytes)
      }
    }
    this.baseline = listing(this.root, this.root, this.workspace)
    return findings
  }

  /** Arguments as a report shows them: the root's path as `<root>`, cut to a line. */
  shown(args: unknown): string {
    const text = JSON.stringify(args).replaceAll(this.root, '<root>')
    return text.length > 240 ? `${text.slice(0, 240)}…` : text
  }
}
