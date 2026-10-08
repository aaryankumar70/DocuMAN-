import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  CircleHelp,
  FileText,
  FlaskConical,
  Menu,
  MessageSquareText,
  Paperclip,
  Plus,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  X,
} from 'lucide-react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000';

const pct = (n) => `${Math.round(n * 100)}%`;

const money = (n) =>
  new Intl.NumberFormat('en-IN', {
    maximumFractionDigits: 0,
  }).format(n);

async function request(path, options = {}) {
  const res = await fetch(`${API}${path}`, options);

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Request failed (${res.status})`);
  }

  return res.json();
}

export default function App() {
  const [workspace, setWorkspace] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [view, setView] = useState('workspace');
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState([]);
  const [proposal, setProposal] = useState(null);
  const [scenario, setScenario] = useState(null);
  const [scenarioResult, setScenarioResult] = useState(null);
  const [showScenario, setShowScenario] = useState(false);
  const [source, setSource] = useState(null);
  const [activeCriterion, setActiveCriterion] = useState(null);
  const [mobileChat, setMobileChat] = useState(false);

  const fileInput = useRef(null);
  const chatEnd = useRef(null);

  useEffect(() => {
    request('/api/workspace')
      .then(setWorkspace)
      .catch(() => {});
  }, []);

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, proposal]);

  const decision = workspace?.decision;
  const criteriaState = workspace?.criteria_state;

  const winner = decision?.options.find(
    (o) => o.option_id === decision.recommendation_id
  );

  const sorted = decision?.options || [];

  async function upload(files) {
    if (!files?.length) return;

    setBusy(true);
    setError('');
    setMessages([]);
    setProposal(null);

    try {
      const form = new FormData();

      [...files].forEach((file) => {
        form.append('files', file);
      });

      setWorkspace(
        await request('/api/documents', {
          method: 'POST',
          body: form,
        })
      );

      setView('workspace');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);

      if (fileInput.current) {
        fileInput.current.value = '';
      }
    }
  }

  async function send(text = message) {
    const clean = text.trim();

    if (!clean || busy) return;

    setMessage('');
    setMessages((prev) => [
      ...prev,
      {
        role: 'user',
        text: clean,
      },
    ]);

    setBusy(true);
    setError('');

    try {
      const result = await request('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: clean,
        }),
      });

      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          text: result.proposal.reply,
          evidence: result.evidence,
        },
      ]);

      setProposal(
        result.proposal.proposed_state
          ? result.proposal
          : null
      );

      if (
        result.proposal.needs_clarification &&
        result.proposal.clarification_question
      ) {
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            text: result.proposal.clarification_question,
          },
        ]);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function applyProposal() {
    if (!proposal?.proposed_state) return;

    setBusy(true);
    setError('');

    try {
      setWorkspace(
        await request('/api/criteria', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            state: proposal.proposed_state,
          }),
        })
      );

      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          text: 'Criteria updated. The matrix and recommendation now reflect this change.',
        },
      ]);

      setProposal(null);
      setScenario(null);
      setScenarioResult(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function setWeight(id, value) {
    const criteria = criteriaState.criteria;

    const next = criteria.map((c) => ({
      ...c,
      weight: c.id === id ? value : c.weight,
    }));

    const others = next.filter((c) => c.id !== id);

    const oldRest = criteria
      .filter((c) => c.id !== id)
      .reduce((a, c) => a + c.weight, 0);

    let remaining = 1 - value;

    others.forEach((c, i) => {
      c.weight =
        i === others.length - 1
          ? remaining
          : oldRest
            ? (criteria.find((o) => o.id === c.id).weight / oldRest) *
              (1 - value)
            : (1 - value) / others.length;

      remaining -= c.weight;
    });

    setBusy(true);

    try {
      setWorkspace(
        await request('/api/criteria', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            state: {
              ...criteriaState,
              criteria: next,
            },
          }),
        })
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function runScenario() {
    if (!criteriaState?.criteria.length) return;

    setBusy(true);
    setError('');

    const weights = Object.fromEntries(
      criteriaState.criteria.map((c) => [
        c.id,
        scenario?.[c.id] ?? c.weight,
      ])
    );

    try {
      setScenarioResult(
        await request('/api/scenarios', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: 'Priority scenario',
            weights,
          }),
        })
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function openSource(ref) {
    try {
      setSource(
        await request(
          `/api/documents/${ref.document_id}/source${
            ref.page ? `?page=${ref.page}` : ''
          }`
        )
      );
    } catch (e) {
      setError(e.message);
    }
  }

  const recommendations = useMemo(
    () => [
      'Why does the leading option rank first?',
      'Which option has the strongest evidence for my top criterion?',
      'What if price were twice as important?',
    ],
    []
  );

  return (
    <div className="app-shell">
      <header className="topbar">
        <button
          className="brand"
          onClick={() => setView('workspace')}
          aria-label="DECIDE home"
        >
          <span className="brand-name">DECIDE</span>
          <span className="brand-caption">
            MULTI-DOCUMENT DECISION ASSISTANT
          </span>
        </button>

        <nav className="top-nav">
          <button
            className={view === 'workspace' ? 'on' : ''}
            onClick={() => setView('workspace')}
          >
            Decision workspace
          </button>

          <button
            className={view === 'documents' ? 'on' : ''}
            onClick={() => setView('documents')}
          >
            Documents{' '}
            <span className="count">
              {workspace?.documents.length || 0}
            </span>
          </button>
        </nav>

        <button
          className="icon-button mobile-menu"
          onClick={() => setMobileChat(!mobileChat)}
        >
          <Menu size={17} />
          <span>Assistant</span>
        </button>

        <div className="top-status">
          <span className="status-dot" />
          {busy ? 'Processing' : 'Workspace ready'}
        </div>
      </header>

      <div className="workspace-grid">
        <aside className="sidebar">
          <div className="side-label">DECISION</div>

          <button
            className={`side-link ${
              view === 'workspace' ? 'selected' : ''
            }`}
            onClick={() => setView('workspace')}
          >
            <SlidersHorizontal size={15} />
            Overview
          </button>

          <button
            className={`side-link ${
              view === 'documents' ? 'selected' : ''
            }`}
            onClick={() => setView('documents')}
          >
            <FileText size={15} />
            Sources
            <span className="side-count">
              {workspace?.documents.length || 0}
            </span>
          </button>

          <button
            className="side-link"
            onClick={() =>
              document
                .getElementById('criteria')
                ?.scrollIntoView({ behavior: 'smooth' })
            }
          >
            <Check size={15} />
            Criteria
          </button>

          <button
            className="side-link"
            onClick={() =>
              document
                .getElementById('matrix')
                ?.scrollIntoView({ behavior: 'smooth' })
            }
          >
            <FlaskConical size={15} />
            Decision matrix
          </button>

          <div className="side-label side-label-space">
            SOURCE DOCUMENTS
          </div>

          {workspace?.documents.map((doc) => (
            <button
              className="doc-nav"
              key={doc.id}
              onClick={() => setView('documents')}
              title={doc.name}
            >
              <FileText size={14} />
              <span>{doc.name}</span>
            </button>
          ))}

          <button
            className="add-source"
            onClick={() => fileInput.current?.click()}
          >
            <Plus size={14} />
            Add documents
          </button>

          <div className="sidebar-note">
            <ShieldCheck size={15} />
            <span>
              Scores are calculated from cited facts and your
              criteria.
            </span>
          </div>
        </aside>

        <main className="main-content">
          {error && (
            <div className="error-banner">
              <CircleHelp size={16} />
              <span>{error}</span>

              <button
                onClick={() => setError('')}
                aria-label="Dismiss"
              >
                <X size={15} />
              </button>
            </div>
          )}

          {view === 'documents' ? (
            <DocumentsView
              documents={workspace?.documents || []}
              onUpload={() => fileInput.current?.click()}
              onOpen={openSource}
            />
          ) : workspace?.documents.length ? (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">
                    DECISION WORKSPACE <span>·</span>{' '}
                    {workspace.documents.length} SOURCE
                    {workspace.documents.length === 1 ? '' : 'S'}
                  </div>

                  <h1>Compare your options</h1>

                  <p>
                    Priorities, evidence, and calculated results
                    in one place.
                  </p>
                </div>

                <button
                  className="button secondary add-top"
                  onClick={() => fileInput.current?.click()}
                >
                  <Plus size={15} />
                  Add sources
                </button>
              </div>

              <section
                className="recommendation-section"
                aria-label="Recommendation"
              >
                <div className="section-kicker">
                  <span>CURRENT RECOMMENDATION</span>

                  <span className="match-tag">
                    <ShieldCheck size={13} />
                    Based on your priorities
                  </span>
                </div>

                {winner ? (
                  <div className="recommendation">
                    <div className="rec-main">
                      <div className="recommend-mark">
                        <Check size={16} />
                      </div>

                      <div>
                        <div className="rec-title-row">
                          <h2>{winner.option_name}</h2>
                          <span className="rec-label">
                            RECOMMENDED
                          </span>
                        </div>

                        <p>
                          {decision.recommendation_explanation}
                        </p>
                      </div>

                      <div className="rec-score">
                        <strong>
                          {winner.score?.toFixed(1) ?? '—'}
                        </strong>
                        <span>/ 10</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="empty-recommendation">
                    {decision.recommendation_explanation}
                  </div>
                )}

                {winner && (
                  <div className="rec-reasons">
                    {criteriaState.criteria
                      .slice(0, 3)
                      .map((c) => {
                        const cell =
                          winner.criterion_scores[c.id];

                        return (
                          <div
                            className="reason"
                            key={c.id}
                          >
                            <span>
                              {c.name}{' '}
                              <b>{pct(c.weight)}</b>
                            </span>

                            <div className="mini-track">
                              <i
                                style={{
                                  width: `${
                                    (cell?.score || 0) * 10
                                  }%`,
                                }}
                              />
                            </div>

                            <small>
                              {cell?.score == null
                                ? 'No comparable value'
                                : `${cell.score.toFixed(
                                    1
                                  )} / 10`}
                            </small>
                          </div>
                        );
                      })}
                  </div>
                )}

                {winner && (
                  <div className="rec-foot">
                    <span>
                      <ShieldCheck size={14} />
                      A match to your priorities, not a
                      universal verdict. Evidence covers{' '}
                      {pct(winner.evidence_coverage)} of criterion
                      weight.
                    </span>

                    <button
                      className="text-button"
                      onClick={() =>
                        document
                          .getElementById('matrix')
                          ?.scrollIntoView({
                            behavior: 'smooth',
                          })
                      }
                    >
                      Inspect calculation
                      <ArrowDown size={14} />
                    </button>
                  </div>
                )}
              </section>

              <section
                id="criteria"
                className="content-section criteria-section"
              >
                <div className="section-heading">
                  <div>
                    <div className="eyebrow">
                      DECISION MODEL
                    </div>

                    <h2>Criteria and constraints</h2>

                    <p>
                      Adjust any priority. Remaining weights
                      rebalance proportionally.
                    </p>
                  </div>

                  <button
                    className="button secondary"
                    onClick={() => {
                      setShowScenario(true);
                      setScenarioResult(null);
                      setScenario(
                        Object.fromEntries(
                          criteriaState.criteria.map((c) => [
                            c.id,
                            c.weight,
                          ])
                        )
                      );
                    }}
                  >
                    <FlaskConical size={15} />
                    Scenario mode
                  </button>
                </div>

                {criteriaState.criteria.length ? (
                  <div className="criteria-list">
                    {criteriaState.criteria.map((c) => (
                      <div
                        className="criterion-row"
                        key={c.id}
                      >
                        <div className="criterion-name">
                          <b>{c.name}</b>

                          <span>
                            {c.direction === 'lower'
                              ? 'Lower is better'
                              : c.direction === 'target'
                                ? 'Target value'
                                : 'Higher is better'}
                          </span>
                        </div>

                        <div className="weight-control">
                          <input
                            aria-label={`${c.name} weight`}
                            type="range"
                            min="0"
                            max={
                              criteriaState.criteria.length === 1
                                ? 1
                                : 0.8
                            }
                            step="0.01"
                            value={c.weight}
                            disabled={
                              busy ||
                              criteriaState.criteria.length === 1
                            }
                            onChange={(e) =>
                              setWeight(
                                c.id,
                                Number(e.target.value)
                              )
                            }
                          />

                          <div className="weight-track-label">
                            <span>0%</span>

                            <span>
                              {criteriaState.criteria.length === 1
                                ? '100%'
                                : '80%'}
                            </span>
                          </div>
                        </div>

                        <strong className="weight-value">
                          {pct(c.weight)}
                        </strong>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="quiet-note">
                    No comparable numeric criteria were extracted.
                    You can still inspect source summaries and ask
                    the assistant about them.
                  </p>
                )}

                {criteriaState.constraints.length > 0 && (
                  <div className="constraint-list">
                    <div className="constraint-title">
                      ACTIVE CONSTRAINTS
                    </div>

                    {criteriaState.constraints.map((c, i) => (
                      <div
                        className="constraint-chip"
                        key={i}
                      >
                        <span>
                          {
                            criteriaState.criteria.find(
                              (x) =>
                                x.id === c.criterion_id
                            )?.name
                          }{' '}
                          {c.operator === 'gte'
                            ? '≥'
                            : c.operator === 'lte'
                              ? '≤'
                              : '='}{' '}
                          {c.value} {c.unit}
                        </span>

                        <span>
                          Applied to eligible options
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section
                id="matrix"
                className="content-section matrix-section"
              >
                <div className="section-heading">
                  <div>
                    <div className="eyebrow">
                      CALCULATED COMPARISON
                    </div>

                    <h2>Decision matrix</h2>

                    <p>
                      Numeric values are normalized across the
                      uploaded options. Select a score to inspect
                      its source.
                    </p>
                  </div>

                  <button
                    className="help-button"
                    title="Final score is the weighted average of available normalized criteria. Options missing a constrained value are ineligible."
                  >
                    <CircleHelp size={16} />
                  </button>
                </div>

                <div className="table-wrap">
                  <table className="matrix">
                    <thead>
                      <tr>
                        <th>Criterion</th>
                        <th>Weight</th>

                        {sorted.map((o) => (
                          <th
                            key={o.option_id}
                            className={
                              o.option_id === winner?.option_id
                                ? 'leading-col'
                                : ''
                            }
                          >
                            {o.option_name}
                          </th>
                        ))}
                      </tr>
                    </thead>

                    <tbody>
                      {criteriaState.criteria.map((c) => (
                        <tr key={c.id}>
                          <th>
                            <button
                              className="criterion-inspect"
                              onClick={() =>
                                setActiveCriterion(
                                  activeCriterion === c.id
                                    ? null
                                    : c.id
                                )
                              }
                            >
                              {c.name}
                              <ChevronDown size={12} />
                            </button>

                            {activeCriterion === c.id && (
                              <div className="criterion-explainer">
                                Normalized to 0–10 from reported
                                document values.{' '}
                                {c.direction === 'lower'
                                  ? 'Lower values score higher.'
                                  : 'Higher values score higher.'}
                              </div>
                            )}
                          </th>

                          <td className="weight-cell">
                            {pct(c.weight)}
                          </td>

                          {sorted.map((o) => {
                            const cell =
                              o.criterion_scores[c.id];

                            const maxScore = Math.max(
                              ...sorted.map(
                                (x) =>
                                  x.criterion_scores[c.id]
                                    ?.score ?? -1
                              )
                            );

                            const isBest =
                              cell?.score != null &&
                              cell.score === maxScore;

                            return (
                              <td
                                key={o.option_id}
                                className={`${o.option_id === winner?.option_id ? 'leading-col ' : ''}${
                                  isBest ? 'best-cell' : ''
                                }`}
                              >
                                <button
                                  className="score-button"
                                  disabled={
                                    !cell?.evidence?.length
                                  }
                                  onClick={() =>
                                    cell?.evidence?.[0] &&
                                    openSource(
                                      cell.evidence[0]
                                    )
                                  }
                                >
                                  <span>
                                    {cell?.score == null
                                      ? '—'
                                      : cell.score.toFixed(1)}
                                  </span>

                                  {cell?.evidence?.length > 0 && (
                                    <FileText size={12} />
                                  )}
                                </button>
                              </td>
                            );
                          })}
                        </tr>
                      ))}

                      <tr className="final-row">
                        <th>Weighted score</th>

                        <td>—</td>

                        {sorted.map((o) => (
                          <td
                            key={o.option_id}
                            className={
                              o.option_id === winner?.option_id
                                ? 'leading-col'
                                : ''
                            }
                          >
                            <b>
                              {o.score == null
                                ? '—'
                                : o.score.toFixed(2)}
                            </b>

                            {!o.eligible && (
                              <span className="ineligible">
                                Excluded
                              </span>
                            )}
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div className="matrix-legend">
                  <span>
                    <i className="legend-best" />
                    Best observed score for criterion
                  </span>

                  <span>
                    — = source value missing or qualitative
                  </span>
                </div>
              </section>

              <section className="content-section options-section">
                <div className="section-heading">
                  <div>
                    <div className="eyebrow">
                      OPTION REVIEW
                    </div>

                    <h2>Strengths and trade-offs</h2>
                  </div>
                </div>

                {workspace.options.map((o) => (
                  <article
                    className="option-review"
                    key={o.id}
                  >
                    <div className="option-head">
                      <div>
                        <h3>{o.name}</h3>
                        <p>{o.summary}</p>
                      </div>

                      <button
                        className="text-button"
                        onClick={() =>
                          setView('documents')
                        }
                      >
                        Sources
                        <ArrowDown size={13} />
                      </button>
                    </div>

                    <div className="pros-cons">
                      <div>
                        <span className="good-label">
                          Strengths
                        </span>

                        {o.pros.length ? (
                          o.pros.map((p, i) => (
                            <p key={i}>{p}</p>
                          ))
                        ) : (
                          <p className="quiet-note">
                            No supporting points extracted
                          </p>
                        )}
                      </div>

                      <div>
                        <span className="trade-label">
                          Trade-offs
                        </span>

                        {o.cons.length ? (
                          o.cons.map((p, i) => (
                            <p key={i}>{p}</p>
                          ))
                        ) : (
                          <p className="quiet-note">
                            No trade-offs extracted
                          </p>
                        )}
                      </div>
                    </div>
                  </article>
                ))}
              </section>

              <section className="content-section followups">
                <div className="section-heading">
                  <div>
                    <div className="eyebrow">
                      CONTINUE THE ANALYSIS
                    </div>

                    <h2>Questions worth asking</h2>
                  </div>
                </div>

                <div className="followup-grid">
                  {decision.follow_up_questions.map((q) => (
                    <button
                      key={q}
                      onClick={() => {
                        setMobileChat(true);
                        send(q);
                      }}
                    >
                      {q}
                      <ArrowUp size={14} />
                    </button>
                  ))}
                </div>
              </section>
            </>
          ) : (
            <EmptyState
              onUpload={() => fileInput.current?.click()}
              onDrop={upload}
              busy={busy}
            />
          )}
        </main>

        <aside
          className={`assistant ${
            mobileChat ? 'assistant-open' : ''
          }`}
        >
          <header className="assistant-head">
            <div className="assistant-title">
              <span className="assistant-mark">
                <Sparkles size={15} />
              </span>

              <div>
                <b>DECIDE assistant</b>
                <span>Criteria and evidence</span>
              </div>
            </div>

            <button
              className="close-assistant"
              onClick={() => setMobileChat(false)}
            >
              <X size={17} />
            </button>
          </header>

          <div className="assistant-context">
            <span className="context-dot" />

            {workspace?.documents.length
              ? `${workspace.documents.length} sources in this decision`
              : 'Upload documents to begin'}
          </div>

          <div className="messages">
            {!messages.length && (
              <div className="welcome-message">
                <div className="welcome-icon">
                  <MessageSquareText size={19} />
                </div>

                <h3>
                  Refine the decision in plain language
                </h3>

                <p>
                  Change priorities, set a constraint, ask why an
                  option ranks first, or check a source. I’ll show
                  a preview before applying criteria changes.
                </p>

                {workspace?.documents.length > 0 && (
                  <div className="suggestions">
                    {recommendations.map((q) => (
                      <button
                        key={q}
                        onClick={() => send(q)}
                      >
                        {q}
                        <ArrowUp size={13} />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {messages.map((m, i) => (
              <div
                className={`message ${m.role}`}
                key={i}
              >
                <span className="message-who">
                  {m.role === 'user' ? 'YOU' : 'DECIDE'}
                </span>

                <div className="message-body">
                  {m.text
                    .split('\n')
                    .map((line, j) => (
                      <p key={j}>{line}</p>
                    ))}

                  {m.evidence?.length > 0 && (
                    <div className="message-evidence">
                      {m.evidence.map((ref, k) => (
                        <button
                          key={k}
                          onClick={() =>
                            openSource(ref)
                          }
                        >
                          <FileText size={13} />
                          {ref.document_name}
                          {ref.page
                            ? ` · p.${ref.page}`
                            : ''}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {proposal && (
              <div className="proposal-card">
                <div className="proposal-label">
                  <span>
                    PROPOSED CRITERIA CHANGE
                  </span>
                  <span>Preview</span>
                </div>

                <p>
                  Review how priorities will change before
                  applying.
                </p>

                {proposal.proposed_state.criteria.map(
                  (c) => {
                    const old =
                      criteriaState.criteria.find(
                        (x) => x.id === c.id
                      );

                    const diff = Math.round(
                      (c.weight -
                        (old?.weight || 0)) *
                        100
                    );

                    return (
                      <div
                        className="proposal-weight"
                        key={c.id}
                      >
                        <span>{c.name}</span>

                        <div>
                          <b>
                            {pct(old?.weight || 0)}
                          </b>

                          <ArrowDown size={12} />

                          <strong>
                            {pct(c.weight)}
                          </strong>
                        </div>

                        <small
                          className={
                            diff > 0
                              ? 'up'
                              : diff < 0
                                ? 'down'
                                : ''
                          }
                        >
                          {diff > 0 ? '+' : ''}
                          {diff} pts
                        </small>
                      </div>
                    );
                  }
                )}

                <div className="proposal-actions">
                  <button
                    className="button primary"
                    onClick={applyProposal}
                    disabled={busy}
                  >
                    <Check size={14} />
                    Apply and recalculate
                  </button>

                  <button
                    className="button plain"
                    onClick={() => setProposal(null)}
                  >
                    Discard
                  </button>
                </div>
              </div>
            )}

            {busy && (
              <div className="typing">
                <span />
                <span />
                <span />
                Working from your sources
              </div>
            )}

            <div ref={chatEnd} />
          </div>

          <div className="quick-prompts">
            {workspace?.documents.length > 0 && (
              <>
                <button
                  onClick={() =>
                    send(
                      'Where does the document state the leading option’s value for my top criterion?'
                    )
                  }
                >
                  Find evidence
                </button>

                <button
                  onClick={() => setShowScenario(true)}
                >
                  What-if scenario
                </button>
              </>
            )}
          </div>

          <form
            className="composer"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <button
              type="button"
              className="attach-button"
              onClick={() =>
                fileInput.current?.click()
              }
              title="Add documents"
            >
              <Paperclip size={16} />
            </button>

            <input
              disabled={
                !workspace?.documents.length || busy
              }
              value={message}
              onChange={(e) =>
                setMessage(e.target.value)
              }
              placeholder={
                workspace?.documents.length
                  ? 'Ask about criteria or evidence…'
                  : 'Upload documents to begin'
              }
              aria-label="Message DECIDE assistant"
            />

            <button
              className="send-button"
              type="submit"
              disabled={!message.trim() || busy}
            >
              <Send size={15} />
            </button>
          </form>

          <div className="assistant-disclaimer">
            The decision engine calculates scores. AI
            interprets language and sources.
          </div>
        </aside>
      </div>

      <input
        ref={fileInput}
        className="visually-hidden"
        type="file"
        multiple
        accept=".pdf,.docx,.txt,.md"
        onChange={(e) =>
          upload(e.target.files)
        }
      />

      {showScenario && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) =>
            e.target === e.currentTarget &&
            setShowScenario(false)
          }
        >
          <section className="scenario-modal">
            <div className="modal-heading">
              <div>
                <div className="eyebrow">
                  SENSITIVITY ANALYSIS
                </div>

                <h2>Compare a priority scenario</h2>

                <p>
                  Explore different weights without changing
                  your current decision.
                </p>
              </div>

              <button
                className="icon-button"
                onClick={() =>
                  setShowScenario(false)
                }
              >
                <X size={17} />
              </button>
            </div>

            {criteriaState?.criteria.map((c) => (
              <div
                className="scenario-control"
                key={c.id}
              >
                <div>
                  <b>{c.name}</b>

                  <strong>
                    {pct(
                      scenario?.[c.id] ?? c.weight
                    )}
                  </strong>
                </div>

                <input
                  type="range"
                  min="0"
                  max="0.8"
                  step="0.01"
                  value={
                    scenario?.[c.id] ?? c.weight
                  }
                  onChange={(e) => {
                    const raw = {
                      ...scenario,
                      [c.id]: Number(e.target.value),
                    };

                    const total = Object.values(
                      raw
                    ).reduce(
                      (a, b) => a + b,
                      0
                    );

                    if (total === 0) return;

                    setScenario(
                      Object.fromEntries(
                        Object.entries(raw).map(
                          ([k, v]) => [
                            k,
                            v / total,
                          ]
                        )
                      )
                    );

                    setScenarioResult(null);
                  }}
                />
              </div>
            ))}

            <div className="scenario-total">
              Weights are normalized to 100% as you adjust
              them.
            </div>

            <div className="modal-actions">
              <button
                className="button secondary"
                onClick={() =>
                  setShowScenario(false)
                }
              >
                Close
              </button>

              <button
                className="button primary"
                onClick={runScenario}
                disabled={busy}
              >
                <FlaskConical size={15} />
                Calculate scenario
              </button>
            </div>

            {scenarioResult && (
              <div className="scenario-results">
                <div className="scenario-result-col">
                  <span>CURRENT</span>

                  <b>
                    {scenarioResult.current.options.find(
                      (x) =>
                        x.option_id ===
                        scenarioResult.current
                          .recommendation_id
                    )?.option_name ||
                      'No eligible option'}
                  </b>
                </div>

                <ArrowDown size={15} />

                <div className="scenario-result-col">
                  <span>SCENARIO</span>

                  <b>
                    {scenarioResult.decision.options.find(
                      (x) =>
                        x.option_id ===
                        scenarioResult.decision
                          .recommendation_id
                    )?.option_name ||
                      'No eligible option'}
                  </b>
                </div>
              </div>
            )}
          </section>
        </div>
      )}

      {source && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) =>
            e.target === e.currentTarget &&
            setSource(null)
          }
        >
          <section className="source-modal">
            <div className="modal-heading">
              <div>
                <div className="eyebrow">
                  SOURCE EVIDENCE
                </div>

                <h2>{source.document.name}</h2>

                <p>
                  {source.document.pages} pages · Extracted
                  text with source references
                </p>
              </div>

              <button
                className="icon-button"
                onClick={() => setSource(null)}
              >
                <X size={17} />
              </button>
            </div>

            {source.chunks.map((chunk) => (
              <article
                className="source-chunk"
                key={chunk.id}
              >
                <span>
                  PAGE {chunk.page || 'NOT PAGINATED'}
                </span>

                <p>{chunk.text}</p>
              </article>
            ))}
          </section>
        </div>
      )}
    </div>
  );
}

function EmptyState({
  onUpload,
  onDrop,
  busy,
}) {
  const [dragging, setDragging] =
    useState(false);

  return (
    <div className="empty-state">
      <div className="empty-eyebrow">
        DECIDE · DECISION INTELLIGENCE
      </div>

      <h1>
        Make a clear decision
        <br />
        from scattered documents.
      </h1>

      <p>
        Bring proposals, specifications, or reports
        together. DECIDE extracts comparable facts,
        shows its sources, and calculates a
        recommendation around your priorities.
      </p>

      <div
        className={`upload-zone ${
          dragging ? 'dragging' : ''
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() =>
          setDragging(false)
        }
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          onDrop(e.dataTransfer.files);
        }}
      >
        <div className="upload-icon">
          <FileText size={21} />
        </div>

        <b>
          {busy
            ? 'Analyzing documents…'
            : 'Add the documents you want to compare'}
        </b>

        <span>
          PDF, DOCX, TXT, or Markdown · Up to 25 MB each
        </span>

        <button
          className="button primary"
          onClick={onUpload}
          disabled={busy}
        >
          <Plus size={15} />
          Choose documents
        </button>
      </div>

      <div className="empty-steps">
        <div>
          <span>01</span>
          <b>Upload</b>
          <small>Source documents</small>
        </div>

        <div>
          <span>02</span>
          <b>Review</b>
          <small>Extracted facts and citations</small>
        </div>

        <div>
          <span>03</span>
          <b>Decide</b>
          <small>
            Transparent scores and trade-offs
          </small>
        </div>
      </div>
    </div>
  );
}

function DocumentsView({
  documents,
  onUpload,
  onOpen,
}) {
  return (
    <div className="documents-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            SOURCE LIBRARY
          </div>

          <h1>Documents</h1>

          <p>
            Files analyzed for this decision and
            their extracted summaries.
          </p>
        </div>

        <button
          className="button primary"
          onClick={onUpload}
        >
          <Plus size={15} />
          Add documents
        </button>
      </div>

      {documents.length ? (
        <div className="document-list">
          {documents.map((doc) => (
            <article
              className="document-card"
              key={doc.id}
            >
              <div className="doc-icon">
                <FileText size={18} />
              </div>

              <div className="document-info">
                <div>
                  <h2>{doc.name}</h2>

                  <span className="doc-meta">
                    {(doc.size / 1024 / 1024).toFixed(
                      2
                    )}{' '}
                    MB ·{' '}
                    {doc.pages
                      ? `${doc.pages} pages`
                      : 'Page references unavailable'}
                  </span>
                </div>

                <span className="ready-badge">
                  <Check size={12} />
                  Analyzed
                </span>

                <p>{doc.summary}</p>

                <div className="document-actions">
                  <button
                    className="text-button"
                    onClick={() =>
                      onOpen({
                        document_id: doc.id,
                      })
                    }
                  >
                    Open extracted text
                    <ArrowDown size={13} />
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="quiet-note">
          No sources added yet.
        </div>
      )}
    </div>
  );
}