// The deterministic adapter contract; it is independent of a model provider.
export interface HarnessTurn {
  id: string
  server: string
  name: string
  args: Record<string, unknown>
  failure?: 'timeout' | 'crash' | 'denied' | 'unsupported'
  /** Optional native harness action; explicitly report unsupported when absent. */
  optional?: boolean
}

export interface HarnessConfig {
  format: 1
  workspace: string
  servers: { id: string; command: string; args: string[] }[]
  evidence: string
  script?: string
  callTimeoutMs: number
}

export interface HarnessEvidence {
  format: 1
  /** All tools offered to the model, including native harness tools. */
  tools: string[]
  /** Omit when the harness keeps no session log or cannot export it. */
  log?: { server: string; name: string; args: Record<string, unknown>; result: unknown }[]
  /** Every preview context attachment, with its source and exact MCP image block. */
  attachments?: { path: string; content: unknown }[]
  /** Preview entries saved in the session's model-context transcript. */
  contextLog?: { path: string; content: unknown }[]
  /** Completed scripted turns, in order, including timeout/crash recovery. */
  turns?: { id: string; failure?: HarnessTurn['failure'] }[]
}

export function harnessTurns(): HarnessTurn[] {
  const call = (id: string, name: string, args: Record<string, unknown>, failure?: HarnessTurn['failure']): HarnessTurn =>
    ({ id, server: 'primary', name: `probe_${name}`, args: { path: 'given.probe', ...args }, ...(failure ? { failure } : {}) })
  return [
    call('observe', 'inspect', { preview: true, layout: true }),
    call('edit', 'run', { steps: [{ command: 'text.set', params: { text: 'Edited' } }], draft: true }),
    call('verify', 'check', { draft: true }),
    call('ready', 'draft_ready', {}),
    call('reopen', 'draft_reopen', {}),
    call('deny-merge', 'merge', {}, 'denied'),
    call('deny-discard', 'discard', {}, 'denied'),
    call('error', 'run', { steps: [{ command: 'unknown' }], draft: true }),
    call('explicit-fix', 'run', { steps: [{ command: 'text.fix' }], draft: true }),
    call('export', 'export', { to: 'created.probe', draft: true }),
    { id: 'move', server: 'harness', name: 'move', args: { from: 'linked.probe', to: 'renamed.probe', editable: ['links-a.probe', 'links-b.probe', 'linked.probe'] }, optional: true },
    call('hang', 'inspect', { target: { path: 'hang' } }, 'timeout'),
    call('crash', 'inspect', { target: { path: 'crash' } }, 'crash'),
    call('after-crash', 'inspect', {}),
  ]
}
