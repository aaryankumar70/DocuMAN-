from __future__ import annotations

from .schemas import (Constraint, CriteriaState, DecisionResult, Option, RankedOption,
                      ScoreCell)


def calculate(options: list[Option], state: CriteriaState) -> DecisionResult:
    cells: dict[str, dict[str, ScoreCell]] = {}
    eligibility: dict[str, tuple[bool, list[str]]] = {}
    for option in options:
        cells[option.id] = {}
        unmet: list[str] = []
        for constraint in state.constraints:
            criterion = next((c for c in state.criteria if c.id == constraint.criterion_id), None)
            fact = _fact(option, criterion.attribute) if criterion else None
            value = fact.numeric_value if fact else None
            if value is None:
                unmet.append(f"{criterion.name if criterion else constraint.criterion_id}: source value unavailable")
            elif not _satisfies(value, constraint):
                unmet.append(f"{criterion.name}: {value:g} {fact.unit or ''} does not meet {constraint.operator} {constraint.value:g} {constraint.unit or ''}".strip())
        eligibility[option.id] = (not unmet, unmet)

    for criterion in state.criteria:
        available = [(o, _fact(o, criterion.attribute)) for o in options]
        numeric = [(o, f) for o, f in available if f and f.numeric_value is not None]
        values = [float(f.numeric_value) for _, f in numeric]
        lo, hi = (min(values), max(values)) if values else (0.0, 0.0)
        for option in options:
            fact = _fact(option, criterion.attribute)
            if not fact:
                cells[option.id][criterion.id] = ScoreCell(score=None, explanation="No source evidence for this criterion.")
                continue
            refs = [fact.source]
            value = fact.numeric_value
            if value is None:
                cells[option.id][criterion.id] = ScoreCell(score=None, evidence=refs, explanation="Source is qualitative; it is shown for review and excluded from numeric ranking.")
                continue
            if hi == lo:
                score = 10.0
            elif criterion.direction == "lower":
                score = 10 * (hi - value) / (hi - lo)
            elif criterion.direction == "target" and criterion.target is not None:
                max_distance = max(abs(lo - criterion.target), abs(hi - criterion.target)) or 1
                score = 10 * max(0, 1 - abs(value - criterion.target) / max_distance)
            else:
                score = 10 * (value - lo) / (hi - lo)
            cells[option.id][criterion.id] = ScoreCell(
                score=round(score, 2), evidence=refs,
                explanation=f"Normalized from source value {fact.value}{(' ' + fact.unit) if fact.unit else ''} using the observed option range {lo:g}–{hi:g}.",
            )

    ranked: list[tuple[Option, float | None, dict[str, ScoreCell], bool, list[str], float]] = []
    possible_weight = sum(criterion.weight for criterion in state.criteria)
    for option in options:
        total_weight = 0.0
        weighted = 0.0
        for criterion in state.criteria:
            cell = cells[option.id][criterion.id]
            if cell.score is not None:
                weighted += cell.score * criterion.weight
                total_weight += criterion.weight
        score = round(weighted / total_weight, 2) if total_weight else None
        coverage = total_weight / possible_weight if possible_weight else 0.0
        eligible, unmet = eligibility[option.id]
        ranked.append((option, score, cells[option.id], eligible, unmet, coverage))
    ranked.sort(key=lambda row: (not row[3], row[1] is None, -(row[1] or 0), row[0].name.casefold()))

    out: list[RankedOption] = []
    rank = 0
    for option, score, option_cells, eligible, unmet, coverage in ranked:
        if eligible and score is not None:
            rank += 1
            option_rank = rank
        else:
            option_rank = None
        out.append(RankedOption(option_id=option.id, option_name=option.name, score=score,
                                evidence_coverage=round(coverage, 4), eligible=eligible, rank=option_rank, criterion_scores=option_cells,
                                unmet_constraints=unmet))
    winner = next((item for item in out if item.eligible and item.score is not None), None)
    if winner:
        explanation = f"{winner.option_name} ranks first at {winner.score:.2f}/10 among options that meet the stated constraints. Source values cover {winner.evidence_coverage:.0%} of criterion weight; the score is calculated only from available cited facts."
    else:
        explanation = "No option can currently be ranked against these criteria and constraints. Review missing source values or adjust the criteria."
    followups = ["Which option has the strongest evidence for your highest-weighted criterion?",
                 "What changes if you adjust the top criterion's weight?",
                 "Which missing source value would most affect this comparison?"]
    return DecisionResult(criteria=state.criteria, options=out,
                          recommendation_id=winner.option_id if winner else None,
                          recommendation_explanation=explanation,
                          follow_up_questions=followups, total_options=len(options))


def _fact(option: Option, attribute: str | None):
    if not attribute:
        return None
    key = attribute.casefold().strip()
    return next((f for f in option.facts if f.attribute.casefold().strip() == key), None)


def _satisfies(value: float, constraint: Constraint) -> bool:
    return {"gte": value >= constraint.value, "lte": value <= constraint.value,
            "eq": abs(value - constraint.value) < 1e-9}[constraint.operator]
