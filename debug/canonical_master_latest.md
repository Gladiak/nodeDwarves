# Promotion Report

- Timestamp (UTC): `2026-02-27T13:59:53.888285+00:00`
- Reason: `eval_only`
- Promoted: `False`
- Best score before: `-`
- Best score after: `-`
- Delta score: `-`

## Evaluation Context

- Config: `config.json`
- Eval episodes: `20`
- Eval max steps: `2200`
- Eval difficulty: `1.0000`
- Eval score mode: `rpt`
- Seed base: `100000`

## Policy Scores

| Policy | Score | Avg reward | Avg steps | Avg ticks | Avg births | Avg deaths |
|---|---:|---:|---:|---:|---:|---:|
| latest | 3.7737 | 16604.19 | 2200.00 | 4400.00 | 97.40 | 4.55 |
| best_before | - | - | - | - | - | - |

## Promotion Guardrails

- `min_improve`: `0.0050`
- `require_positive_lcb`: `True`
- `lcb_z`: `1.9600`

## Diagnostic Ensemble (Non-Blocking)

- `ensemble_score = rpt_score + 0.05 * (deep_aux - 0.5)` (reported for diagnostics only).
- Latest: `rpt=3.7737`, `deep_aux=0.4081`, `ensemble=3.7691`
- Best before: `rpt=-`, `deep_aux=-`, `ensemble=-`
- Delta ensemble: `-`
- Deep auxiliary channels use eval aggregates from `avg_under_*` (`readiness`, `depth`, `champion`, `combat_pressure`).
- Note: Diagnostics only: ensemble score never drives promotion decisions (promotion remains based on evalScore + existing guardrails).

## Metric Glossary

- `score`: aggregate promotion metric (`reward`, `rps`, or `rpt` depending on `evalScore`).
- `delta_score`: `latest_score - best_score_before`.
- `min_improve`: minimum score delta required to allow promotion.
- `lower_bound`: one-sided paired confidence lower bound for episode deltas.
- `promoted`: true when latest checkpoint replaces best checkpoint.
