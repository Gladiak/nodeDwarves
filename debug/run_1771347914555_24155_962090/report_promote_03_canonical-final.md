# Promotion Report

- Timestamp (UTC): `2026-02-17T17:09:54.374054+00:00`
- Reason: `best_retained`
- Promoted: `False`
- Best score before: `3.8396`
- Best score after: `3.8396`
- Delta score: `-0.0006`

## Evaluation Context

- Config: `/Users/filippoverni/ProgettiLavoro/nodeDwarves/debug/run_1771347914555_24155_962090/config_canonical_promote.json`
- Eval episodes: `4`
- Eval max steps: `1000`
- Eval difficulty: `1.0000`
- Eval score mode: `rpt`
- Seed base: `100000`

## Policy Scores

| Policy | Score | Avg reward | Avg steps | Avg ticks | Avg births | Avg deaths |
|---|---:|---:|---:|---:|---:|---:|
| latest | 3.8389 | 7677.84 | 1000.00 | 2000.00 | 46.75 | 1.25 |
| best_before | 3.8396 | 7679.13 | 1000.00 | 2000.00 | 39.75 | 2.25 |

## Promotion Guardrails

- `min_improve`: `0.0050`
- `require_positive_lcb`: `True`
- `lcb_z`: `1.9600`

## Paired Statistics

- Episode pairs: `4`
- Mean delta: `-0.0006`
- Standard error: `0.0631`
- Lower confidence bound: `-0.1244`

## Metric Glossary

- `score`: aggregate promotion metric (`reward`, `rps`, or `rpt` depending on `evalScore`).
- `delta_score`: `latest_score - best_score_before`.
- `min_improve`: minimum score delta required to allow promotion.
- `lower_bound`: one-sided paired confidence lower bound for episode deltas.
- `promoted`: true when latest checkpoint replaces best checkpoint.
