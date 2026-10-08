from __future__ import annotations

import uuid
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from starlette.concurrency import run_in_threadpool

from .config import settings
from .documents import TextChunk, extract_chunks, extract_upload
from .llm import extract_document, interpret_chat
from .retrieval import search
from .schemas import (ChatRequest, Constraint, CriteriaState, CriteriaUpdate,
                      Criterion, DocumentRecord, Option, ScenarioRequest, Workspace)
from .scoring import calculate

app = FastAPI(title="DECIDE API", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=settings.allowed_origins,
                   allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

documents: list[DocumentRecord] = []
options: list[Option] = []
chunks: list[TextChunk] = []
summaries: dict[str, str] = {}
criteria_state = CriteriaState(criteria=[])


@app.get("/api/health")
def health():
    return {"status": "ok", "llm_configured": bool(settings.openai_api_key)}


@app.post("/api/documents", response_model=Workspace)
async def upload_documents(files: list[UploadFile] = File(...)):
    global documents, options, chunks, summaries, criteria_state
    if not files:
        raise HTTPException(400, "Select at least one document.")
    if len(files) > 20:
        raise HTTPException(413, "Upload up to 20 documents at a time.")
    added_documents: list[DocumentRecord] = []
    added_options: list[Option] = []
    added_chunks: list[TextChunk] = []
    added_summaries: dict[str, str] = {}
    for upload in files:
        doc_id, size, page_count, raw = await extract_upload(upload)
        name = upload.filename or "document"
        doc_chunks = extract_chunks(doc_id, name, raw)
        try:
            extracted, summary = await run_in_threadpool(extract_document, doc_chunks)
        except Exception as exc:
            raise HTTPException(502, f"Analysis failed for {name}: {exc}") from exc
        added_chunks.extend(doc_chunks)
        added_options.extend(extracted)
        added_summaries[doc_id] = summary
        added_documents.append(DocumentRecord(id=doc_id, name=name, size=size, pages=page_count,
                                              summary=summary, status="ready"))
    documents.extend(added_documents)
    options.extend(added_options)
    chunks.extend(added_chunks)
    summaries.update(added_summaries)
    if not options:
        raise HTTPException(422, "No named alternatives were identified in the uploaded documents.")
    # Start with numeric attributes found across alternatives. Weights are evenly distributed.
    attributes: dict[str, tuple[str, str | None]] = {}
    for option in options:
        for fact in option.facts:
            if fact.numeric_value is not None:
                attributes.setdefault(fact.attribute.casefold(), (fact.attribute, fact.unit))
    old_by_attribute = {c.attribute.casefold(): c for c in criteria_state.criteria}
    criteria = []
    names = list(attributes.values())
    new_names = [(name, unit) for name, unit in names if name.casefold() not in old_by_attribute]
    if not criteria_state.criteria:
        each = 1 / len(names) if names else 0
        old_scale, new_share = 0.0, 1.0
    else:
        new_share = min(0.5, 0.05 * len(new_names))
        old_scale = 1 - new_share
        each = new_share / len(new_names) if new_names else 0
    for name, unit in names:
        existing = old_by_attribute.get(name.casefold())
        if existing:
            criteria.append(existing.model_copy(update={"weight": existing.weight * old_scale}))
            continue
        first = next((f for o in options for f in o.facts if f.attribute.casefold() == name.casefold() and f.numeric_value is not None), None)
        direction = first.direction if first and first.direction in {"higher", "lower", "target"} else "higher"
        criteria.append(Criterion(id=f"c_{uuid.uuid4().hex[:8]}", name=name, attribute=name,
                                  weight=each, direction=direction, unit=unit))
    criteria_state = CriteriaState(criteria=criteria, constraints=criteria_state.constraints)
    return workspace()


@app.get("/api/workspace", response_model=Workspace)
def get_workspace():
    return workspace()


@app.post("/api/criteria", response_model=Workspace)
def update_criteria(request: CriteriaUpdate):
    global criteria_state
    valid_ids = {c.id for c in criteria_state.criteria}
    if {c.id for c in request.state.criteria} != valid_ids:
        raise HTTPException(422, "Criteria IDs must match the current workspace.")
    criteria_state = request.state
    return workspace()


@app.post("/api/chat")
def chat(request: ChatRequest):
    try:
        proposal = interpret_chat(request.message, criteria_state, options)
    except Exception as exc:
        raise HTTPException(502, f"Assistant could not interpret that request: {exc}") from exc
    if proposal.needs_clarification:
        return {"proposal": proposal, "evidence": []}
    if proposal.scenario_only and proposal.proposed_state:
        scenario_state = _rebalance_if_needed(proposal.proposed_state)
        simulated = calculate(options, scenario_state)
        current = calculate(options, criteria_state)
        scenario_winner = next((o for o in simulated.options if o.option_id == simulated.recommendation_id), None)
        current_winner = next((o for o in current.options if o.option_id == current.recommendation_id), None)
        proposal.reply += (f"\n\nScenario result: {scenario_winner.option_name} ({scenario_winner.score:.2f})" if scenario_winner else "\n\nScenario result: no eligible option")
        proposal.reply += (f". Current recommendation: {current_winner.option_name} ({current_winner.score:.2f})." if current_winner else ". There is no current eligible recommendation.")
        proposal.proposed_state = None
        return {"proposal": proposal, "evidence": [], "scenario": simulated}
    if proposal.intent == "evidence_question" or any(term in request.message.casefold() for term in ("source", "evidence", "where does", "which document")):
        refs = search(request.message, chunks)
        if refs:
            proposal.reply += "\n\nRelevant source passages: " + " · ".join(
                f"{ref.document_name}{f', page {ref.page}' if ref.page else ''}: {ref.quote[:160]}" for ref in refs)
        else:
            proposal.reply += "\n\nI could not find a matching passage in the uploaded documents."
        return {"proposal": proposal, "evidence": refs}
    if proposal.proposed_state and not proposal.scenario_only:
        try:
            proposal.proposed_state = _rebalance_if_needed(proposal.proposed_state)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
    return {"proposal": proposal, "evidence": []}


@app.post("/api/scenarios")
def scenario(request: ScenarioRequest):
    current_ids = {c.id for c in criteria_state.criteria}
    if set(request.weights) != current_ids or any(v < 0 or v > 1 for v in request.weights.values()):
        raise HTTPException(422, "Scenario weights must include each criterion and be between 0 and 1.")
    if abs(sum(request.weights.values()) - 1) > 0.005:
        raise HTTPException(422, "Scenario weights must sum to 100%.")
    scenario_state = CriteriaState(criteria=[c.model_copy(update={"weight": request.weights[c.id]}) for c in criteria_state.criteria],
                                   constraints=criteria_state.constraints)
    return {"name": request.name, "decision": calculate(options, scenario_state), "current": calculate(options, criteria_state)}


@app.get("/api/documents/{document_id}/source")
def source_page(document_id: str, page: int | None = None):
    doc = next((d for d in documents if d.id == document_id), None)
    if not doc:
        raise HTTPException(404, "Document not found.")
    matches = [c for c in chunks if c.document_id == document_id and (page is None or c.page == page)]
    return {"document": doc, "chunks": matches}


def workspace() -> Workspace:
    return Workspace(documents=documents, options=options, criteria_state=criteria_state,
                     decision=calculate(options, criteria_state))


def _rebalance_if_needed(state: CriteriaState) -> CriteriaState:
    total = sum(c.weight for c in state.criteria)
    if not state.criteria:
        return state
    if total <= 0:
        raise ValueError("At least one criterion must have a positive weight.")
    # LLM-proposed percentages are accepted after normalization to make rounding safe.
    if abs(total - 1) > 0.0001:
        state.criteria = [c.model_copy(update={"weight": c.weight / total}) for c in state.criteria]
    return state
