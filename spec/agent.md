# KHP: tools, results, and rules

For anyone who makes a kit that AI agents use, and for any agent harness that
uses one. A **kit** is an MCP server that follows the tool conventions of
this page for one kind of file. The agent works through the kit's own engine,
and what it changes is checked, logged, and, when it works on a draft,
merged only by a person.

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are to be read as
described in RFC 2119. Requirements marked *(proposed)* are new in this
draft and not yet implemented by any kit.

KHP 1.0 is the first public version, narrowed on 2026-10-22. How it grew from earlier
drafts is recorded in [CHANGES.md](../CHANGES.md).

## 1. Tools

Every kit offers the same document tools, whatever its command set. `<prefix>`
is the kit's `agent.prefix` in its manifest (`slide`, `sheet`, `photo`;
[manifest](manifest.md)).

| Tool | Capability | Does |
| --- | --- | --- |
| `<prefix>_inspect` | Observe | The document as JSON, plus an optional rendered preview |
| `<prefix>_query` (optional, A16) | Observe | Reads objects by id or by following fields, with selected fields |
| `<prefix>_commands` | Act | The agent-facing commands and whether each can run now |
| `<prefix>_run` | Act | Runs a list of command steps |
| `<prefix>_batch` (optional, A16) | Act | Runs one batch of object-model operations |
| `<prefix>_check` | Verify | What is wrong with the document, as diagnostics |
| `<prefix>_create` (A41) | Act | Makes a new file of a kind the kit's manifest `creates` |
| `<prefix>_export` (A41) | Act | Writes the document to a new file in a format of the manifest's `exports` |
| `<prefix>_hit` (optional, A32) | Observe | The objects under a point of a preview or of the document |
| `<prefix>_draft_ready`, `<prefix>_draft_reopen` | Recover | Ask the person to review the agent's draft, or take it back to edit (A12) |

Which tools a kit MUST offer depends on its tier (section 10): a basic kit
offers `<prefix>_inspect`, `<prefix>_commands`, `<prefix>_run`, and
`<prefix>_check` (A3, A22), and the draft tools when it declares drafts
(A35).

### 1.1 Arguments

Every tool names its document by `path`, relative to the workspace the kit
server was started on. `draft: true` works on the agent's draft instead of
the document itself (section 6); without it a tool follows the server's
mode.

| Tool | Arguments | Answers |
| --- | --- | --- |
| `<prefix>_inspect` | `path`, `preview?` (default `false`, A55), `target?` (A24, A24a, A39, A57), `scale?` and `maxSize?` (A39), `layout?` (A40), `limit?` and `cursor?` (A25), `draft?` | The document as JSON, with its content and addresses (A52); a rendered preview as image content of the result; with `layout: true`, the layout (A40); when the document is open in an editor that reports it, the person's `selection` (A33) |
| `<prefix>_hit` | `path`, `x`, `y`, `space?` (`preview`, the default, or `document`), `page?`, `target?`, `scale?`, `maxSize?`, `draft?` | `{ hits: [{ id, type?, bounds, page? }] }`, topmost first (A31) |
| `<prefix>_query` | `path`, `objects?` (ids; `root` is the root, the default), `follow?` (a field path from the first object: field names and list or tree positions joined with dots, `slides.0.shapes`), `fields?`, `limit?`, `describe?` (`true`, a type name or names, or `"*"`: also answer the object types, A16a), `draft?` | The objects read |
| `<prefix>_commands` | `path`, `query?` (keywords to match in a command's id, title, description, or keywords, A5c), `detail?` (default `false`), and without a query `cursor?` and `limit?` | Matching commands, or the nearest when none match (A49), or every command a page at a time (A5a, A5b), and whether each can run now |
| `<prefix>_run` | `path`, `steps` (1 to 50 of `{ command, params? }`), `target?` (the part the steps act on, as `<prefix>_inspect` takes it, A54), `preview?` (default `false`, A54), `save?` (default `true`; a draft is never saved), `draft?` | The steps' results; a failed run changes nothing (A53) |
| `<prefix>_batch` | `path`, `ops` (operations on the kit's object model, A16), `load?` (objects to read back after the batch: `{ target, fields? }`), `save?`, `draft?` | The batch's result |
| `<prefix>_check` | `path`, `draft?` | `{ diagnostics }` and a summary (A22) |
| `<prefix>_create` | `path` (the new file), `kind?` (the `id` of a `creates` entry), `from?` (a template file to start from), `size?` | `files` (A30) |
| `<prefix>_export` | `path` (the document), `to` (the new file), `format?` (an `exports` extension; default the extension of `to`), `options?`, `draft?` | `files` (A30) |
| `<prefix>_draft_ready`, `<prefix>_draft_reopen` | `path` | The draft's state |

Every tool's input and output (its `structuredContent`) MUST be published as
JSON Schema: the inputs exactly as `tools/list` offers them, and the outputs
as each tool's `outputSchema`. A failed call answers `error` (A18), and every
`outputSchema` MUST accept that error result too (A18).

### 1.2 Tool definitions

- **A1** A kit's agent-facing commands MUST be exposable as tools. A tool
  definition has a `name`, a `description`, `parameters`
  (`ParameterSchemaSpec`, section 1.3), and an `output.schema`
  (`ValueSchemaSpec`); the MCP binding maps them to `inputSchema` and
  `outputSchema` (section 8).
- **A2** Tool names MUST be `<prefix>_<command>` with dots and other
  characters outside `[A-Za-z0-9_]` replaced by `_` (`film_timeline_razor`),
  so they are valid in every model provider's tool namespace.
- **A4** Tool output MUST be one canonical JSON value per call: in MCP, the
  result's `structuredContent`.

> *Note (non-normative).* A harness that draws tool cards may keep display
> hints beside a tool definition (how to show the result, pure functions that
> present a call and its result) and display-only data beside a result (such
> as a `presentationMeta` derived purely from the arguments and the result,
> so replays reproduce the same cards). Neither is part of KHP, and the MCP
> binding has no place for them.

### 1.3 Parameter schemas

- **A5** Command parameter schemas MUST use `ParameterSchemaSpec`: an object
  of named properties, each a `ValueSchemaSpec` (`string`, `number`,
  `integer`, `boolean`, `null`, `array`, `object` with explicit
  `additionalProperties`, `json`, `oneOf`, or `file`, A28), marked `required: true` when
  required, with `description`, `enum`, and `default` where they apply.
  `json` is any JSON value. For example:

  ```json
  {
    "x": { "type": "integer", "required": true, "description": "Column, from 0." },
    "mode": { "type": "string", "enum": ["fill", "fit"], "default": "fit" },
    "style": { "type": "object", "additionalProperties": true }
  }
  ```

  A binding that needs JSON Schema (MCP's `inputSchema`) converts it: the
  object becomes `properties`, the properties marked `required` become
  `required`, and `json` becomes a schema without `type`.
- **A5a** *Listing commands.* `<prefix>_commands` answers each command in
  one of two forms.
  - **Compact** (the default): `id`, `title`, `enabled` when the command
    cannot run now (`false`), the first sentence of its description when it
    has one, its parameters as one line (`params`, a string naming each
    parameter, `?` after an optional one, then its type or its values joined
    with `|`, for example `{text: string, align?: left|center|right}`), and,
    for a command that answers a result, the result's shape (`returns`, one
    line, or `output`, its schema).
  - **Full**: `id`, `title`, `enabled` as above, `params` as the command's
    `ParameterSchemaSpec` in its JSON Schema form (A5), its whole
    `description`, and its result schema (`output`) when the kit declares
    one.
  A kit MUST answer the full form for every listed command when the call
  passes `detail: true`, and for a command whose id is the whole `query`.
  It MAY answer the compact form otherwise. The compact form names the
  parameters; it never replaces the schema, which A6 still requires and
  `<prefix>_run` still checks against.
- **A5b** *Every command.* A call without `query` (or with an empty one)
  lists every agent-facing command, ordered by id, in pages: `limit`
  commands a page (the kit chooses the default; it MUST accept any `limit`
  from 1 to 200), the page starting at `cursor` (absent for the first page).
  The answer carries `total`, the number of agent-facing commands, and
  `next`, the `cursor` of the following page, while more follow. A
  `cursor` the kit did not give is an `invalid-params` error (A18). With a
  query, a kit MAY answer only the best matches.
- **A5c** *What a query matches.* A query matches a command by the words of
  its id, title, and description, and by the command's `keywords` when the
  kit gives it any (the names of the effects, fonts, or templates one
  command applies, words a person would search for): a search for
  `gaussian blur` finds `effect.apply` when `Gaussian Blur` is one of its
  keywords. A row found by its keywords SHOULD say which keywords matched
  (`matched`).
- **A6** A command carries its schema in its definition. An agent-facing
  command without a schema MUST NOT be exposed as a tool or listed by
  `<prefix>_commands` as runnable.

### 1.4 File parameters

A command that reads, creates, or replaces files other than its document
names them with parameters of the type `file`.

```json
{
  "files": { "type": "array", "items": { "type": "file", "access": "read", "accept": ["pdf"] }, "required": true,
             "description": "PDFs to append, in order." },
  "to":    { "type": "file", "access": "create", "accept": ["png", "jpg", "webp"],
             "description": "The image to write, a new file." }
}
```

- **A28** *(proposed)* A command parameter that names a file MUST be typed
  `file`, with `access` (`read`, `create`, or `write`) and `accept` (the
  extensions, without the dot); `kind: "folder"` names a folder (`access`
  `read` only). A command whose parameters name files without this type
  MUST NOT be exposed to agents: the type replaces every guess a binding
  made from parameter names.
- **A29** *(proposed)* In JSON Schema a `file` parameter is
  `{ "type": "string", "x-khp-file": { "access", "accept", "kind" } }`: the
  model gives a path relative to the kit server's workspace, like the `path`
  argument (section 1.1). Before the command runs, the kit server resolves
  each path and MUST refuse one that:
  - resolves outside the workspace, through `..`, a symbolic link, or
    otherwise (the kit server's private runtime folder, A58, included);
  - has a segment that starts with a dot (hidden folders and files such as
    `.git/` or `.env`), or names the data the server or its host keeps for
    itself;
  - has an extension outside the parameter's `accept`.

  It refuses such a path the same way whether the file exists or not, so a
  model cannot probe for it. A refused path fails the whole call with
  `not-allowed` (A18) and the `index` of the step; nothing runs. A `create`
  parameter names a new file: the server picks an unused name when the path
  exists (`Report 2.pdf` beside `Report.pdf`) and never replaces a file. A
  `write` parameter on an existing file other than the document the call
  targets runs only through a draft beside that file (A27) or after the
  person approves it. How the kit's engine then receives the file (a path,
  bytes, or a handle) is the kit's own.
- **A30** *(proposed)* A tool result that created or replaced files lists
  them as `files: [{ path, version, created }]`, paths relative to the
  workspace, so the model can inspect them next. A harness MUST record them
  in its session log (A10) and SHOULD show them to the person.

### 1.5 Addresses, ids, and indexes

Tool addresses, ids, and indexes have the following contracts.

- **A46** *Addresses are absolute.* Every address a tool answers or takes
  (an object id, a page, slide, sheet, layer, track, cell, range, or
  paragraph) MUST mean the same thing whatever the session's state: it
  never depends on a current page, slide, or sheet, on the selection, or on
  an earlier call. An address `<prefix>_inspect`, `<prefix>_query`, or a
  diagnostic's `target` (A21) answers MUST work unchanged in the steps of
  `<prefix>_run` and the operations of `<prefix>_batch`, in this call or a
  later one. A kit whose engine resolves an address against a current part
  (an id unique only within its slide) MUST resolve it itself: it takes the
  part in the address, or as the run's `target` (A54), and never runs a
  step against whatever part happens to be current.
- **A47** *One id space.* At the tool interface a document has one id space:
  the same object has the same id in `<prefix>_inspect`, `<prefix>_query`,
  diagnostics, `<prefix>_hit`, the steps of `<prefix>_run`, and
  `<prefix>_batch`. A kit whose engine keeps several (its model's object
  ids, ids of the file format, display numbers) converts between them at
  the tool interface. Every parameter that takes an id says in its
  description which objects' ids it takes (a shape's, a slide's, a
  layer's).
- **A51** *Indexes state their base.* Every integer parameter or result
  field that counts positions (pages, slides, rows, columns, paragraphs,
  list items, frames) MUST say in its schema's description whether it
  counts from 0 or from 1. KHP's own fields count as follows: `page` and
  `slide` from 1 (A21), a step's or an operation's `index` (A18), list
  positions in `follow` (section 1.1), and `paragraphs` (A24a) from 0.

## 2. Observe

- **A3** *(observe part)* Every kit MUST offer `<prefix>_inspect`: the
  document as JSON, plus an optional rendered preview. An Agent-ready kit's
  preview is required and real (A39).
- **A16** *(observe part)* A kit that has an **object model** (typed objects
  with stable ids that the kit can read and change one by one; manifest
  `agent.objectModel` in the [manifest](manifest.md)) MAY offer `<prefix>_query`, which reads
  objects by id (`root` for the root object) or by following fields from the
  root (`follow: "slides.0.shapes"`) with selected fields. With
  `describe` it also answers the object types (A16a), and its argument
  schema SHOULD name the types and fields as enums. It is required for an
  Agent-ready kit that has an object model (A35).
- **A16a** *Describing the types.* `describe` takes three forms:
  `true` answers every object type with its fields, one line each; a type
  name, or several joined with commas (`"Paragraph,Run"`), answers those
  types in full; `"*"` answers every type in full and their JSON Schema. A
  type name the kit does not have is a `not-found` error (A18) that lists
  the kit's type names (A48).
- **A19** *Resources.* A kit MAY serve a document's objects as MCP
  resources: `kit://<document>/describe` (the object model) and
  `kit://<document>/objects/<id>`, with `resources/templates/list` naming
  both. `<document>` is the document's path as one percent-encoded segment.
  The kit's manifest is a resource too (K20).
- **A24** *(proposed) Previews of a target.* `<prefix>_inspect` SHOULD take
  an optional `target` (the shape of a diagnostic's target, section 5) and
  render only that page, slide, sheet range, or object, so a vision model can
  compare before and after an edit without the whole document. It is
  required for an Agent-ready kit (A39).
- **A24a** *Targets that list content.* A kit whose documents are
  spreadsheets SHOULD also take `target: { range, sheet? }` (a range in A1
  notation, of `sheet` or of the first sheet), and answer the values of those
  cells under their column letters and row numbers. A kit whose documents
  are text SHOULD also take `target: { paragraphs: [from, to] }` (counted
  from 0, both included) and answer those paragraphs with their index,
  style, and text. Either answer says, when it is cut (A25), which `target`
  shows the rest.
- **A52** *Inspect shows content with addresses.* Every kit's
  `<prefix>_inspect` MUST answer the document's content, not only its
  layout or a summary, each part with the address A46 says the other tools
  take: a slide's objects with their ids, types, and text; a sheet's cells
  under their column letters and row numbers; a text document's paragraphs
  with their index. An agent never has to guess an object model's field
  names to find what the document says. A large document is answered a part
  at a time (A24a, A25).
- **A25** *(proposed) Size budget.* `<prefix>_inspect` and `<prefix>_query`
  SHOULD take a `limit` and answer a `cursor` when there is more, so a large
  document never overflows a model's context in one answer.
- **A55** *(proposed) Previews on request.* `<prefix>_inspect` attaches a
  rendered preview only when the call passes `preview: true`, and its tool
  description says so.
- **A57** *(proposed) Part ids survive reading.* A kit whose documents have
  parts with ids (slides, pages) MUST give a part the same id each time it
  reads the file, using the id the format stores for it where there is one
  (`p:sldId` in PPTX), so an id an agent read names the same part after
  another program changed the file. `<prefix>_inspect` lists a part's `id`,
  and `target` takes it as `{ slideId }` or `{ pageId }`, which names the
  same part after parts are added, deleted, or moved, where `{ slide: n }`
  names whatever part is n-th by then.

### 2.1 Pointing and selection

What a person means by "this", and what a model means by "the box at 412,
230", become object ids the agent then names explicitly.

- **A31** *(proposed) Hit testing.* A kit MAY answer hit tests: the objects
  under a point, topmost first, with their bounds, at most 32. The point is
  `x`, `y` in a `space`: `preview`, pixels of the image `<prefix>_inspect`
  returned for the same `page`, `target`, `scale`, and `maxSize`; or
  `document`, document units of `page` or the canvas. A hit test changes
  nothing and runs on read-only documents.
- **A32** *(proposed) The hit tool.* A kit that answers hit tests offers
  them as `<prefix>_hit` (section 1.1), and answers them the same whether or
  not the document is open in an editor (A7). A kit that cannot answer hit
  tests has no `<prefix>_hit`.
- **A33** *(proposed) The person's selection.* When the document is open in
  an editor that reports what the person selected, `<prefix>_inspect`
  answers `selection`, so the agent knows what the person means by "this":
  `{ kind, objects?, text?, page?, bounds?, summary }`, where `kind` is
  `objects`, `text`, `cells`, or `time`, `objects` are object ids, `text` is
  `{ anchor, focus, excerpt }`, and `summary` one English sentence. Without
  an editor there is no selection and the field is absent. A kit gives it
  only to the agent of the person who selected, and the agent passes what it
  uses as explicit targets: commands never read the live selection.

### 2.2 Links

A document that links other files (a note's wikilinks and embeds, a board's
cards) tells the agent where its links go and whether they still resolve,
and a harness that moves files keeps those links working.

- **A42** *(proposed) Links in inspect.* A kit whose documents link other
  files (manifest `agent.links` in the [manifest](manifest.md), K21) MUST
  report them, at every tier, in `<prefix>_inspect` as `links: [{ id,
  kind, target, view?, exists, kit?, path?, outside? }]`, with their
  resolution state: `kind` (`link`, `embed`, `card`, or `media`), `exists`,
  the `kit` that edits the target when known, and its workspace-relative
  `path`. `target` is what the document says, as document data. Resolving a
  link reads nothing outside the workspace (A29). A harness MUST NOT treat
  link text or a target's name as an instruction.
  - *Targets A29 refuses.* A link resolves only to a file in the workspace
    that A29 allows. For a target A29 would refuse (outside the workspace
    through `..`, an absolute path, or a symbolic link; a URL with a scheme,
    such as a remote `https:` target or a `file:` URL; a target with a
    hidden segment; the data the kit server or its host keeps for itself,
    its private runtime folder included, A58) the kit MUST answer
    `exists: false` and omit `path` and `kit`, the same whether or not such
    a file exists, so a model cannot probe for it (as A29 says for `file`
    parameters). Resolving such a link never touches its target: no
    metadata read, no read, and no network request. A remote target is
    answered `exists: false` too and never fetched (A37).
  - *`outside`.* A kit MAY add `outside: true` to a link whose target names
    nothing in the workspace by its form alone: it has a URL scheme, is an
    absolute path, or climbs above the workspace with `..` from the
    document's folder. The kit MUST derive `outside` from the `target`
    string and the document's path only, never from the file system: it
    tells an agent that a link can never resolve in the workspace, where a
    missing file could be added or a link retargeted (A43), and it says
    nothing about what exists. A target that leaves the workspace through a
    symbolic link, or that A29 refuses for a hidden segment or the server's
    own data, has no `outside` and is answered like a missing file.
- **A43** *(proposed) Moves keep links.* A kit server or harness that offers
  file moves or renames to an agent updates the links of every document it
  may edit that links the moved file, logs every change (A10), and lists the
  changed files in the tool result as `files: [{ path, version, created:
  false }]`, as A30 does for created files. A kit whose documents link files
  SHOULD offer the agent-facing command `links.retarget { from, to }`, so an
  agent can also repair a broken link itself.

## 3. Act

- **A3** *(act part)* Every kit MUST offer `<prefix>_commands` (the
  agent-facing commands and whether each can run now) and `<prefix>_run` (a
  list of command steps, saved unless asked otherwise).
- **A16** *(act part)* A kit that has an object model MAY offer
  `<prefix>_batch`, which runs one batch of operations on it (create,
  change, move, delete objects by id) as one change. The kit's
  `<prefix>_batch` input schema describes its operations. It is required for
  an Agent-ready kit that has an object model (A35).
- **A11** *Attribution.* A kit that records an edit history or the authors
  of changes MUST attribute an agent's edits to the person who started the
  agent, marked as made by the agent on that person's behalf. A kit that
  records neither keeps an agent's changes apart from the person's through
  drafts (A12; file mode, A27, is enough) or by writing them to a separate
  file (A29, A41).
- **A18** *Structured errors.* A failed tool call answers, beside its
  human message, `error: { code, message, index?, retryable? }`, so a model
  can recover without parsing prose. `code` is one of `invalid-params`,
  `invalid-op`, `invalid-value`, `not-found`, `read-only`, `unknown-command`,
  `command-failed`, `not-open` (the call needs the file open in its editor),
  `draft-required` (the call needs a draft and there is none),
  `not-allowed`, `unsupported`, `unavailable` (`retryable`), and `failed`;
  `index` is the failing step or operation. A failed call leaves the file as
  it was (and, for `<prefix>_run`, the session's document too, A53); its
  message says how to recover (A48). `error` is a top-level field of the result, and every tool's
  output schema MUST accept the error result as well as the normal one:
  either it declares `error` (the shape above) as an optional top-level
  property and none of its result fields as `required`, or it is an object
  schema whose `oneOf` is the result and `{ error }` with `error` required.
  MCP clients validate `structuredContent` against `outputSchema` even when
  `isError` is `true`, so a schema that requires result fields rejects every
  error the tool answers.
- **A45** *(proposed) No prompts.* A tool call MUST run to an answer without
  waiting for a person: it never opens a dialog, picker, confirmation, or
  alert. Input it lacks or must not guess is an `invalid-params` error, and
  a choice it needs is a parameter.
- **A48** *Errors are actionable.* An error's `message` (A18) MUST say what
  was wrong (the step, the parameter, the value), where a right value comes
  from (the tool or field that lists them, or the values themselves when
  there are few: the sheet names, the type names, the ids on that slide),
  and what to call next. "Invalid params" or "not found" alone does not
  conform.
- **A49** *Command search never answers nothing.* A `<prefix>_commands`
  query that matches no command MUST still answer the nearest commands (by
  spelling or by the words of the query), marked as not matching
  (`closest: true`), so an agent never concludes from an empty answer that
  the kit cannot do something. A `<prefix>_run` step with a command id the
  kit does not have answers `unknown-command` (A18) with the nearest
  command ids in its message.
- **A50** *An accepted edit is saved.* A step, operation, or batch that a
  kit answers as done MUST reach the file when the call saves (or the draft,
  A12) and be there when the file is opened again. A kit that cannot write
  an edit to the file (a field its file format does not hold) MUST refuse
  it with an error (A18, A48), never accept it and drop it on saving.
- **A53** *A run is atomic.* `<prefix>_run` applies all its steps or none:
  when a step fails (or saving fails), the document the session works on,
  the open document or the draft, is as it was before the call, with the
  steps before the failing one undone, and nothing is saved. The error
  (A18) gives the failing step's `index`, lists the steps it rolled back
  (`rolledBack`), and answers `completed` empty. A kit that could not roll
  back says so in the error's message and lists the steps that stay in
  `completed`; that is a defect, not a conforming answer.
- **A54** *The run's target.* A kit whose `<prefix>_inspect` takes `target`
  (A24) MUST take the same `target` in `<prefix>_run`: the part the steps
  act on (a slide, a page), so the ids `<prefix>_inspect` listed for that
  part work in the steps whatever part was current (A46). `preview: true`
  attaches a rendered preview of the document after the steps, as
  `<prefix>_inspect` would; without it `<prefix>_run` attaches none.
- **A56** *(proposed) Changes made outside the agent's calls.* A kit server
  that keeps serving one agent MUST notice when a document's file changed
  between two of the agent's calls without going through them (a person's
  editor, another agent, a script). The next `<prefix>_inspect` says so in
  `changedOutside`, an object with what it can tell of the change (for
  example the part count before and after), and the next `<prefix>_run` is refused once: nothing runs, and the
  error (`failed`, `retryable`) says the file changed and that numbers and
  ids the agent noted may now name other parts. The answer also asks the
  agent not to undo changes it did not make.

## 4. Execute

The kit's own engine computes every result: recalculation, layout, and
rendering. An agent never needs the kit's editor, if the kit has one, to be
open (A34).

- **A7** *(where calls go)* When a document a tool call names is open in the
  kit's editor, the kit MUST apply the call to the open document, so the
  person sees it at once and it joins the same undo history, or refuse it
  with `not-open` or `unavailable` (A18); it MUST NOT write the file under
  an editor that holds unsaved edits. Every tool goes where the others go.
- **A26** *(proposed) Determinism.* The same document and the same steps
  MUST give the same document whether the kit runs them with its editor open
  or not.

## 5. Verify

A kit lets an agent check its own output: after editing, the agent asks the
kit what is wrong with the document and fixes what it finds, instead of
trusting that its commands did what it meant.

- **A21** *Diagnostics.* A kit answers what it finds wrong with the
  document as a list of diagnostics, each
  `{ code, severity, target, message, fix? }`:
  - `code` is stable across the kit's versions, `<kit>.<name>` in lowercase
    words with inner hyphens (`sheet.formula-error`,
    `slide.text-overflow`); agents, hosts, and tests match on it, never on
    the message.
  - `severity` is `error` (the document is broken or will not show as
    meant), `warning` (probably not what the author meant), or `info`
    (worth knowing, nothing to fix).
  - `target` is what it is about: `{ objectId?, path?, page?, slide?,
    sheet?, cell? }`, where `objectId` is the object's id in the kit's
    object model, `path` a part, layer, or field path, `page` and `slide`
    count from 1, `sheet` is the sheet's name, and `cell` a cell or range in
    A1 notation. An empty `target` means the whole document.
  - `message` is one English sentence.
  - `fix`, when present, is a command hint `{ command, params? }` that
    `<prefix>_run` takes; a kit or harness MUST NOT run it on its own,
    only as an explicit `<prefix>_run` by the agent or the person.

  Checking MUST NOT change the document (its content, dirty state, and
  history stay as they are) and SHOULD be quick enough to run after every
  agent step. Answers list errors first. A basic kit without checks answers
  an empty list. An Agent-ready kit MUST answer with a real check and a
  catalogue of its codes (A38).
- **A22** *The check tool.* Every kit MUST offer `<prefix>_check` with
  `{ path, draft? }`, answering `{ diagnostics }` and a one-line summary of
  how many errors, warnings, and notes it found. It follows A12
  (`draft: true` checks the agent's draft) and is allowed on read-only
  documents. A kit SHOULD tell the model, in its MCP instructions, to call it
  after editing (section 8).

## 6. Recover

- **A12** *Draft mode.* A kit MAY let an agent edit a **draft** instead of
  the document: a copy of the document as it was when the draft began, edited
  through the same engine and commands. Editing the document directly stays
  the default; the kit server chooses draft mode by its configuration (such
  as a start option) or per tool call (`draft: true`). The draft's state is
  `open` while the agent works on it and `ready` once the agent asks for
  review; **Ready** and **Reopen** (back to `open`) are the agent's calls
  `<prefix>_draft_ready` and `<prefix>_draft_reopen`, and an agent edit on a
  ready draft makes it `open` again. A kit that supports drafts says so in
  its [manifest](manifest.md) (`agent.drafts`).
- **A13** *Comparison.* Before merging, the person sees a comparison of the
  draft with the document as it is now: at least a summary of each side, and
  both sides rendered by the kit's own engine where it renders. A kit with an
  object model MAY compare object by object (`{ created, changed, deleted,
  texts }`: objects as `{ id, type, fields }`, text-like fields as
  `{ id, field, before, after }`, sorted by id).
- **A14** *Merge and discard.* **Merge** takes the draft's changes into the
  document as one change, labelled as the agent's and attributed to the
  person who started it (A11), which the person can undo as one step where
  the kit keeps undo history. A kit merges only when it keeps what changed in
  the document since the draft began (it merges at the level of its object
  model) or when nothing changed (A27); otherwise it refuses as `stale`
  unless the person chooses to overwrite. **Discard** drops the draft and
  leaves the document untouched. Merge and discard MUST require the person's
  explicit approval: a kit or harness MUST NOT offer them as agent tools or
  run them from a model's output. How they are shown to the person (a
  host's review screen, a command line) is not part of KHP.
- **A15** *Drafts stay drafts.* Nothing of a draft reaches the document, or
  anyone else working on it, until it is merged; a draft is merged once and
  then closed.
- **A27** *Drafts beside a file (file mode).* A kit MAY keep an agent's
  draft beside the file, in the workspace, with the file's hash when the
  draft began, holding the draft's bytes. It compares by the two sides'
  summaries and renderings (A13). Merging writes the draft over the file only
  while the file's hash is still the one the draft began from, else it is
  refused as `stale` unless the person overwrites. File mode is enough for
  every tier.

## 7. Policy and the session record

- **A9** A kit MUST apply the same policy to agent calls as to the person's
  edits: unsaved work is never lost, exports and created files never replace
  a file (A29, A41), and nothing reaches outside the workspace (A29).
- **A10** *Session record.* Model-visible means logged. Every tool call and
  result a harness makes on a kit MUST be recorded in its session log (a
  harness that keeps one), with enough to reconstruct the request. Previews
  attached to the model's context are logged as the context they are.

## 8. The MCP binding

A kit is an MCP server. It serves the tools of section 1 for the kit (or, in
a server of several kits, for each kit it serves), over any MCP transport
(stdio by default), started on one workspace folder.

| KHP | MCP |
| --- | --- |
| The tools of section 1 | `tools/list`, `tools/call`; names follow A2 |
| Tool arguments (section 1.1, A5) | `inputSchema` (JSON Schema, A5, A29) |
| Tool results | `structuredContent`, with a text `content` beside it; `outputSchema` per tool, accepting the error result too (A18) |
| Previews | Image content in the result |
| Errors (A18) | `isError: true`, the error in `structuredContent.error`, valid against the tool's own `outputSchema` |
| Objects (A19, optional) | Resources `kit://<document>/describe` and `kit://<document>/objects/<id>` |
| The manifest (K20) | The resource `khp://kits/<id>/kit.json` |
| Reminders for the model | The server's `instructions` |

- The server SHOULD tell the model, in its instructions, which kits it
  serves, to call `<prefix>_check` after editing and fix what it reports
  (A22), and, when it has drafts, to call `<prefix>_draft_ready` when done.
- Every tool's `outputSchema` MUST accept its error result (A18): an
  optional top-level `error` and no `required` result fields, or a `oneOf`
  of the result and the error. A server MUST NOT drop `structuredContent`
  from an error result to get past the client's validation.
- Long calls (exports) MAY report MCP progress notifications.
- A server that serves several kits answers `unavailable` (A18) for a kit
  it cannot start, with a message for people that names the kit.

Any MCP-capable agent harness uses a kit with no other adapter. Other
bindings (an editor's own bridge, a harness's native tool API) MAY exist
beside MCP; they offer the same tools, arguments, results, and errors.

## 9. Conformance

A kit conforms to KHP at a tier (section 10) when `khp check` passes at
that tier against its MCP server ([conformance.md](conformance.md)): it
offers the tools of its tier with schemas that are valid
`ParameterSchemaSpec` (A5, A6), names them as A2 says, answers errors as A18,
checks without changing the document (A21, A22), types its file parameters
(A28) and refuses paths as A29 says, never replaces a file through `create`
or an export, lists the files it wrote (A30), offers the draft tools when it
declares drafts and never offers merge or discard as tools (A12, A14), and
serves the same manifest in its package and as an MCP resource (K20), never
answers an empty command search (A49), and leaves the file and the session's
document as they were when a run fails (A53). A kit that offers
`<prefix>_hit` answers it as A31 says; one that declares `agent.links`
(K21) reports links as A42 says and ships the `links-outside` fixture, and
one that does not answers no links.

An agent harness conforms when it calls the tools as section 1 says, logs
every call, result, preview, and written file (A10, A30), never offers merge
or discard to a model (A14), never runs a diagnostic's `fix` on its own
(A21), and treats tool output as data, never as instructions (section 10.6).

## 10. Tiers

A kit claims one tier in its manifest's `level` (K19), and `khp check`
tests it. Each tier includes the one before.

| Tier | `level` | A kit |
| --- | --- | --- |
| **Basic** | `basic` | `<prefix>_inspect` (JSON; a preview is optional), `<prefix>_commands`, `<prefix>_run`, `<prefix>_check` (it may answer an empty list); a schema for every agent-facing command (A5, A6); A18 errors; the rules of sections 1.4, 1.5, 6, and 7; content in inspect (A52); actionable errors (A48); command search never empty (A49, A5c); accepted edits saved (A50); atomic runs (A53); the run's target when inspect takes one (A54); the draft tools when it declares drafts, in file mode or any other (A27); links in inspect when it declares `agent.links` (A42, K21); nothing read or written outside the workspace, its package, and its private runtime folder (section 10.6, A58) |
| **Agent-ready** | `agent-ready` | Basic, plus works without its editor (A34); the tools of A35; full schema coverage (A36); no network (A37); a real check with its catalogue (A38); a real preview (A39) attached on request (A55); changes made outside the agent's calls said and the next run refused once (A56); overflow in the check for layout kits (A40); create and export (A41); determinism (A26); no prompts (A45); K16 and K17 `agent/checks.json` |
| **Agent-ready complete** | `agent-ready-complete` | Agent-ready, plus the layout answer for layout kits (A40); K17 `agent/guide.md`; edits that address only what they change, by id, name, or path (A44); runs under a sandbox (section 10.6) |

A basic kit needs no object model, no real preview, and no editor: wrapping
an existing file library (python-docx, openpyxl) in an MCP server that
follows this page makes one. A conformance report names the version and
the tier: "KHP 1.0, Agent-ready". Requirements of this section are *(proposed)*.

### 10.1 Works without an editor, and tools

- **A34** *(proposed) No editor needed.* An Agent-ready kit MUST be an MCP
  server that works without opening its editor, if it has one: every tool
  answers with no window, no editor, and no person present. Its results
  MUST be the same as its own editor's for the same document and steps
  (A26), which it achieves by running the same engine in both. It reports
  the same `version` in its MCP `serverInfo` as in its manifest.
- **A35** *(proposed) Tools.* An Agent-ready kit MUST offer
  `<prefix>_inspect`, `<prefix>_commands`, `<prefix>_run`,
  `<prefix>_check`, `<prefix>_create`, and `<prefix>_export`, and, when it
  has an object model (`agent.objectModel` in the [manifest](manifest.md)), `<prefix>_query` and
  `<prefix>_batch` (A16). Any kit, at every tier, that declares drafts in its
  [manifest](manifest.md) (`agent.drafts`) MUST offer `<prefix>_draft_ready` and
  `<prefix>_draft_reopen`.
- **A36** *(proposed) Schemas.* Every agent-facing command of an Agent-ready
  kit MUST carry a `ParameterSchemaSpec` (A5, A6): 100% of the commands its
  `<prefix>_commands` lists without a query (A5b), each checked in the full
  form (A5a). A schema whose parameters are a single `json`
  value with a free-text description counts as covered only when the
  command's parameters really are free-form. Every such command MUST answer
  a call with empty params (`{}`) with a typed error (A18) or a result,
  never a crash, and MUST leave the file unchanged when it fails.
- **A37** *(proposed) No network.* An Agent-ready kit MUST NOT open network
  connections while it serves tools; everything it needs, fonts included,
  ships with it. `khp check` runs it with the network denied.

### 10.2 Verify

- **A38** *(proposed) A real check.* An Agent-ready kit MUST answer
  `<prefix>_check` with a real check, not a placeholder that never reports
  anything. Its package MUST ship a **check catalogue**, `agent/checks.json`
  (K17):

  ```json
  [
    { "code": "sheet.formula-error", "severity": "error", "summary": "A formula evaluates to an error.", "fixture": "check-formula-error.xlsx" }
  ]
  ```

  Each entry is a code the kit's check reports, its severity (A21), a
  one-sentence English summary, and `fixture`, the name of a file in the
  kit's conformance fixtures on which the check reports that code. The
  catalogue lists at least every `error` code for documents that are broken
  or will not show as meant that the kit can detect, such as
  `<kit>.text-overflow` for layout kits (A40), `sheet.formula-error`,
  `table.field-type-mismatch`, and `film.missing-media`. A code a kit reports
  MUST be in its catalogue.

  *(proposed)* An entry MAY also carry `overflow`, one of `"text"`,
  `"off-page"`, or `"page-break"`: the code reports an overflow of that
  kind, the `kind` of A40's layout answer. An entry without `overflow`
  reports no overflow. The catalogue, not the diagnostic, says which codes
  report overflows: a diagnostic has no member for it (A21), and an agent
  or tool looks its `code` up in the catalogue.

  ```json
  { "code": "slide.text-overflow", "severity": "error", "summary": "Text does not fit its box.", "fixture": "check-text-overflow.pptx", "overflow": "text" }
  ```

### 10.3 A real preview

- **A39** *(proposed) A real preview.* For an Agent-ready kit,
  `<prefix>_inspect` with `preview: true` MUST return a rendering, by the
  kit's own engine, of what the person would see:
  - not uniform: a blank, transparent, single-colour, or placeholder image
    fails;
  - framed to the content: a sheet's used range, a drawing's extents, the
    current page or slide, never an arbitrary fixed area;
  - of a `target` when one is given (A24, now required): the shape of a
    diagnostic's target (A21), plus `time` (seconds from the start) for
    timeline kits; a page, slide, sheet range, layer (`path`), time, or
    object id;
  - at a `scale` up to 2 (device pixels per document unit, default 1), and
    at most `maxSize` pixels on the longer side, up to 4096;
  - with the fonts it ships. When the engine substitutes a font the document
    names, the check MUST report it as an `info` diagnostic
    `<kit>.font-substituted`, so the agent knows the preview may differ from
    the application the file was made in.

  Timeline kits answer the frame at `target.time` and MAY answer a contact
  sheet of frames. A harness MUST NOT attach previews of documents its run
  was not given (A10 logs the ones it attaches).

### 10.4 Layout observation

- **A40** *(proposed) Layout observation.* A kit whose documents are laid
  out into pages, slides, or print areas is a **layout kit** (manifest
  `agent.layout` in the [manifest](manifest.md)). When Agent-ready:
  - *Overflow diagnostics* (tier Agent-ready): the check MUST report every
    overflow below as a diagnostic with a target (`<kit>.text-overflow` and
    the kit's other overflow codes), so an agent that only checks still sees
    it. *(proposed)* A layout kit's overflow codes are the entries of its
    check catalogue that carry `overflow` (A38): the catalogue entry of
    every code that reports an overflow MUST carry `overflow`, with the
    `kind` of the overflows it reports. Agents and tools tell an overflow
    diagnostic by its code's catalogue entry, never by the code's name;
    `<kit>.text-overflow` remains the recommended code for text that does
    not fit its box.
  - *Layout answer* (tier Agent-ready complete): `<prefix>_inspect` with
    `layout: true` MUST answer the layout after the engine laid the document
    out:

    ```json
    {
      "layout": {
        "pages": [
          { "page": 1, "size": [612, 792], "unit": "pt",
            "objects": [ { "id": "obj_41", "bounds": [72, 90, 540, 160], "clipped": false } ] }
        ],
        "overflow": [ { "id": "obj_57", "page": 3, "kind": "text", "by": 24.5 } ],
        "cursor": null
      }
    }
    ```

    `pages` count from 1; `objects` are the objects placed on each page with
    their final `bounds` (`[left, top, right, bottom]` in `unit`) and whether
    they are `clipped`. `overflow` lists text that does not fit its box
    (`kind` `text`), objects outside the page (`off-page`), and rows or
    blocks cut by a page break (`page-break`), with how far (`by`, in
    `unit`). `limit` and `cursor` (A25) page through long documents. Every
    `overflow` entry also appears in the check, with a code whose catalogue
    entry's `overflow` is the entry's `kind`.

### 10.5 Create and export

- **A41** *(proposed) Create and export.* An Agent-ready kit MUST support
  `<prefix>_create` for each entry of its manifest's `creates` (`kind` is
  the entry's `id`; `from` names a template file, read under A29) and
  `<prefix>_export` for each entry of its `exports` (`format` is the entry's
  extension). Both write new files only: the kit server picks an unused name
  when the file exists and never replaces a file (A29). The result lists the
  files written (A30).

### 10.6 Security

- A kit server reads and writes only inside its workspace, under A29, with
  two exceptions at every tier: it reads its own package (the code, fonts,
  and other files it ships, and the platform's own files a process needs to
  run), and it keeps its runtime state in its private runtime folder (A58).
  Outside these it reads, writes, and deletes nothing.
- An Agent-ready kit opens no network connections (A37).
- At Agent-ready complete the kit passes `khp check` under the platform's
  sandbox, with the file system denied except its workspace, its own
  package, and its private runtime folder (A58), and the network denied.
- **A58** *(proposed) A private runtime folder.* At every tier a kit server
  MAY keep its own runtime state (sockets, caches, and scratch files it
  creates itself) in one folder outside its workspace that its harness
  designates: its **private runtime folder**.
  - *How the harness designates it.* The harness sets these variables of
    the kit server's environment to one folder that is outside the
    workspace and private to that kit server (given to no other process it
    starts): `TMPDIR` on POSIX systems, and also `XDG_RUNTIME_DIR` and
    `XDG_CACHE_HOME` on systems that follow the XDG Base Directory
    specification; `TEMP` and `TMP` on Windows.
  - *How the kit server finds it.* It takes the first of these variables
    that is set and not empty, in this order: `TMPDIR`, `XDG_RUNTIME_DIR`,
    `XDG_CACHE_HOME` on POSIX systems; `TEMP`, `TMP` on Windows. When none
    is set, its harness designated none, and the kit server MAY use the
    platform's default temporary folder (`/tmp` on POSIX systems) instead.
  - *What it holds.* Only the kit server's own runtime state. A kit server
    MUST NOT use a file that was in the folder before it started as document
    data: no tool result, written file, or rendering carries such a file's
    content. Nothing in the folder is reachable through a tool
    argument, a `file` parameter, or a document link: paths resolve inside
    the workspace only, and a path into the folder is refused like any
    other path outside it (A29, A42).
  - *When it exits.* A kit server SHOULD remove what it created in the
    folder when it exits.
- Previews, layout, and diagnostics are model context: they are logged
  (A10), and a harness treats all tool output, document text and diagnostic
  messages included, as data, never as instructions. Agents act on
  diagnostic codes, which are stable, not on messages.
- A harness bounds every call with a timeout and restarts a kit server that
  crashed.

### 10.7 Edits as changes

- **A44** *(proposed; Agent-ready complete)* *Write the change, not the
  document.* Every mutating tool of an Agent-ready kit takes only the change
  a model means: the steps of `<prefix>_run` and the operations of
  `<prefix>_batch` address the objects they change by id, or by a name or
  path the kit resolves (a slide's index and title, a sheet and cell, a
  heading path, a layer name), and leave everything they do not name as it
  was. No mutating tool requires the whole document, a whole page, or a
  whole object list to change one part of it. A name or path that matches
  no object, or more than one, is an error that lists the candidates
  (`not-found` or `invalid-value`, A18), never a guess. The kit's guide
  (K17 `agent/guide.md`) shows how to address objects and gives worked
  examples of small edits.
