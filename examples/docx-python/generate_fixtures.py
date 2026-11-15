"""Generate synthetic conformance documents; never run automatically at server startup."""

import sys

sys.dont_write_bytecode = True

import argparse
from pathlib import Path

from docx import Document
from docx.opc.constants import RELATIONSHIP_TYPE as RT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn


def add_link(doc, target):
    paragraph = doc.add_paragraph()
    relationship = doc.part.relate_to(target, RT.HYPERLINK, is_external=True)
    hyperlink = OxmlElement("w:hyperlink")
    hyperlink.set(qn("r:id"), relationship)
    run = OxmlElement("w:r")
    text = OxmlElement("w:t")
    text.text = "A link supplied as document data"
    run.append(text)
    hyperlink.append(run)
    paragraph._p.append(hyperlink)


def generate(folder):
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    # Never replace existing fixtures. Delete generated files explicitly before regenerating.
    for name in ("basic.docx", "links-outside.docx"):
        if (folder / name).exists():
            raise FileExistsError(f"{name} already exists; move or remove it before generating fixtures.")
    basic = Document()
    basic.add_heading("A small report", level=1)
    basic.add_paragraph("The first paragraph is ready to edit.")
    table = basic.add_table(rows=1, cols=2)
    table.cell(0, 0).text = "Task"
    table.cell(0, 1).text = "Status"
    linked = Document()
    linked.add_paragraph("Links are reported without opening their targets.")
    add_link(linked, "../outside-canary.bin")
    add_link(linked, "http://outside-canary.invalid/outside-canary.bin")
    for name, doc in (("basic.docx", basic), ("links-outside.docx", linked)):
        doc.core_properties.author = "KHP example fixture"
        with (folder / name).open("xb") as stream:
            doc.save(stream)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=Path(__file__).resolve().parent / "conformance")
    generate(parser.parse_args().out)
