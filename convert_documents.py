from pathlib import Path
from pypdf import PdfReader

docs = Path("docs")

files = {
    "Job_to_Invoice_Developer_PRD (1).pdf": "PRD.md",
    "STANDARD OPERATING PROCEDURE.pdf": "SOP.md",
}

for pdf_name, md_name in files.items():
    pdf_path = docs / pdf_name
    md_path = docs / md_name

    if not pdf_path.exists():
        print(f"ERROR: Not found: {pdf_path}")
        continue

    reader = PdfReader(str(pdf_path))
    output = []

    for page_number, page in enumerate(reader.pages, start=1):
        text = page.extract_text() or ""

        output.append(f"\n\n<!-- SOURCE PAGE {page_number} -->\n\n")
        output.append(text)
        output.append("\n")

    md_path.write_text(
        "".join(output),
        encoding="utf-8"
    )

    print(
        f"SUCCESS: {pdf_name} -> {md_name} "
        f"({len(reader.pages)} pages)"
    )
