# Gate C+ Validation Snapshot (2026-02-17)

## Scope

Completed Step 7 full validation for Phase 3.1 after C5 (compact transport) and C6 (quality-mixed curriculum preset).

## Throughput Target Check

Source: `debug/gateCplus_throughput_compare_1771345693.md`

- Profile A (`30x140`, workers `4`, seed `4242`):
  - `legacy=175.0 eps_pm`
  - `compact=207.4 eps_pm`
  - delta `+18.5%`
- Profile B (`120x25`, workers `8`, seed `4242`):
  - `legacy=635.6 eps_pm`
  - `compact=653.9 eps_pm`
  - delta `+2.9%`

Result: throughput improved, but target `>= +25%` is not reached.

## Benchmark Gate

Command contract:

```bash
node scripts/headless_benchmark.js --ticks 8000 --seeds 101,202,303,404 --progress --progress-every 2000
```

Artifacts:

- `debug/gateCplus_headless_benchmark_1771347287.json`
- `debug/gateCplus_headless_benchmark_1771347287.md`
- `debug/gateCplus_headless_benchmark_1771347287.log`

Average benchmark snapshot (`current`):

- population `716.00`
- morale `0.8865`
- hunger `0.1528`
- thirst `0.1093`
- underrealm readiness `0.917`

Result: benchmark executed successfully on all 4 seeds.

## Regression Gates

Artifacts:

- Standard: `debug/regression_report_1771346860187.md`
- Underrealm: `debug/regression_report_1771347278009.md`

Result:

- `standard`: `PASS`
- `underrealm`: `PASS`

## Wrapper Preset Smoke (`quality-mixed`)

Command used:

```bash
npm run -s ai:train:quality:mixed -- --low-load --workers 2 --episodes 8 --batch-episodes 2 --eval-episodes 1 --max-steps 600 --log-every 1 --canonical-eval-episodes 4 --canonical-eval-max-steps 1000 --promote-eval-progress --promote-eval-progress-every 1
```

Artifacts:

- Console log: `debug/gateCplus_smoke_quality_mixed_1771347914.log`
- Run dir: `debug/run_1771347914555_24155_962090`
- Summary: `debug/run_1771347914555_24155_962090/report_training_promotion_summary.md`

Result: wrapper run completed end-to-end (2 phases + canonical final), no promotion/regression anomalies.

## Gate C+ Status

- Checklist execution: completed.
- Quality guardrails: passed.
- Throughput objective (`>= +25%`): not met.

Decision: keep Gate C+ open and continue with next throughput optimization increment.
