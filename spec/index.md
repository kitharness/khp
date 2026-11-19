# Kit Harness Protocol (KHP)

| | |
| --- | --- |
| Version | KHP 1.1, edition 2026.11, draft |
| Kit layer | 1.0: the version a kit names in its manifest's `khp` (K2) |
| Status | Open-source protocol draft |
| Home | [github.com/kitharness/kitharness](https://github.com/kitharness/kitharness); npm `@kitharness/*`; [kitharness.org](https://kitharness.org) |
| Maintainer | Kition (kition.ai). The protocol is meant to move to a neutral foundation later |

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are to be read as
described in RFC 2119.

## 1. The harness for real files

A coding agent can do real work because its harness gives the model an
environment: it reads the code, edits it, runs it, tests it, and rolls back
what went wrong. Slides, spreadsheets, documents, PDFs, images, video
projects, and drawings have no such environment. Their formats are made for
storage, their computing and layout are locked inside desktop applications,
and nothing tells an agent whether its edit was right.

A **kit** is the harness for one kind of file. It gives an AI agent five
capabilities on a real file:

| Capability | For code | For a file, through a kit |
| --- | --- | --- |
| **Observe** | Read the source | The document as JSON, typed objects, rendered previews |
| **Act** | Edit, run a shell | Commands with parameter schemas; batches of object edits |
| **Execute** | Compiler, runtime | The kit's own engine recalculates, lays out, and renders |
| **Verify** | Tests, type checks | Diagnostics the kit reports about the document |
| **Recover** | Branches, revert | Drafts a person reviews and merges |

KHP says only how an AI uses a kit, and it is as thin as MCP, on which it
is bound: **a kit is an MCP server that follows KHP's tool conventions**. It
defines the tools, their arguments and results (the document as JSON,
previews, diagnostics, error codes), the rules every kit and harness keeps
(only a person merges or discards; an agent's edits are attributed to the
person who started it, or kept apart in drafts; how file parameters are resolved; every call is
logged), a minimal manifest, the tiers, and the conformance tests. How a kit
is built inside (its engine, data model, editor, or storage) is its own.

## 2. Roles

| Role | What it is |
| --- | --- |
| **Kit** | An MCP server for one kind of file (or a server of several kits), started on a workspace folder, with a manifest (`kit.json`) |
| **Agent harness** | Runs a model, its tools, and its loop, and connects to kits over MCP: Claude Code, Codex, DeepSeek Harness, Kition's agent, or anyone's own |
| **Person** | Starts the agent, reviews its drafts, and merges or discards them |

## 3. The text

| Page | Read it to |
| --- | --- |
| [agent.md](agent.md) | Know the tools, their arguments and results, diagnostics and errors, drafts, the rules, the MCP binding, and the tiers |
| [manifest.md](manifest.md) | Read or write a kit's manifest, including its `level` |
| [conformance.md](conformance.md) | Test a kit or agent harness with `khp check` and write its conformance report |

### 3.1 Tiers

| Tier | `level` | In short |
| --- | --- | --- |
| **Basic** | `basic` | `<prefix>_inspect`, `_commands`, `_run`, `_check` (it may answer an empty list); a schema for every agent-facing command; structured errors; the safety rules. No object model and no real preview needed; drafts may work in file mode. Wrapping an existing file library is enough |
| **Agent-ready** | `agent-ready` | Works with no editor open; real previews and checks with a catalogue; create and export; `_query` and `_batch` when the kit has an object model; no network |
| **Agent-ready complete** | `agent-ready-complete` | The layout answer for paginated kits; a guide for models; edits that address only what they change, by id, name, or path (A44); runs sandboxed |

### 3.2 Versions and editions

- KHP is versioned `major.minor`. A minor version only adds members (a
  tool, an optional argument, an error code, a diagnostic field); a change
  that removes or changes a member bumps the major version.
- An **edition** is a dated release of the text. The version, kit-layer
  version, and edition of this text are stated once, in the table at the
  top of this page; rule ids are kept and never reused.
- The **kit-layer version** is the version of KHP's requirements on kits:
  the rules a kit keeps, the manifest, the tiers, and the kit checks of
  `khp check`. It is the KHP version that last added or changed one of
  them, so it can be lower than the KHP version: KHP 1.1 adds only harness
  conformance, so its kit-layer version is 1.0.
- A kit names the kit-layer version it follows in its manifest's `khp` (K2)
  and the tier it claims in `level` ([manifest](manifest.md)). Agents rely
  on those, never on a kit's product version.

## 4. One example

An integrator's agent, in Claude Code, works on a project plan through a
Gantt kit that wraps an existing scheduling library:

1. The person registers the kit as an MCP server started on the project
   folder with drafts on (`acme-gantt-kit --workspace . --drafts`). The
   agent reads the resource `khp://kits/com.acme.gantt/kit.json`: the kit is
   `agent-ready`, with drafts and a layout.
2. The agent calls `gantt_inspect` on `plan.gantt`, finds the tasks with
   `gantt_commands`, and moves three of them with `gantt_run`, in a draft
   beside the file (file mode). It calls `gantt_check`, which reports
   `gantt.dependency-cycle` with a `fix` hint; it runs the fix, checks again
   (no errors), looks at `gantt_inspect`'s preview of the changed weeks, and
   calls `gantt_draft_ready`.
3. The person compares the draft's summary and rendering with the file in
   whatever tool their setup gives them and merges it. The file had not
   changed meanwhile, so the merge writes the draft over it; otherwise it
   would be refused as `stale`.

## 5. Map of this repository

| Path | What |
| --- | --- |
| [`spec/index.md`](index.md) | This page |
| [`spec/agent.md`](agent.md) | Tools, results, rules, the MCP binding, tiers |
| [`spec/manifest.md`](manifest.md) | The minimal manifest |
| [`spec/conformance.md`](conformance.md) | `khp check` and the conformance report |

### 5.1 Where each requirement lives

| IDs | Page |
| --- | --- |
| A1–A7, A9–A16, A18, A19, A21, A22, A24–A58 | [agent.md](agent.md) |
| K1, K2, K4, K5, K16, K17, K19, K20, K21 | [manifest.md](manifest.md) |

Ids that are not listed here were retired; [CHANGES.md](../CHANGES.md)
lists them, and they are never reused.

## 6. Implementations

Kition (kition.ai) is the reference implementation: its kits are KHP kits,
served by its kits MCP server. How Kition builds its kits and hosts them is
documented as the **Kition kit platform** with the Kition SDK, not here, and
none of it is required of a KHP kit.

## 7. Naming history

| Date | Old name | New name |
| --- | --- | --- |
| 2026-10-21 | Kit Standard | Kit Harness Protocol (KHP) |
| 2026-10-21 | Manifest field `standard` | Manifest field `khp` (K2), with no alias |
| 2026-10-22 | `KitAgent 1.4` and the capability sets, protocols, and kit contracts around it | KHP, narrowed to the AI layer; the rest became the Kition kit platform |

The repository's public name is `kitharness/kitharness`.
