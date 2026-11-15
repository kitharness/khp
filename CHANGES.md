# Changes

## KHP 1.1, edition 2026.11 (draft)

- Add harness conformance to [spec/conformance.md](spec/conformance.md):
  `khp check --harness "<adapter command>"`, adapter configuration,
  scripted turns, evidence, and scoped reports. This minor version is
  additive; existing kit requirements and tiers remain unchanged.
- Check mount-time runtime designation (A58) and model-visible tool exports
  (A14). Scripted checks cover session logging (A10, A30), authorized
  previews (A39), explicit diagnostic fixes (A21), drafts, errors, file
  handling (A42, A43), and bounded calls with crash restart.
- Report unobservable duties as **not checked**. Scripted replay does not
  establish model reasoning, native tool semantics, approval UI behavior,
  or runtime privacy from unrelated child processes.

## KHP 1.0 (initial protocol)

KHP defines how an AI agent uses a kit through MCP. The specification is
[spec/agent.md](spec/agent.md), [spec/manifest.md](spec/manifest.md), and
[spec/conformance.md](spec/conformance.md), introduced by
[spec/index.md](spec/index.md). Implementation-specific data models,
editors, hosts, embedding, and sync are outside its scope.

- Define tools, parameter schemas, canonical JSON results, previews,
  diagnostics, structured errors, and the MCP binding.
- Define workspace containment, file parameters, file-write records,
  attribution, session logging, person-approved draft merge/discard,
  atomic runs, and edits that address only their intended changes.
- Define stable addresses and ids, index bases, actionable errors,
  command discovery, saved edits, inspect content, requested previews,
  outside-change notification, and persistent part ids (A46-A57).
- Define a harness-designated private runtime folder (A58), safe link
  reporting (A42), and the manifest's `agent.links` declaration (K21).
- Define the minimal manifest, its MCP resource, and the basic,
  Agent-ready, and Agent-ready complete conformance tiers.

### Retired ids

Never reused: A8, A17, A20, A23, D1 to D4, K3, K6 to K15, K18, and every id
outside the A and K series that earlier drafts held (CS, M, P, E, H, U, FA,
LR, PV, OP, LK, HC-P, PT, EM, OM, EX, DR, UI-). The retired requirements
concerned implementation-specific contracts outside KHP.

### The former `standard` field

The manifest field `khp` was named `standard` before edition 2026.10; a
manifest that still has `standard` is invalid (there is no alias).
