# Promotion Report

- Timestamp (UTC): `2026-02-19T16:03:29.032186+00:00`
- Reason: `eval_only`
- Promoted: `False`
- Best score before: `-`
- Best score after: `-`
- Delta score: `-`

## Evaluation Context

- Config: `config.json`
- Eval episodes: `1`
- Eval max steps: `20`
- Eval difficulty: `1.0000`
- Eval score mode: `rpt`
- Seed base: `100000`

## Policy Scores

| Policy | Score | Avg reward | Avg steps | Avg ticks | Avg births | Avg deaths |
|---|---:|---:|---:|---:|---:|---:|
| latest | 1.7895 | 71.58 | 20.00 | 40.00 | 0.00 | 0.00 |
| best_before | - | - | - | - | - | - |

## Promotion Guardrails

- `min_improve`: `0.0050`
- `require_positive_lcb`: `True`
- `lcb_z`: `1.9600`

## Metric Glossary

- `score`: aggregate promotion metric (`reward`, `rps`, or `rpt` depending on `evalScore`).
- `delta_score`: `latest_score - best_score_before`.
- `min_improve`: minimum score delta required to allow promotion.
- `lower_bound`: one-sided paired confidence lower bound for episode deltas.
- `promoted`: true when latest checkpoint replaces best checkpoint.
