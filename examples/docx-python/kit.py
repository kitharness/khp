"""The library adapter: no MCP transport and no platform-specific host."""

from difflib import SequenceMatcher
from hashlib import sha256
from io import BytesIO
from pathlib import Path
from zipfile import ZipFile

from docx import Document
from jsonschema import Draft202012Validator
from lxml import etree

from schemas import COMMANDS, INPUTS
from workspace import KitError


def version(data):
    return sha256(data).hexdigest()


def open_doc(data):
    # No extraction to disk. Bound decompression and refuse DTDs before the library parses XML.
    try:
        with ZipFile(BytesIO(data)) as archive:
            entries = archive.infolist()
            if len(entries) > 2000 or sum(entry.file_size for entry in entries) > 64 * 1024 * 1024:
                raise ValueError("package budget")
            for entry in entries:
                if entry.filename.endswith((".xml", ".rels")):
                    if entry.file_size > 8 * 1024 * 1024:
                        raise ValueError("XML budget")
                    tree = etree.fromstring(archive.read(entry), etree.XMLParser(resolve_entities=False, no_network=True, load_dtd=False))
                    if tree.getroottree().docinfo.doctype:
                        raise ValueError("DTD")
        return Document(BytesIO(data))
    except Exception:
        raise KitError("invalid-value", "The file is not a supported DOCX (or exceeds the package budget); use docx_create or repair it in your document editor.") from None


def serialize(doc, actor):
    # A11: record the person who started this process, marked as acting through an agent.
    doc.core_properties.last_modified_by = actor + " (via agent)"
    doc.core_properties.revision += 1
    stream = BytesIO()
    doc.save(stream)
    return stream.getvalue()


def validate(value, schema, where):
    problem = next(Draft202012Validator(schema).iter_errors(value), None)
    if problem:
        location = ".".join(map(str, problem.absolute_path)) or "arguments"
        error = KitError("invalid-params", f"{where}: {location}: {problem.message}. Read the tool inputSchema or docx_commands with detail: true, then retry.")
        if where == "docx_run" and len(problem.absolute_path) >= 2 and problem.absolute_path[0] == "steps":
            error.error["index"] = problem.absolute_path[1]
        raise error


class Kit:
    def __init__(self, workspace, actor):
        if not actor.strip() or len(actor) > 220:
            raise ValueError("actor must name the initiating person, using 1 to 220 characters")
        self.workspace = workspace
        self.actor = actor
        # Unsaved bytes and the corresponding disk fingerprint. No runtime folder is used.
        self.pending = {}
        self.cursors = {}

    def current(self, name, *, allow_conflict=False):
        disk = self.workspace.read(name)
        if name in self.pending:
            data, base = self.pending[name]
            if version(disk) != base and not allow_conflict:
                raise KitError("failed", "The file changed while session edits were unsaved. Call docx_export to a new file to preserve them, then restart and inspect; do not overwrite the other person's changes.")
            return data, base
        return disk, version(disk)

    def call(self, action, args):
        try:
            if action not in INPUTS:
                raise KitError("unknown-command", "Use docx_inspect, docx_commands, docx_run, docx_check, docx_create or docx_export.")
            validate(args, INPUTS[action], "docx_" + action)
            name = self.workspace.name(args["path"])
            if args.get("draft"):
                raise KitError("unsupported", "This kit has no draft tools. Use docx_create with from to work on a separate copy.")
            return getattr(self, action)(name, args)
        except KitError as exc:
            result = {"error": exc.error}
        except Exception:
            # Never send exception text: OS/library errors can expose installation paths.
            result = {"error": {"code": "command-failed", "message": "The library or filesystem refused this call. Inspect the document, check permissions and retry with supported content."}}
        if action == "run":
            result.update(completed=[], rolledBack=[])
        return result

    def commands(self, name, args):
        # Validate even the last path component before answering a tool call.
        self.workspace.read(name)
        query = args.get("query", "").strip().lower()
        rows = [{"id": key, **value} for key, value in sorted(COMMANDS.items())]
        if query:
            words = query.replace(".", " ").replace("-", " ").split()
            matched = [row for row in rows if all(word in (row["id"] + " " + row["title"] + " " + row["description"]).lower() for word in words)]
            if matched:
                return {"commands": matched, "total": len(matched)}
            nearest = sorted(rows, key=lambda row: SequenceMatcher(None, query, row["id"]).ratio(), reverse=True)[:2]
            return {"commands": [{**row, "closest": True} for row in nearest], "total": 0}
        return self.page(rows, args, "commands:" + name, "commands", "next")

    def page(self, rows, args, scope, key, next_key):
        start = 0
        if "cursor" in args:
            issued = self.cursors.get(args["cursor"])
            if not issued or issued[0] != scope:
                raise KitError("invalid-params", "Use the cursor returned by this tool for this document content, or omit cursor to start again.")
            start = issued[1]
        stop = start + args.get("limit", 100)
        result = {key: rows[start:stop], "total": len(rows)}
        if stop < len(rows):
            token = sha256(f"{scope}:{stop}".encode()).hexdigest()
            self.cursors[token] = (scope, stop)
            result[next_key] = token
        return result

    def inspect(self, name, args):
        data, _ = self.current(name)
        doc = open_doc(data)
        content = [{"kind": "paragraph", "index": index, "style": paragraph.style.name, "text": paragraph.text}
                   for index, paragraph in enumerate(doc.paragraphs)]
        content += [{"kind": "table", "index": index, "cells": [
            {"row": row_index, "column": column, "text": cell.text}
            for row_index, row in enumerate(table.rows) for column, cell in enumerate(row.cells)]}
                    for index, table in enumerate(doc.tables)]
        paged = self.page(content, args, "inspect:" + name + ":" + version(data), "content", "cursor")
        shown = paged.pop("content")
        links = []
        # Includes document, headers, footers, and package-level relationships.
        # python-docx preserves external relationships; it never opens their targets.
        owners = [("package", doc.part.package), *[(str(part.partname), part) for part in doc.part.package.parts]]
        for owner_name, owner in owners:
            for rel in owner.rels.values():
                if rel.is_external:
                    kind = "media" if rel.reltype.endswith(("/image", "/audio", "/video")) else "link"
                    links.append({"id": owner_name + ":" + rel.rId, "kind": kind,
                                  **self.workspace.link(name, rel.target_ref)})
        return {"path": name, "version": version(data), "summary": f"{len(doc.paragraphs)} body paragraphs; {len(doc.tables)} body tables.",
                "paragraphs": [item for item in shown if item["kind"] == "paragraph"],
                "tables": [item for item in shown if item["kind"] == "table"],
                "links": links, "previewAvailable": False, **paged}

    def run(self, name, args):
        completed = []
        index = 0
        try:
            data, base = self.current(name)
            doc = open_doc(data)  # Detached candidate. Nothing in the session is mutated yet.
            for index, step in enumerate(args["steps"]):
                command = step["command"]
                spec = COMMANDS.get(command)
                if spec is None:
                    nearest = sorted(COMMANDS, key=lambda key: SequenceMatcher(None, command, key).ratio(), reverse=True)[:2]
                    raise KitError("unknown-command", f"Unknown command {command}; try {', '.join(nearest)}, or call docx_commands.")
                params = step.get("params", {})
                validate(params, spec["params"], command)
                self.execute(doc, command, params)
                completed.append({"index": index, "command": command})
            encoded = serialize(doc, self.actor)
            if len(encoded) > 16 * 1024 * 1024:
                raise KitError("unsupported", "The edited DOCX exceeds 16 MiB; make a smaller edit or split the document, then retry.")
            open_doc(encoded)  # A50: refuse edits whose output this kit cannot reopen.
            saved = args.get("save", True)
            if saved:
                # Do not overwrite a file another process changed during this call.
                if version(self.workspace.read(name)) != base:
                    raise KitError("failed", "The file changed during the run. Call docx_inspect, review the new indexes, then retry; do not undo another person's edits.")
                self.workspace.write(name, encoded)
                self.pending.pop(name, None)
            else:
                self.pending[name] = (encoded, base)
            return {"completed": completed, "saved": saved, "previewAvailable": False,
                    "files": [{"path": name, "version": version(encoded), "created": False}] if saved else []}
        except Exception as exc:
            error = exc.error.copy() if isinstance(exc, KitError) else {
                "code": "command-failed", "message": "The step or save failed. Call docx_inspect and retry with supported content; the run was rolled back."}
            error.setdefault("index", index)
            return {"error": error, "completed": [], "rolledBack": completed}

    def execute(self, doc, command, params):
        if command == "paragraph.add":
            doc.add_paragraph(params["text"])
        elif command == "heading.add":
            doc.add_heading(params["text"], params.get("level", 1))
        elif command.startswith("paragraph."):
            index = params["paragraph"]
            if index >= len(doc.paragraphs):
                raise KitError("not-found", f"No body paragraph {index}; call docx_inspect for current paragraph indexes counted from 0.")
            paragraph = doc.paragraphs[index]
            if command == "paragraph.set-text":
                paragraph.text = params["text"]
            else:
                # python-docx has no public delete method; isolate this XML operation here.
                element = paragraph._element
                if element.xpath("./w:pPr/w:sectPr"):
                    raise KitError("unsupported", "This paragraph holds a section break. Use paragraph.set-text or edit the section in your document editor.")
                element.getparent().remove(element)
        elif command == "table.add":
            rows = params["rows"]
            if any(len(row) != len(rows[0]) for row in rows):
                raise KitError("invalid-value", "rows must be rectangular; supply the same number of cells in every row, then retry table.add.")
            table = doc.add_table(rows=len(rows), cols=len(rows[0]))
            for r, row in enumerate(rows):
                for c, text in enumerate(row):
                    table.cell(r, c).text = text
        elif command == "table.set-cell":
            table_index, row, column = params["table"], params["row"], params["column"]
            if table_index >= len(doc.tables):
                raise KitError("not-found", "No such body table; call docx_inspect for table indexes counted from 0.")
            table = doc.tables[table_index]
            if table._tbl.xpath(".//w:gridSpan | .//w:vMerge"):
                raise KitError("unsupported", "Merged table cells are unsupported; edit an unmerged table or use your document editor.")
            if row >= len(table.rows) or column >= len(table.rows[row].cells):
                raise KitError("not-found", "No such table cell; call docx_inspect for row and column indexes counted from 0.")
            table.rows[row].cells[column].text = params["text"]

    def check(self, name, args):
        data, _ = self.current(name)
        open_doc(data)
        return {"diagnostics": [], "summary": "Package opened. No layout, style, accessibility or fidelity checks are implemented at this basic tier."}

    def create(self, name, args):
        if args.get("kind", "document") != "document":
            raise KitError("invalid-value", "kind must be document; retry docx_create with that kind.")
        if "from" in args:
            source = self.workspace.name(args["from"])
            data, _ = self.current(source)
            doc = open_doc(data)
        else:
            doc = Document()
            doc.core_properties.author = self.actor
        return self.new_file(name, serialize(doc, self.actor))

    def export(self, name, args):
        to = self.workspace.name(args["to"])
        if args.get("format", Path(to).suffix.lstrip(".").lower()) != "docx":
            raise KitError("unsupported", "The only export format is docx; retry docx_export with format: docx.")
        data, _ = self.current(name, allow_conflict=True)
        open_doc(data)
        # Copy the package bytes, including link text, without opening linked files.
        return self.new_file(to, data)

    def new_file(self, name, data):
        if len(data) > 16 * 1024 * 1024:
            raise KitError("unsupported", "The output exceeds 16 MiB; use a smaller template or document, then retry.")
        open_doc(data)
        actual = self.workspace.write(name, data, new=True)
        return {"files": [{"path": actual, "version": version(data), "created": True}]}
