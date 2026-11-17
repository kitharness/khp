"""Gate contract checks. A maintainer runs these after installing requirements.txt."""

import sys

sys.dont_write_bytecode = True

import asyncio
from io import BytesIO
import json
import os
from pathlib import Path
import tempfile
import unittest
from xml.etree import ElementTree as ET
from zipfile import ZipFile

from jsonschema import Draft202012Validator
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

from generate_fixtures import generate
from kit import Kit
from schemas import TOOLS
from workspace import Workspace


PACKAGE = Path(__file__).resolve().parent
OUTPUTS = {tool["name"].removeprefix("docx_"): tool["outputSchema"] for tool in TOOLS}


def body_text(data):
    # Independent of python-docx's paragraph reader: inspect the saved OOXML directly.
    with ZipFile(BytesIO(data)) as archive:
        root = ET.fromstring(archive.read("word/document.xml"))
    ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    return ["".join(p.itertext()) for p in root.findall("w:body/w:p", ns)]


class ExampleTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.work = self.root / "workspace"
        generate(self.work)
        self.workspace = Workspace(self.work)
        self.addCleanup(self.workspace.close)
        self.kit = Kit(self.workspace, "Example Owner")

    def call(self, action, args, code=None):
        result = self.kit.call(action, args)
        Draft202012Validator(OUTPUTS[action]).validate(result)
        if code is None:
            self.assertNotIn("error", result, result)
        else:
            self.assertEqual(result["error"]["code"], code, result)
        return result

    def test_small_edits_reopen_and_attribution(self):
        result = self.call("run", {"path": "basic.docx", "steps": [
            {"command": "paragraph.set-text", "params": {"paragraph": 1, "text": "Revised"}},
            {"command": "heading.add", "params": {"text": "Next", "level": 2}},
            {"command": "paragraph.add", "params": {"text": "Remove me"}},
            {"command": "paragraph.delete", "params": {"paragraph": 3}},
            {"command": "table.add", "params": {"rows": [["A", "B"], ["C", "D"]]}},
            {"command": "table.set-cell", "params": {"table": 1, "row": 1, "column": 0, "text": "Changed"}},
        ]})
        self.assertTrue(result["saved"])
        self.assertEqual(result["files"][0]["path"], "basic.docx")
        saved = (self.work / "basic.docx").read_bytes()
        self.assertEqual(body_text(saved), ["A small report", "Revised", "Next"])
        fresh = Kit(self.workspace, "Example Owner")
        inspected = fresh.call("inspect", {"path": "basic.docx"})
        self.assertEqual(inspected["tables"][1]["cells"][2]["text"], "Changed")
        with ZipFile(BytesIO(saved)) as archive:
            self.assertIn(b"Example Owner (via agent)", archive.read("docProps/core.xml"))
        self.assertEqual(self.call("check", {"path": "basic.docx"})["diagnostics"], [])

    def test_failed_late_step_preserves_disk_and_unsaved_session(self):
        original = (self.work / "basic.docx").read_bytes()
        step = {"command": "paragraph.add", "params": {"text": "Unsaved"}}
        self.call("run", {"path": "basic.docx", "steps": [step], "save": False})
        before = self.call("inspect", {"path": "basic.docx"})
        result = self.call("run", {"path": "basic.docx", "steps": [step, {"command": "missing.command"}]}, "unknown-command")
        self.assertEqual(result["error"]["index"], 1)
        self.assertEqual(result["completed"], [])
        self.assertEqual(result["rolledBack"], [{"index": 0, "command": "paragraph.add"}])
        self.assertEqual(self.call("inspect", {"path": "basic.docx"}), before)
        self.assertEqual((self.work / "basic.docx").read_bytes(), original)
        self.call("run", {"path": "basic.docx", "steps": [step]})
        self.assertEqual(body_text((self.work / "basic.docx").read_bytes())[-2:], ["Unsaved", "Unsaved"])

    def test_save_failure_rolls_back_and_pending_edits_can_be_exported(self):
        step = {"command": "paragraph.add", "params": {"text": "Keep me"}}
        self.call("run", {"path": "basic.docx", "steps": [step], "save": False})
        original = (self.work / "basic.docx").read_bytes()
        write = self.workspace.write
        def refuse_save(*args, **kwargs):
            raise OSError("Synthetic disk failure")
        self.workspace.write = refuse_save
        try:
            result = self.call("run", {"path": "basic.docx", "steps": [step]}, "command-failed")
            self.assertEqual(result["completed"], [])
        finally:
            self.workspace.write = write
        self.assertEqual((self.work / "basic.docx").read_bytes(), original)
        (self.work / "basic.docx").write_bytes((self.work / "links-outside.docx").read_bytes())
        self.call("run", {"path": "basic.docx", "steps": [step]}, "failed")
        self.call("export", {"path": "basic.docx", "to": "Recovered.docx"})
        self.assertEqual(body_text((self.work / "Recovered.docx").read_bytes())[-1], "Keep me")

    def test_create_template_and_export_never_replace(self):
        original = (self.work / "basic.docx").read_bytes()
        for action, args in [
            ("create", {"path": "basic.docx", "from": "basic.docx"}),
            ("export", {"path": "basic.docx", "to": "basic.docx"}),
        ]:
            result = self.call(action, args)
            written = result["files"][0]
            self.assertNotEqual(written["path"], "basic.docx")
            self.assertTrue(written["created"])
            self.assertEqual(body_text((self.work / written["path"]).read_bytes()), body_text(original))
            self.assertEqual((self.work / "basic.docx").read_bytes(), original)
        self.call("create", {"path": "Empty.docx", "kind": "document"})
        self.assertEqual(body_text((self.work / "Empty.docx").read_bytes()), [])

    def test_uniform_containment_across_all_path_arguments(self):
        outside = self.root / "outside"
        outside.mkdir()
        secret = outside / "present.docx"
        secret.write_bytes((self.work / "basic.docx").read_bytes())
        (self.work / "escape").symlink_to(outside, target_is_directory=True)
        (self.work / "escape.docx").symlink_to(secret)
        (self.work / ".hidden").mkdir()
        (self.work / ".hidden/present.docx").write_bytes(secret.read_bytes())
        for existing, missing in [
            ("../outside/present.docx", "../outside/absent.docx"),
            (str(secret), str(outside / "absent.docx")),
            ("escape/present.docx", "escape/absent.docx"),
            (".hidden/present.docx", ".hidden/absent.docx"),
        ]:
            for action, field in [("inspect", "path"), ("check", "path"), ("run", "path"),
                                  ("create", "path"), ("create", "from"), ("export", "to")]:
                errors = []
                for target in (existing, missing):
                    args = {"path": "basic.docx", "to": "Output.docx", "steps": [{"command": "paragraph.add", "params": {"text": "literal"}}]}
                    allowed = {"inspect": {"path"}, "check": {"path"}, "run": {"path", "steps"}, "create": {"path", "from"}, "export": {"path", "to"}}[action]
                    args = {key: value for key, value in args.items() if key in allowed}
                    args[field] = target
                    errors.append(self.call(action, args, "not-allowed")["error"])
                self.assertEqual(errors[0], errors[1])
        self.call("inspect", {"path": "escape.docx"}, "not-allowed")
        self.call("create", {"path": "escape.docx"}, "not-allowed")

    def test_links_are_data_and_outside_state_is_not_observable(self):
        canary = self.root / "outside-canary.bin"
        canary.write_text("private canary content", encoding="utf-8")
        with_canary = self.call("inspect", {"path": "links-outside.docx", "preview": True})
        canary.unlink()
        without_canary = self.call("inspect", {"path": "links-outside.docx"})
        self.assertEqual(with_canary, without_canary)
        self.assertEqual(len(with_canary["links"]), 2)
        for link in with_canary["links"]:
            self.assertFalse(link["exists"])
            self.assertTrue(link["outside"])
            self.assertNotIn("path", link)
        self.assertNotIn("private canary content", json.dumps(with_canary))
        (self.work / "escape").symlink_to(self.root, target_is_directory=True)
        self.assertEqual(self.workspace.link("basic.docx", "escape/outside-canary.bin"),
                         {"target": "escape/outside-canary.bin", "exists": False})
        self.assertEqual(self.workspace.link("basic.docx", ".hidden/file.bin"),
                         {"target": ".hidden/file.bin", "exists": False})

    def test_command_search_schemas_pagination_and_bad_params(self):
        rows, cursor = [], None
        while True:
            args = {"path": "basic.docx", "limit": 1, "detail": True}
            if cursor:
                args["cursor"] = cursor
            page = self.call("commands", args)
            rows.extend(page["commands"])
            cursor = page.get("next")
            if not cursor:
                break
        self.assertEqual(len(rows), 6)
        self.assertEqual([row["id"] for row in rows], sorted(row["id"] for row in rows))
        for row in rows:
            Draft202012Validator.check_schema(row["params"])
            self.call("run", {"path": "basic.docx", "steps": [{"command": row["id"], "params": {}}]}, "invalid-params")
        nearest = self.call("commands", {"path": "basic.docx", "query": "zzzzzzz"})
        self.assertTrue(nearest["commands"])
        self.assertTrue(all(row["closest"] for row in nearest["commands"]))
        self.call("commands", {"path": "basic.docx", "cursor": "unissued"}, "invalid-params")
        first = self.call("inspect", {"path": "basic.docx", "limit": 1})
        second = self.call("inspect", {"path": "basic.docx", "limit": 1, "cursor": first["cursor"]})
        self.assertEqual(first["paragraphs"][0]["index"], 0)
        self.assertEqual(second["paragraphs"][0]["index"], 1)

    def test_literal_filenames_and_xml_entities_cannot_read_files(self):
        secret = self.root / "secret.txt"
        secret.write_text("Secret contents must stay private", encoding="utf-8")
        for text in (str(secret), secret.as_uri()):
            self.call("run", {"path": "basic.docx", "steps": [
                {"command": "paragraph.add", "params": {"text": text}},
            ]})
        inspected = self.call("inspect", {"path": "basic.docx"})
        self.assertEqual([p["text"] for p in inspected["paragraphs"]][-2:], [str(secret), secret.as_uri()])
        self.assertNotIn("Secret contents must stay private", json.dumps(inspected))
        original = (self.work / "basic.docx").read_bytes()
        malicious = BytesIO()
        with ZipFile(BytesIO(original)) as source, ZipFile(malicious, "w") as target:
            for entry in source.infolist():
                data = source.read(entry)
                if entry.filename == "word/document.xml":
                    declaration, body = data.split(b"?>", 1)
                    dtd = f'<!DOCTYPE w:document [<!ENTITY leak SYSTEM "{secret.as_uri()}">]>'.encode()
                    data = declaration + b"?>" + dtd + body
                target.writestr(entry, data)
        (self.work / "Entities.docx").write_bytes(malicious.getvalue())
        result = self.call("inspect", {"path": "Entities.docx"}, "invalid-value")
        self.assertNotIn("Secret contents must stay private", json.dumps(result))

    def test_real_stdio_manifest_and_structured_errors(self):
        async def exercise():
            cwd = self.root / "cwd"
            cwd.mkdir()
            runtime = self.root / "runtime"
            runtime.mkdir()
            (runtime / "canary.txt").write_text("runtime secret", encoding="utf-8")
            parameters = StdioServerParameters(
                command=sys.executable,
                args=["-B", str(PACKAGE / "server.py"), "--workspace", str(self.work), "--actor", "Example Owner"],
                cwd=str(cwd), env={"PATH": os.environ.get("PATH", ""), "TMPDIR": str(runtime),
                                   "XDG_RUNTIME_DIR": str(runtime), "XDG_CACHE_HOME": str(runtime)},
            )
            async with stdio_client(parameters) as (read, write):
                async with ClientSession(read, write) as session:
                    await session.initialize()
                    listed = await session.list_tools()
                    self.assertEqual({tool.name for tool in listed.tools}, {tool["name"] for tool in TOOLS})
                    manifest = json.loads((PACKAGE / "kit.json").read_text(encoding="utf-8"))
                    uri = "khp://kits/" + manifest["id"] + "/kit.json"
                    resources = await session.list_resources()
                    self.assertIn(uri, [str(resource.uri) for resource in resources.resources])
                    served = await session.read_resource(uri)
                    self.assertEqual(json.loads(served.contents[0].text), manifest)
                    for tool in listed.tools:
                        failed = await session.call_tool(tool.name, {})
                        self.assertTrue(failed.isError)
                        self.assertIn("error", failed.structuredContent)
                        Draft202012Validator(tool.outputSchema).validate(failed.structuredContent)
                    inspected = await session.call_tool("docx_inspect", {"path": "basic.docx"})
                    self.assertFalse(inspected.isError)
                    self.assertNotIn("runtime secret", json.dumps(inspected.structuredContent))
                    refused = await session.call_tool("docx_inspect", {"path": str(runtime / "canary.txt")})
                    self.assertEqual(refused.structuredContent["error"]["code"], "not-allowed")
            self.assertEqual(list(cwd.iterdir()), [])
            self.assertEqual([file.name for file in runtime.iterdir()], ["canary.txt"])
        asyncio.run(exercise())


if __name__ == "__main__":
    unittest.main()
