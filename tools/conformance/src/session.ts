// One connection to a kit's MCP server over stdio, started in a folder of khp check's own with
// exactly the environment khp check gives it.

import { spawn, type ChildProcess } from 'node:child_process'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { ReadBuffer, serializeMessage } from '@modelcontextprotocol/sdk/shared/stdio.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { CallToolResultSchema, type JSONRPCMessage, type Tool } from '@modelcontextprotocol/sdk/types.js'

export const INITIALIZE_TIMEOUT_MS = 10_000
export const CALL_TIMEOUT_MS = 60_000

export type Content = { type: string; text?: string; data?: string; mimeType?: string }

export interface CallResult {
  isError: boolean
  structured: Record<string, unknown> | undefined
  content: Content[]
  /** Set when the call did not answer: a timeout or a transport failure. */
  failure?: string
}

/** Splits a start command the way a shell would for plain words and quoted arguments. */
export function splitCommand(command: string): string[] {
  const words: string[] = []
  let word = ''
  let quote: string | null = null
  let started = false
  for (const char of command) {
    if (quote) {
      if (char === quote) quote = null
      else word += char
    } else if (char === '"' || char === "'") {
      quote = char
      started = true
    } else if (/\s/.test(char)) {
      if (started || word) words.push(word)
      word = ''
      started = false
    } else {
      word += char
    }
  }
  if (quote) throw new Error(`unclosed ${quote} in the start command`)
  if (started || word) words.push(word)
  return words
}

export interface StartOptions {
  argv: string[]
  /** The server's current folder. */
  cwd: string
  /** The server's whole environment: nothing else is inherited. */
  env: Record<string, string>
}

/**
 * MCP over a child's stdin and stdout, like the SDK's stdio transport except that the child gets
 * exactly `env`: the SDK's transport adds variables of khp check's own environment (HOME, USER,
 * SHELL, and on Windows APPDATA and others), which would point the kit at the real home folder.
 */
class ExactStdioTransport implements Transport {
  private child: ChildProcess | undefined
  private readonly buffer = new ReadBuffer()
  onclose?: () => void
  onerror?: (error: Error) => void
  onmessage?: (message: JSONRPCMessage) => void
  private readonly options: StartOptions

  constructor(options: StartOptions) {
    this.options = options
  }

  start(): Promise<void> {
    const [command, ...args] = this.options.argv
    return new Promise((resolve, reject) => {
      const child = spawn(command as string, args, { cwd: this.options.cwd, env: this.options.env, stdio: ['pipe', 'pipe', 'ignore'], shell: false, windowsHide: true })
      this.child = child
      child.on('error', (error) => {
        reject(error)
        this.onerror?.(error)
      })
      child.on('spawn', () => resolve())
      child.on('close', () => {
        this.child = undefined
        this.onclose?.()
      })
      child.stdin?.on('error', (error) => this.onerror?.(error))
      child.stdout?.on('data', (chunk: Buffer) => {
        this.buffer.append(chunk)
        for (;;) {
          let message: JSONRPCMessage | null
          try {
            message = this.buffer.readMessage()
          } catch (error) {
            this.onerror?.(error as Error)
            continue
          }
          if (message === null) break
          this.onmessage?.(message)
        }
      })
    })
  }

  send(message: JSONRPCMessage): Promise<void> {
    return new Promise((resolve, reject) => {
      const stdin = this.child?.stdin
      if (!stdin) return reject(new Error('the kit server is not running'))
      if (stdin.write(serializeMessage(message))) resolve()
      else stdin.once('drain', resolve)
    })
  }

  async close(): Promise<void> {
    const child = this.child
    this.child = undefined
    if (child) {
      const closed = new Promise<void>((resolve) => child.once('close', () => resolve()))
      const wait = (ms: number) => Promise.race([closed, new Promise<void>((resolve) => setTimeout(resolve, ms).unref())])
      child.stdin?.end()
      await wait(2000)
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM')
        await wait(2000)
      }
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    }
    this.buffer.clear()
  }
}

export class KitSession {
  private readonly client: Client
  readonly tools: Tool[]
  readonly serverVersion: { name: string; version: string } | undefined
  readonly instructions: string | undefined
  /** Every tool result in the order the server answered, for the containment checks. */
  readonly results: { name: string; args: Record<string, unknown>; result: CallResult }[] = []

  private constructor(client: Client, tools: Tool[], serverVersion: { name: string; version: string } | undefined, instructions: string | undefined) {
    this.client = client
    this.tools = tools
    this.serverVersion = serverVersion
    this.instructions = instructions
  }

  static async start(options: StartOptions): Promise<KitSession> {
    if (!options.argv[0]) throw new Error('the start command is empty')
    const transport = new ExactStdioTransport(options)
    const client = new Client({ name: 'khp-check', version: '0.1.0' })
    await withTimeout(client.connect(transport), INITIALIZE_TIMEOUT_MS, 'initialize')
    const tools: Tool[] = []
    let cursor: string | undefined
    do {
      const page = await withTimeout(client.listTools(cursor ? { cursor } : {}), CALL_TIMEOUT_MS, 'tools/list')
      tools.push(...page.tools)
      cursor = page.nextCursor
    } while (cursor)
    return new KitSession(client, tools, client.getServerVersion(), client.getInstructions())
  }

  tool(name: string): Tool | undefined {
    return this.tools.find((tool) => tool.name === name)
  }

  /** Calls a tool without the SDK's own output validation, so khp check reports it itself. */
  async call(name: string, args: Record<string, unknown>, timeoutMs = CALL_TIMEOUT_MS): Promise<CallResult> {
    const result = await this.answer(name, args, timeoutMs)
    this.results.push({ name, args, result })
    return result
  }

  private async answer(name: string, args: Record<string, unknown>, timeoutMs: number): Promise<CallResult> {
    try {
      const result = await withTimeout(
        this.client.request({ method: 'tools/call', params: { name, arguments: args } }, CallToolResultSchema, { timeout: timeoutMs }),
        timeoutMs + 1000,
        `tools/call ${name}`,
      )
      return {
        isError: result.isError === true,
        structured: result.structuredContent as Record<string, unknown> | undefined,
        content: result.content as Content[],
      }
    } catch (error) {
      return { isError: true, structured: undefined, content: [], failure: error instanceof Error ? error.message : String(error) }
    }
  }

  async resources(): Promise<{ uri: string; mimeType?: string }[]> {
    try {
      const listed: { uri: string; mimeType?: string }[] = []
      let cursor: string | undefined
      do {
        const page = await withTimeout(this.client.listResources(cursor ? { cursor } : {}), CALL_TIMEOUT_MS, 'resources/list')
        listed.push(...page.resources)
        cursor = page.nextCursor
      } while (cursor)
      return listed
    } catch {
      return []
    }
  }

  async readResource(uri: string): Promise<{ text: string; mimeType?: string } | undefined> {
    try {
      const read = await withTimeout(this.client.readResource({ uri }), CALL_TIMEOUT_MS, 'resources/read')
      const first = read.contents[0]
      if (!first || !('text' in first) || typeof first.text !== 'string') return undefined
      return { text: first.text, mimeType: first.mimeType }
    } catch {
      return undefined
    }
  }

  async close(): Promise<void> {
    await this.client.close().catch(() => undefined)
  }
}

export async function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not answer within ${ms / 1000} s`)), ms)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    clearTimeout(timer)
  }
}
