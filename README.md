# DECIDE — Multi-Document Decision Assistant

DECIDE turns a set of source documents into an evidence-backed decision workspace. The React client keeps the prototype's three-column layout (232 px navigation, flexible analysis, 340 px assistant). FastAPI owns extraction, criteria interpretation, evidence retrieval, and deterministic scoring.

## Run locally

Requirements: Node.js 20+, Python 3.11+.

1. Copy `backend/.env.example` to `backend/.env` and set `OPENAI_API_KEY` for extraction and natural-language criteria updates. The key stays on the server.
2. Start the API:

   ```powershell
   cd backend
   py -m venv .venv
   .\.venv\Scripts\Activate.ps1
   pip install -r requirements.txt
   uvicorn app.main:app --reload
   ```

3. In a second terminal, start the UI:

   ```powershell
   cd frontend
   npm install
   npm run dev
   ```

The API stores uploaded files in a local `data/` directory and keeps the initial prototype's decision state in memory. Add authentication, tenant isolation, durable database/object storage, background jobs, and retention controls before deploying for multiple users. Supported inputs are PDF (text-based), DOCX, and TXT/MD. Scanned PDFs need an OCR service before they can be analyzed.

## Data flow

`upload → page-aware text extraction → structured option/fact extraction → validated evidence records → deterministic normalization/constraints/weighted scoring → recommendation + source links`

The LLM can interpret language and extract claims. It does not assign final scores or select the winner. Facts carry document IDs and page references; unavailable or conflicting facts remain explicit. Evidence lookup ranks source chunks lexically for this starter and can be replaced behind `retrieval.py` with embeddings/vector storage without changing the API contract.

## Semantic rules

- “Twice as important” doubles the selected criterion's current weight, then proportionally redistributes the other weights to keep the total at 100%.
- Removing a constraint requires identifying the targeted criterion. “Remove the budget constraint” removes only price; ambiguous requests ask a clarification question and mutate nothing.
- Proposed criteria changes are returned as a preview. The user applies or discards them; the UI shows before/after weights and recommendation changes.
- A constraint with missing source data is “unknown”, not a pass. It is not silently treated as satisfied.

## Project map

- `frontend/src/App.jsx` — three-column Decision Workspace and interactions
- `frontend/src/styles.css` — restrained prototype visual system and responsive layout
- `backend/app/documents.py` — file validation, extraction, chunking, upload persistence
- `backend/app/llm.py` — strict structured extraction and chat interpretation
- `backend/app/scoring.py` — deterministic normalization, constraints, ranking, scenarios
- `backend/app/retrieval.py` — cited evidence lookup
- `backend/app/main.py` — API endpoints and in-memory project orchestration

## API overview

- `POST /api/documents` multipart multi-file upload and analysis
- `GET /api/workspace` current project state and calculated decision
- `POST /api/chat` structured criteria proposal or evidence answer
- `POST /api/criteria` validate and apply explicit weights/constraints
- `POST /api/scenarios` compare alternative weights without changing current criteria
- `GET /api/documents/{id}/source?page=N` retrieve extracted text for a source page

For production, use a database for project state and object storage for source files. The in-memory starter intentionally runs without infrastructure dependencies.
