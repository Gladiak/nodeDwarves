# NodeDwarves Regression Report

Generated: 2026-02-17T20:55:16.634Z
All profiles mode: no
Gate result: PASS
Average profile score: 100.0

## Profiles

| Profile | Eval | Random | Score |
| --- | --- | --- | ---: |
| standard | PASS | PASS | 100.0 |

## standard

Config seeds: 12345, 22222
Eval episodes/max_steps: 20/1200
Random episodes/max_steps: 40/520

### Eval diff

| Metric | Current | Baseline | Delta | Delta% | Threshold | Status |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| avg_reward | 9517.529 | 9562.588 | -45.058 | -0.5% | 9084.459 | OK |
| avg_steps | 1200.000 | 1200.000 | 0.000 | 0.0% | n/a | N/A |
| avg_births | 51.275 | 49.550 | 1.725 | 3.5% | n/a | N/A |
| avg_deaths | 1.900 | 4.375 | -2.475 | -56.6% | 5.031 | OK |
| score | 3.966 | 3.984 | -0.019 | -0.5% | 3.785 | OK |

### Randomized diff

| Metric | Current | Baseline | Delta | Delta% | Threshold | Status |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| avg_reward | 3978.445 | 3906.195 | 72.250 | 1.8% | 3593.699 | OK |
| avg_steps | 520.000 | 520.000 | 0.000 | 0.0% | n/a | N/A |
| avg_births | 13.635 | 13.600 | 0.035 | 0.3% | n/a | N/A |
| avg_deaths | 0.575 | 1.050 | -0.475 | -45.2% | n/a | N/A |
| stock_min | 0.930 | 0.960 | -0.030 | -3.1% | 0.883 | OK |
| stock_avg | 0.965 | 0.985 | -0.020 | -2.0% | n/a | N/A |
| crit | 0.000 | 0.000 | 0.000 | n/a | n/a | N/A |
| idle | 0.095 | 0.135 | -0.040 | -29.6% | n/a | N/A |
| raid_count | 0.385 | 0.375 | 0.010 | 2.7% | n/a | N/A |
| raid_deaths | 0.415 | 0.500 | -0.085 | -17.0% | n/a | N/A |
| raid_exposed | 0.850 | 0.770 | 0.080 | 10.4% | n/a | N/A |
| raid_defense | 0.600 | 0.600 | 0.000 | 0.0% | n/a | N/A |
| under_depthProgress | 0.000 | n/a | n/a | n/a | n/a | N/A |
| under_championProgress | 0.000 | n/a | n/a | n/a | n/a | N/A |
| under_frontierContested | 0.000 | n/a | n/a | n/a | n/a | N/A |
| under_championCooldown | 0.000 | n/a | n/a | n/a | n/a | N/A |
| under_readinessScore | 0.545 | n/a | n/a | n/a | n/a | N/A |
| under_readinessGap | 0.455 | n/a | n/a | n/a | n/a | N/A |
| under_readinessBlocked | 0.610 | n/a | n/a | n/a | n/a | N/A |
| under_readinessWarning | 0.330 | n/a | n/a | n/a | n/a | N/A |
| under_combatPressure | 0.230 | n/a | n/a | n/a | n/a | N/A |
| node_food | 0.170 | 0.115 | 0.055 | 47.8% | n/a | N/A |
| node_water | 0.050 | 0.060 | -0.010 | -16.7% | n/a | N/A |
| node_wood | 0.165 | 0.165 | 0.000 | 0.0% | n/a | N/A |
| node_stone | 0.075 | 0.075 | 0.000 | 0.0% | n/a | N/A |
| short_food | 0.050 | 0.050 | 0.000 | 0.0% | n/a | N/A |
| short_water | 0.010 | 0.010 | 0.000 | 0.0% | n/a | N/A |
| short_wood | 0.225 | 0.240 | -0.015 | -6.2% | n/a | N/A |
| short_stone | 0.070 | 0.040 | 0.030 | 75.0% | n/a | N/A |
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
