# Training Promotion Summary

- Generated at: `2026-02-17T17:09:54.502Z`
- Profile: `quality-mixed`
- Run dir: `/Users/filippoverni/ProgettiLavoro/nodeDwarves/debug/run_1771347914555_24155_962090`

## Canonical Benchmark

- Enabled: `true`
- Eval episodes: `4`
- Eval max steps: `1000`
- Score mode: `rpt`
- Min improve: `0.0050`
- Require positive LCB: `false`
- LCB z: `1.9600`

## Totals

- Phases: `3`
- Promoted: `0`
- Retained: `3`
- Avg delta score: `0.0043`
- Final best score: `3.8396`

## Phase Results

| # | Phase | Promoted | Reason | Latest | Best before | Best after | Delta | Paired LCB |
|---|---|---:|---|---:|---:|---:|---:|---:|
| 1 | quality-mixed-foundation | no | best_retained | 3.9913 | 3.9413 | 3.9413 | 0.0500 | -0.0356 |
| 2 | quality-mixed-finetune | no | best_retained | 3.8096 | 3.8461 | 3.8461 | -0.0365 | -0.1794 |
| 3 | canonical-final | no | best_retained | 3.8389 | 3.8396 | 3.8396 | -0.0006 | -0.1244 |

## Metric Glossary

- `Latest`: canonical benchmark score for `models/policy.json`.
- `Best before`: canonical benchmark score for `models/policy_best.json` before the check.
- `Best after`: best score tracked after this phase check.
- `Delta`: `latest - best_before` on the same canonical benchmark.
- `Paired LCB`: lower confidence bound of paired episode deltas (`latest_i - best_i`).
- `Promoted`: checkpoint replacement decision for this phase.

