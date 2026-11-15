# The kit manifest

What an agent, a harness, or a catalogue reads to learn what a kit opens,
creates, exports, offers to agents, and which tier it claims, without
running it. KHP's manifest is minimal; an implementation MAY add fields of
its own, which KHP ignores.

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are to be read as
described in RFC 2119.

```json
{
  "khp": "1.0",
  "id": "com.acme.gantt",
  "name": "Gantt",
  "version": "0.3.0",
  "formats": [
    { "id": "gantt", "extensions": ["gantt"], "mime": "application/vnd.acme.gantt+json", "role": "edit" }
  ],
  "creates": [
    { "id": "plan", "extension": "gantt", "baseName": "Untitled plan" }
  ],
  "exports": [
    { "extension": "pdf", "mime": "application/pdf" }
  ],
  "agent": { "prefix": "gantt", "drafts": true, "objectModel": false, "layout": true },
  "level": "agent-ready"
}
```

| Field | Meaning |
| --- | --- |
| `khp` | The KHP version the kit follows (K2) |
| `id` | The kit's identifier (K1) |
| `name`, `version` | A name for people, and the kit's own version (semver) |
| `formats` | The files the kit opens: `{ id, extensions, mime?, role }`, `role` `edit` (opens and saves in place, K4) or `view` (opens read-only) |
| `creates` | The new files `<prefix>_create` makes: `{ id, extension, baseName?, size? }` (A41) |
| `exports` | The formats `<prefix>_export` writes, new files only: `{ extension, mime? }` (K5, A41) |
| `agent.prefix` | The tool prefix: `gantt` gives `gantt_inspect`, `gantt_run`, ... (A2) |
| `agent.drafts` | `true` when the kit supports drafts and offers the draft tools (A12, A35); default `false` |
| `agent.objectModel` | `true` when the kit has an object model and offers `<prefix>_query` and `<prefix>_batch` (A16, A35); default `false` |
| `agent.layout` | `true` for a layout kit (A40); default `false` |
| `agent.links` | `true` when the kit's documents can link or embed other files by reference: it reports their links in `<prefix>_inspect` (A42) and ships the `links-outside` conformance fixture (K21); default `false` |
| `level` | The tier the kit claims (K19) |

Requirements:

- **K1** `id` MUST be a reverse-domain-style identifier unique to the kit
  (`kit.<name>` is reserved for kits published by the protocol's maintainer;
  others use their own domain, `com.acme.gantt`).
- **K2** `khp` MUST name the KHP version the kit conforms to, as
  `major.minor`: the version stated at the top of the [index](index.md).
- **K4** Every extension in `formats` with role `edit` is a file the kit
  owns: it opens it and saves it in place.
- **K5** Every extension in `exports` is a file the kit writes as a new file
  only. A kit MUST NOT let an export replace an existing file (A29, A41).
- **K16** *(proposed; Agent-ready)* The manifest of a kit that claims
  Agent-ready or Agent-ready complete MUST have `agent.prefix` and `level`,
  and MUST set `agent.objectModel` and `agent.layout` truthfully, since they
  decide which tools and answers `khp check` requires (A35, A40).
- **K17** *(proposed; Agent-ready)* The package of an Agent-ready kit MUST
  contain `agent/checks.json`, its check catalogue (A38), beside `kit.json`,
  and SHOULD contain `agent/guide.md`: a short guide for models, saying what
  the kit's commands are for and how to write its content, with two worked
  examples. The guide is required at tier Agent-ready complete.
- **K19** *(proposed)* `level` names the tier the kit claims: `basic`,
  `agent-ready`, or `agent-ready-complete` ([`agent.md`](agent.md) section
  10), so an agent knows what it can rely on without running tests. A
  missing `level` means `basic`, and an unknown value is read as `basic`.
  A kit MUST NOT claim a tier it does not pass with `khp check`
  ([conformance](conformance.md)); a published kit SHOULD publish the
  conformance report of the tier it claims.
- **K20** *(proposed)* The manifest is shipped twice, with the same content:
  as `kit.json` at the root of the kit's package, and as the MCP resource
  `khp://kits/<id>/kit.json` (`mimeType` `application/json`), listed by
  `resources/list`, so an agent connected to the kit reads it without
  finding a file. A server of several kits serves one resource per kit. The
  catalogue and guide (K17) MAY be served beside it as
  `khp://kits/<id>/agent/checks.json` and `khp://kits/<id>/agent/guide.md`.
- **K21** *(proposed)* `agent.links` MUST be `true`, at every tier, when the
  kit's documents can link or embed other files by reference: wikilinks,
  embeds, cards, linked media and images, external references. A kit that
  sets it reports its documents' links in `<prefix>_inspect` (A42), and its
  conformance fixtures include `links-outside.<ext>`
  ([conformance](conformance.md)). A kit whose documents link nothing omits
  it or sets it `false`, and its `<prefix>_inspect` then answers no links.

Retired K ids are listed in [CHANGES.md](../CHANGES.md) and never reused.
