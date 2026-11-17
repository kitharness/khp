# Kit Harness Protocol (KHP)

Kit Harness Protocol: the spec and its conformance checker.

[kitharness.org](https://kitharness.org)

KHP defines how an AI agent uses a **kit**: an MCP server that exposes
tools for inspecting, editing, checking, and exporting real files. A kit
can wrap an existing file library or a document engine. It needs no
particular editor, storage format, or internal data model.

KHP's home is [github.com/kitharness/khp](https://github.com/kitharness/khp).
Its npm packages use `@kitharness/*` (including `@kitharness/conformance`),
and its site is [kitharness.org](https://kitharness.org).

## Specification

Start with [spec/index.md](spec/index.md), which states the protocol
version and edition. The specification has four pages:

| Page | Contents |
| --- | --- |
| [spec/index.md](spec/index.md) | Scope, roles, tiers, and reading guide |
| [spec/agent.md](spec/agent.md) | Tools, arguments, results, diagnostics, errors, drafts, rules, and MCP binding |
| [spec/manifest.md](spec/manifest.md) | The minimal `kit.json` manifest and its MCP resource |
| [spec/conformance.md](spec/conformance.md) | Fixtures, conformance checks, harness adapter contract, and reports |

The protocol defines workspace containment, stable addresses, atomic
edits, session logging, and person-approved draft merge/discard. It has
three cumulative tiers: **basic**, **Agent-ready**, and **Agent-ready
complete**. Basic needs JSON inspection, commands with schemas, atomic
runs, and checks; previews and an object model are optional at that tier.
See [CHANGES.md](CHANGES.md) for version changes and retired requirement ids.

## Conformance

The npm package `@kitharness/conformance` provides the `khp` executable:

```sh
khp check --kit "my-kit --workspace {workspace}" --package <kit-package> --level basic
```

The kit package supplies `kit.json` and a `conformance/` fixture folder.
Keep `{workspace}` literal: the checker substitutes a fresh fixture copy.
It reports failures and checks it could not perform. A passing observed
check does not establish an untested duty; the complete tier currently
cannot pass because A44 has no automated check.

Harness adapters can be checked with
`khp check --harness "<adapter command>" --scripted`, which uses
deterministic turns without calling a model. See the
[tool README](tools/conformance/README.md) for options and report limits.

## Build and Test

Use Node.js 22.18 or later and pnpm 10. From the repository root:

```sh
pnpm --dir tools/conformance install --frozen-lockfile
pnpm --dir tools/conformance build
pnpm --dir tools/conformance typecheck
pnpm --dir tools/conformance test
```

The build writes `tools/conformance/dist/`. From a checkout, run the CLI
as `node tools/conformance/dist/cli.js check ...`. To inspect the npm
archive locally, run `pnpm --dir tools/conformance pack --pack-destination /tmp/khp-pack`;
packing rebuilds the compiled output and does not publish it.

The feature catalogue is [features.yaml](features.yaml); the golden cases
are under [cases/](cases/). [docs/quality.md](docs/quality.md) lists their commands,
the required local-path scan, and the rules for expected results.

## Python DOCX Example

[examples/docx-python](examples/docx-python/README.md) is a small basic-tier
kit wrapping python-docx through the official MCP Python SDK. It edits
body paragraphs and simple tables, serves schemas and a manifest, and
demonstrates workspace containment, link reporting, and atomic saves.

The example requires Python 3.11 or later on Linux or macOS. Its README
covers dependency installation, synthetic fixture generation, tests, and
running the conformance checker. It supplies no renderer or layout engine
and makes no higher-tier or complex DOCX fidelity claim.

## License

The specification, tool, and example are licensed under Apache-2.0; see
[LICENSE](LICENSE). Dependencies are installed separately and retain their
upstream licenses.
