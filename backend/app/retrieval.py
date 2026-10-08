from __future__ import annotations

import re
from .documents import TextChunk
from .schemas import SourceRef


def search(query: str, chunks: list[TextChunk], limit: int = 5) -> list[SourceRef]:
    terms = {t for t in re.findall(r"[\w₹.-]+", query.casefold()) if len(t) > 1}
    ranked = []
    for chunk in chunks:
        text = chunk.text.casefold()
        overlap = sum(text.count(term) for term in terms)
        if overlap:
            ranked.append((overlap, chunk))
    ranked.sort(key=lambda row: row[0], reverse=True)
    refs = []
    for _, chunk in ranked[:limit]:
        snippet = chunk.text[:320].strip()
        refs.append(SourceRef(document_id=chunk.document_id, document_name=chunk.document_name,
                              page=chunk.page, chunk_id=chunk.id, quote=snippet))
    return refs
