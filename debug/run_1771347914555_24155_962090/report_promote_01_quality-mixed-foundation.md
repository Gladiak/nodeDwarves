# Promotion Report

- Timestamp (UTC): `2026-02-17T17:06:47.362975+00:00`
- Reason: `best_retained`
- Promoted: `False`
- Best score before: `3.9413`
- Best score after: `3.9413`
- Delta score: `0.0500`

## Evaluation Context

- Config: `/Users/filippoverni/ProgettiLavoro/nodeDwarves/debug/run_1771347914555_24155_962090/config_fast.json`
- Eval episodes: `5`
- Eval max steps: `1400`
- Eval difficulty: `1.0000`
- Eval score mode: `rpt`
- Seed base: `100000`

## Policy Scores

| Policy | Score | Avg reward | Avg steps | Avg ticks | Avg births | Avg deaths |
|---|---:|---:|---:|---:|---:|---:|
| latest | 3.9913 | 11175.78 | 1400.00 | 2800.00 | 59.80 | 2.60 |
| best_before | 3.9413 | 11035.76 | 1400.00 | 2800.00 | 55.60 | 2.00 |

## Promotion Guardrails

- `min_improve`: `0.0100`
- `require_positive_lcb`: `True`
- `lcb_z`: `1.9600`

## Paired Statistics

- Episode pairs: `5`
- Mean delta: `0.0500`
- Standard error: `0.0437`
- Lower confidence bound: `-0.0356`

## Metric Glossary

- `score`: aggregate promotion metric (`reward`, `rps`, or `rpt` depending on `evalScore`).
- `delta_score`: `latest_score - best_score_before`.
- `min_improve`: minimum score delta required to allow promotion.
- `lower_bound`: one-sided paired confidence lower bound for episode deltas.
- `promoted`: true when latest checkpoint replaces best checkpoint.
