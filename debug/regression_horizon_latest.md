# NodeDwarves Regression Report

Generated: 2026-02-20T16:31:57.013Z
All profiles mode: no
Gate result: PASS
Average profile score: 100.0

## Profiles

| Profile | Eval | Random | Score |
| --- | --- | --- | ---: |
| horizon | PASS | PASS | 100.0 |

## horizon

Config seeds: 12345, 22222
Eval episodes/max_steps: 20/1600
Eval scenarios: baseline, underrealm_push, governance_pressure, compound_crisis
Random episodes/max_steps: 40/700

### Eval diff

| Metric | Current | Baseline | Delta | Delta% | Threshold | Status |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| avg_reward | 12519.205 | 12519.205 | 0.000 | 0.0% | 11768.053 | OK |
| avg_steps | 1600.000 | 1600.000 | 0.000 | 0.0% | n/a | N/A |
| avg_births | 68.025 | 68.025 | 0.000 | 0.0% | n/a | N/A |
| avg_deaths | 2.650 | 2.650 | 0.000 | 0.0% | 3.127 | OK |
| score | 3.912 | 3.912 | 0.000 | 0.0% | 3.678 | OK |

### Randomized diff

| Metric | Current | Baseline | Delta | Delta% | Threshold | Status |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| avg_reward | 5677.035 | 5677.035 | 0.000 | 0.0% | 5109.332 | OK |
| avg_steps | 700.000 | 700.000 | 0.000 | 0.0% | n/a | N/A |
| avg_births | 17.215 | 17.215 | 0.000 | 0.0% | n/a | N/A |
| avg_deaths | 0.700 | 0.700 | 0.000 | 0.0% | n/a | N/A |
| stock_min | 0.950 | 0.950 | 0.000 | 0.0% | 0.855 | OK |
| stock_avg | 0.985 | 0.985 | 0.000 | 0.0% | n/a | N/A |
| crit | 0.000 | 0.000 | 0.000 | n/a | n/a | N/A |
| idle | 0.125 | 0.125 | 0.000 | 0.0% | n/a | N/A |
| raid_count | 0.510 | 0.510 | 0.000 | 0.0% | n/a | N/A |
| raid_deaths | 0.575 | 0.575 | 0.000 | 0.0% | n/a | N/A |
| raid_exposed | 0.825 | 0.825 | 0.000 | 0.0% | n/a | N/A |
| raid_defense | 0.600 | 0.600 | 0.000 | 0.0% | n/a | N/A |
| under_depthProgress | 0.000 | 0.000 | 0.000 | n/a | n/a | N/A |
| under_championProgress | 0.000 | 0.000 | 0.000 | n/a | n/a | N/A |
| under_frontierContested | 0.000 | 0.000 | 0.000 | n/a | n/a | N/A |
| under_championCooldown | 0.000 | 0.000 | 0.000 | n/a | n/a | N/A |
| under_readinessScore | 0.515 | 0.515 | 0.000 | 0.0% | 0.453 | OK |
| under_readinessGap | 0.485 | 0.485 | 0.000 | 0.0% | n/a | N/A |
| under_readinessBlocked | 0.875 | 0.875 | 0.000 | 0.0% | 1.067 | OK |
| under_readinessWarning | 0.125 | 0.125 | 0.000 | 0.0% | n/a | N/A |
| under_combatPressure | 0.280 | 0.280 | 0.000 | 0.0% | 0.342 | OK |
| node_food | 0.195 | 0.195 | 0.000 | 0.0% | n/a | N/A |
| node_water | 0.065 | 0.065 | 0.000 | 0.0% | n/a | N/A |
| node_wood | 0.165 | 0.165 | 0.000 | 0.0% | n/a | N/A |
| node_stone | 0.075 | 0.075 | 0.000 | 0.0% | n/a | N/A |
| short_food | 0.030 | 0.030 | 0.000 | 0.0% | n/a | N/A |
| short_water | 0.005 | 0.005 | 0.000 | 0.0% | n/a | N/A |
| short_wood | 0.180 | 0.180 | 0.000 | 0.0% | n/a | N/A |
| short_stone | 0.065 | 0.065 | 0.000 | 0.0% | n/a | N/A |
| extinction_rate | 0.000 | 0.000 | 0.000 | n/a | 0.050 | OK |

### Eval seed metrics

| Seed | avg_reward | avg_steps | avg_births | avg_deaths | score |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 12345 | 12503.271 | 1600.000 | 68.900 | 3.150 | 3.907 |
| 22222 | 12535.140 | 1600.000 | 67.150 | 2.150 | 3.917 |

### Randomized seed metrics

| Seed | avg_reward | avg_steps | avg_births | avg_deaths | stock_min | stock_avg | extinction_rate |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 12345 | 5647.650 | 700.000 | 16.980 | 0.780 | 0.970 | 0.990 | 0.000 |
| 22222 | 5706.420 | 700.000 | 17.450 | 0.620 | 0.930 | 0.980 | 0.000 |
