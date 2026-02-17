# Gate C7 Validation Snapshot (2026-02-17)

## Scope

C7 throughput increment focused on IPC/eval-promote path costs, with quality guardrails unchanged.

## Throughput target check

Source: `debug/gateC7_throughput_compare_1771360179.md`

- Profile A delta vs Gate C+ baseline (`legacy 175.0`): `+52.2%` (`266.4 eps_pm`)
- Profile B delta vs Gate C+ baseline (`legacy 635.6`): `+85.0%` (`1175.8 eps_pm`)

Result: throughput target `>= +25%` is met.

## Eval/promote profiling

Source: `debug/gateC7_eval_promote_profile_1771360179.md`

- Short canonical probe (`4x400`) shows compact path `~4-5%` faster vs legacy with identical score payload.

## Benchmark gate

Command:

```bash
node scripts/headless_benchmark.js --ticks 8000 --seeds 101,202,303,404 --progress --progress-every 2000
```

Artifacts:

- `debug/gateC7_headless_benchmark_1771359150.json`
- `debug/gateC7_headless_benchmark_1771359150.md`

Snapshot (`current`):

- avg population: `716.00`
- avg morale: `0.8865`
- avg hunger: `0.1528`
- avg thirst: `0.1093`

Result: benchmark completed successfully, guardrails aligned with prior Gate C+ snapshot.

## Regression gates

Artifacts:

- Standard: `debug/regression_report_1771360039305.md`
- Underrealm: `debug/regression_report_1771360039866.md`

Result:

- `standard`: `PASS`
- `underrealm`: `PASS`

## Gate C7 status

- Throughput objective (`>= +25%`): `PASS`
- Benchmark guardrail: `PASS`
- Regression guardrails: `PASS`
