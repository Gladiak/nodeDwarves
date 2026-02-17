# Promotion Report

- Timestamp (UTC): `2026-02-17T17:09:12.243210+00:00`
- Reason: `best_retained`
- Promoted: `False`
- Best score before: `3.8461`
- Best score after: `3.8461`
- Delta score: `-0.0365`

## Evaluation Context

- Config: `/Users/filippoverni/ProgettiLavoro/nodeDwarves/debug/run_1771347914555_24155_962090/config_finetune.json`
- Eval episodes: `6`
- Eval max steps: `1800`
- Eval difficulty: `1.0000`
- Eval score mode: `rpt`
- Seed base: `100000`

## Policy Scores

| Policy | Score | Avg reward | Avg steps | Avg ticks | Avg births | Avg deaths |
|---|---:|---:|---:|---:|---:|---:|
| latest | 3.8096 | 13714.49 | 1800.00 | 3600.00 | 81.67 | 3.50 |
| best_before | 3.8461 | 13846.04 | 1800.00 | 3600.00 | 78.83 | 2.67 |

## Promotion Guardrails

- `min_improve`: `0.0120`
- `require_positive_lcb`: `True`
- `lcb_z`: `1.9600`

## Paired Statistics

- Episode pairs: `6`
- Mean delta: `-0.0365`
- Standard error: `0.0729`
- Lower confidence bound: `-0.1794`

## Metric Glossary

- `score`: aggregate promotion metric (`reward`, `rps`, or `rpt` depending on `evalScore`).
- `delta_score`: `latest_score - best_score_before`.
- `min_improve`: minimum score delta required to allow promotion.
- `lower_bound`: one-sided paired confidence lower bound for episode deltas.
- `promoted`: true when latest checkpoint replaces best checkpoint.
