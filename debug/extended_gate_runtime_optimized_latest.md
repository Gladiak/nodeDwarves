# Extended Gate Runtime (Optimized)

Generated: 2026-09-16T09:54:27.910Z
All checks passed: false
Baseline reference: 2728.58s
Current runtime: 3858.39s
Delta: 1129.81s (41.41%)

## Step timings

| Step | Seconds | Share | Status |
| --- | ---: | ---: | --- |
| Python environment | 0.07 | 0.00% | PASS |
| Canonical master | 485.14 | 12.57% | PASS |
| Deterministic benchmark | 823.51 | 21.34% | PASS |
| Deterministic regression profiles | 2549.65 | 66.08% | FAIL |

## Notes

- `npm run ai:validate` is the single full acceptance gate and executes the benchmark only once.
- Use direct script CLIs for isolated diagnostics; package scripts intentionally expose only operational entrypoints.
