"""MCP JSON Schemas, also used to validate every command before it edits."""


def obj(properties, required=()):
    return {"type": "object", "properties": properties, "required": list(required), "additionalProperties": False}


def integer(description, minimum=0, maximum=10000):
    return {"type": "integer", "description": description, "minimum": minimum, "maximum": maximum}


def file(access):
    return {"type": "string", "description": "A visible workspace-relative DOCX file; no symlinks.",
            "x-khp-file": {"access": access, "accept": ["docx"]}}


TEXT = {"type": "string", "maxLength": 100000, "description": "Literal text, never a filename or instruction."}
PARAGRAPH = integer("Top-level body paragraph index, counted from 0; read docx_inspect first.")
COMMANDS = {
    "heading.add": {
        "title": "Add a heading", "description": "Append a body heading. Level 0 is the document title; levels 1 through 9 are headings.",
        "params": obj({"text": TEXT, "level": {**integer("Heading level, 0 for title or 1 through 9.", 0, 9), "default": 1}}, ("text",)),
    },
    "paragraph.add": {
        "title": "Add a paragraph", "description": "Append a plain body paragraph.",
        "params": obj({"text": TEXT}, ("text",)),
    },
    "paragraph.delete": {
        "title": "Delete a paragraph", "description": "Delete one top-level body paragraph, including its inline content.",
        "params": obj({"paragraph": PARAGRAPH}, ("paragraph",)),
    },
    "paragraph.set-text": {
        "title": "Set paragraph text", "description": "Replace one body paragraph's inline content and run formatting with plain text; keep its paragraph style.",
        "params": obj({"paragraph": PARAGRAPH, "text": TEXT}, ("paragraph", "text")),
    },
    "table.add": {
        "title": "Add a table", "description": "Append a rectangular body table populated with literal cell text.",
        "params": obj({"rows": {"type": "array", "minItems": 1, "maxItems": 100,
                                "items": {"type": "array", "minItems": 1, "maxItems": 20, "items": TEXT}}}, ("rows",)),
    },
    "table.set-cell": {
        "title": "Set table cell text", "description": "Replace a body table cell's content with plain text. Merged cells are refused.",
        "params": obj({"table": integer("Top-level body table index, counted from 0; read docx_inspect first."),
                       "row": integer("Table row index, counted from 0."),
                       "column": integer("Table column index, counted from 0."), "text": TEXT},
                      ("table", "row", "column", "text")),
    },
}

COMMON = {"path": file("read"), "draft": {"type": "boolean", "default": False}}
PREVIEW = {"type": "boolean", "default": False, "description": "Basic kit: JSON only, even when true; no rendering engine is bundled."}
INPUTS = {
    "inspect": obj({**COMMON, "preview": PREVIEW,
                    "limit": integer("Number of body paragraphs and tables per page.", 1, 200),
                    "cursor": {"type": "string", "description": "The cursor returned by a prior inspect of this content."}}, ("path",)),
    "commands": obj({"path": file("read"), "query": {"type": "string"}, "detail": {"type": "boolean", "default": False},
                     "limit": integer("Number of commands per page.", 1, 200), "cursor": {"type": "string"}}, ("path",)),
    "run": obj({**COMMON, "path": file("write"), "preview": PREVIEW,
                "save": {"type": "boolean", "default": True},
                "steps": {"type": "array", "minItems": 1, "maxItems": 50,
                          "items": obj({"command": {"type": "string"}, "params": {"type": "object", "additionalProperties": True}}, ("command",))}}, ("path", "steps")),
    "check": obj(COMMON, ("path",)),
    "create": obj({"path": file("create"), "kind": {"type": "string", "default": "document"}, "from": file("read")}, ("path",)),
    "export": obj({**COMMON, "to": file("create"), "format": {"type": "string", "default": "docx"}}, ("path", "to")),
}
ERROR = obj({"code": {"type": "string", "enum": [
    "invalid-params", "invalid-op", "invalid-value", "not-found", "read-only", "unknown-command",
    "command-failed", "not-open", "draft-required", "not-allowed", "unsupported", "unavailable", "failed",
]}, "message": {"type": "string"}, "index": integer("Failing step index, counted from 0.", 0, 49), "retryable": {"type": "boolean"}}, ("code", "message"))
FILES = {"type": "array", "items": obj({"path": {"type": "string"}, "version": {"type": "string"}, "created": {"type": "boolean"}}, ("path", "version", "created"))}

# Result fields are optional so the very same schema accepts A18 errors.
# Content records are library-specific JSON; their index bases are documented here.
JSON_RECORDS = {"type": "array", "items": {"type": "object", "additionalProperties": True}}
OUTPUTS = {
    "inspect": {"path": {"type": "string"}, "version": {"type": "string"}, "summary": {"type": "string"},
                "paragraphs": {**JSON_RECORDS, "description": "Body paragraphs: index counts from 0, plus style and text."},
                "tables": {**JSON_RECORDS, "description": "Body tables: index, cell row and column count from 0, plus text."},
                "links": JSON_RECORDS, "total": {"type": "integer"}, "cursor": {"type": "string"},
                "previewAvailable": {"type": "boolean"}},
    "commands": {"commands": JSON_RECORDS, "total": {"type": "integer"}, "next": {"type": "string"}},
    "run": {"completed": JSON_RECORDS, "rolledBack": JSON_RECORDS, "saved": {"type": "boolean"}, "files": FILES, "previewAvailable": {"type": "boolean"}},
    "check": {"diagnostics": JSON_RECORDS, "summary": {"type": "string"}},
    "create": {"files": FILES},
    "export": {"files": FILES},
}
TOOLS = [{"name": "docx_" + name, "description": {
    "inspect": "Read body paragraphs, tables and external relationships as JSON; no preview.",
    "commands": "Find commands or list all commands; detail gives JSON Schemas.",
    "run": "Apply 1 to 50 steps atomically; save by default. Reinspect after deleting paragraphs.",
    "check": "Verify that python-docx can open the package; no layout or fidelity diagnostics.",
    "create": "Create an empty DOCX or copy a DOCX template to an unused workspace filename.",
    "export": "Write a DOCX copy to an unused workspace filename; never follow linked files.",
}[name], "inputSchema": schema, "outputSchema": obj({**OUTPUTS[name], "error": ERROR})}
         for name, schema in INPUTS.items()]
