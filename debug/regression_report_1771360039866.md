# NodeDwarves Regression Report

Generated: 2026-02-17T20:27:19.867Z
All profiles mode: no
Gate result: PASS
Average profile score: 100.0

## Profiles

| Profile | Eval | Random | Score |
| --- | --- | --- | ---: |
| underrealm | PASS | PASS | 100.0 |

## underrealm

Config seeds: 12345, 22222
Eval episodes/max_steps: 20/1200
Random episodes/max_steps: 40/520

### Eval diff

| Metric | Current | Baseline | Delta | Delta% | Threshold | Status |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| avg_reward | 9517.529 | 9255.690 | 261.839 | 2.8% | 8792.906 | OK |
| avg_steps | 1200.000 | 1200.000 | 0.000 | 0.0% | n/a | N/A |
| avg_births | 51.275 | 52.075 | -0.800 | -1.5% | n/a | N/A |
| avg_deaths | 1.900 | 1.875 | 0.025 | 1.3% | 2.156 | OK |
| score | 3.966 | 3.857 | 0.109 | 2.8% | 3.664 | OK |

### Randomized diff

| Metric | Current | Baseline | Delta | Delta% | Threshold | Status |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| avg_reward | 3978.445 | 3908.800 | 69.645 | 1.8% | 3596.096 | OK |
| avg_steps | 520.000 | 520.000 | 0.000 | 0.0% | n/a | N/A |
| avg_births | 13.635 | 13.550 | 0.085 | 0.6% | n/a | N/A |
| avg_deaths | 0.575 | 0.560 | 0.015 | 2.7% | n/a | N/A |
| stock_min | 0.930 | 0.915 | 0.015 | 1.6% | 0.842 | OK |
| stock_avg | 0.965 | 0.975 | -0.010 | -1.0% | n/a | N/A |
| crit | 0.000 | 0.000 | 0.000 | n/a | n/a | N/A |
| idle | 0.095 | 0.100 | -0.005 | -5.0% | n/a | N/A |
| raid_count | 0.385 | 0.375 | 0.010 | 2.7% | n/a | N/A |
| raid_deaths | 0.415 | 0.425 | -0.010 | -2.4% | n/a | N/A |
| raid_exposed | 0.850 | 0.830 | 0.020 | 2.4% | n/a | N/A |
| raid_defense | 0.600 | 0.600 | 0.000 | 0.0% | n/a | N/A |
| under_depthProgress | 0.000 | 0.000 | 0.000 | n/a | n/a | N/A |
| under_championProgress | 0.000 | 0.000 | 0.000 | n/a | n/a | N/A |
| under_frontierContested | 0.000 | 0.000 | 0.000 | n/a | n/a | N/A |
| under_championCooldown | 0.000 | 0.000 | 0.000 | n/a | n/a | N/A |
| under_readinessScore | 0.545 | 0.580 | -0.035 | -6.0% | n/a | N/A |
| under_readinessGap | 0.455 | 0.420 | 0.035 | 8.3% | n/a | N/A |
| under_readinessBlocked | 0.610 | 0.625 | -0.015 | -2.4% | n/a | N/A |
| under_readinessWarning | 0.330 | 0.375 | -0.045 | -12.0% | n/a | N/A |
| under_combatPressure | 0.230 | 0.245 | -0.015 | -6.1% | n/a | N/A |
| node_food | 0.170 | 0.165 | 0.005 | 3.0% | n/a | N/A |
| node_water | 0.050 | 0.060 | -0.010 | -16.7% | n/a | N/A |
| node_wood | 0.165 | 0.165 | 0.000 | 0.0% | n/a | N/A |
| node_stone | 0.075 | 0.075 | 0.000 | 0.0% | n/a | N/A |
| short_food | 0.050 | 0.035 | 0.015 | 42.9% | n/a | N/A |
| short_water | 0.010 | 0.010 | 0.000 | 0.0% | n/a | N/A |
| short_wood | 0.225 | 0.220 | 0.005 | 2.3% | n/a | N/A |
| short_stone | 0.070 | 0.060 | 0.010 | 16.7% | n/a | N/A |
| extinction_rate | 0.000 | 0.000 | 0.000 | n/a | 0.050 | OK |

### Eval seed metrics

| Seed | avg_reward | avg_steps | avg_births | avg_deaths | score |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 12345 | 9479.182 | 1200.000 | 50.600 | 1.750 | 3.950 |
| 22222 | 9555.876 | 1200.000 | 51.950 | 2.050 | 3.982 |

### Randomized seed metrics

| Seed | avg_reward | avg_steps | avg_births | avg_deaths | stock_min | stock_avg | extinction_rate |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 12345 | 3976.380 | 520.000 | 13.650 | 0.550 | 0.920 | 0.960 | 0.000 |
| 22222 | 3980.510 | 520.000 | 13.620 | 0.600 | 0.940 | 0.970 | 0.000 |
