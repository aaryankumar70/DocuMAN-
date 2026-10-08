from __future__ import annotations

import hashlib
import re
import uuid
from dataclasses import dataclass
from pathlib import Path

import fitz
from docx import Document as DocxDocument
from fastapi import HTTPException, UploadFile

from .config import settings

ALLOWED = {".pdf", ".docx", ".txt", ".md"}


@dataclass
class TextChunk:
    id: str
    document_id: str
    document_name: str
    page: int | None
    text: str


async def extract_upload(upload: UploadFile) -> tuple[str, int, int, bytes]:
    name = Path(upload.filename or "document").name
    suffix = Path(name).suffix.lower()
    if suffix not in ALLOWED:
        raise HTTPException(415, f"{name}: use PDF, DOCX, TXT, or MD files.")
    raw = await upload.read()
    max_bytes = settings.max_upload_mb * 1024 * 1024
    if not raw:
        raise HTTPException(400, f"{name}: file is empty.")
    if len(raw) > max_bytes:
        raise HTTPException(413, f"{name}: exceeds the {settings.max_upload_mb} MB limit.")

    pages: list[tuple[int | None, str]] = []
    try:
        if suffix == ".pdf":
            with fitz.open(stream=raw, filetype="pdf") as pdf:
                pages = [(i + 1, page.get_text("text").strip()) for i, page in enumerate(pdf)]
        elif suffix == ".docx":
            import io
            doc = DocxDocument(io.BytesIO(raw))
            text = "\n".join(p.text for p in doc.paragraphs if p.text.strip())
            for table in doc.tables:
                text += "\n" + "\n".join(" | ".join(c.text for c in row.cells) for row in table.rows)
            pages = [(None, text.strip())]
        else:
            text = raw.decode("utf-8-sig")
            pages = [(None, text.strip())]
    except Exception as exc:
        raise HTTPException(400, f"{name}: could not extract text ({exc}).") from exc

    if not any(text for _, text in pages):
        raise HTTPException(422, f"{name}: no selectable text found. Scanned PDFs need OCR first.")
    doc_id = uuid.uuid4().hex
    data_dir = Path(settings.data_dir).resolve()
    data_dir.mkdir(parents=True, exist_ok=True)
    (data_dir / f"{doc_id}{suffix}").write_bytes(raw)
    return doc_id, len(raw), len(pages), raw


def extract_chunks(document_id: str, name: str, raw: bytes) -> list[TextChunk]:
    suffix = Path(name).suffix.lower()
    if suffix == ".pdf":
        with fitz.open(stream=raw, filetype="pdf") as pdf:
            pages = [(i + 1, p.get_text("text")) for i, p in enumerate(pdf)]
    elif suffix == ".docx":
        import io
        doc = DocxDocument(io.BytesIO(raw))
        text = "\n".join(p.text for p in doc.paragraphs if p.text.strip())
        for table in doc.tables:
            text += "\n" + "\n".join(" | ".join(c.text for c in row.cells) for row in table.rows)
        pages = [(None, text)]
    else:
        pages = [(None, raw.decode("utf-8-sig"))]

    chunks: list[TextChunk] = []
    for page, text in pages:
        # Split near paragraph/sentence boundaries; preserve page provenance.
        paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
        current = ""
        for paragraph in paragraphs:
            while len(paragraph) > 1400:
                if current:
                    chunks.append(_chunk(document_id, name, page, current))
                    current = ""
                cut = paragraph.rfind(" ", 0, 1400)
                cut = cut if cut > 700 else 1400
                chunks.append(_chunk(document_id, name, page, paragraph[:cut]))
                paragraph = paragraph[cut:].strip()
            if len(current) + len(paragraph) > 1400 and current:
                chunks.append(_chunk(document_id, name, page, current))
                current = paragraph
            else:
                current = f"{current}\n{paragraph}".strip()
        if current:
            chunks.append(_chunk(document_id, name, page, current))
    return chunks


def _chunk(document_id: str, name: str, page: int | None, text: str) -> TextChunk:
    digest = hashlib.sha1(f"{document_id}:{page}:{text}".encode()).hexdigest()[:12]
    return TextChunk(f"ch_{digest}", document_id, name, page, text)
