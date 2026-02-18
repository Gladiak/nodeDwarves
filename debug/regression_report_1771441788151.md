# NodeDwarves Regression Report

Generated: 2026-02-18T19:09:48.152Z
All profiles mode: yes
Gate result: PASS
Average profile score: 100.0

## Profiles

| Profile | Eval | Random | Score |
| --- | --- | --- | ---: |
| standard | PASS | PASS | 100.0 |
| underrealm | PASS | PASS | 100.0 |

## standard

Config seeds: 12345, 22222
Eval episodes/max_steps: 20/1200
Random episodes/max_steps: 40/520

### Eval diff

| Metric | Current | Baseline | Delta | Delta% | Threshold | Status |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| avg_reward | 9616.626 | 9562.588 | 54.038 | 0.6% | 9084.459 | OK |
| avg_steps | 1200.000 | 1200.000 | 0.000 | 0.0% | n/a | N/A |
| avg_births | 50.475 | 49.550 | 0.925 | 1.9% | n/a | N/A |
| avg_deaths | 2.125 | 4.375 | -2.250 | -51.4% | 5.031 | OK |
| score | 4.007 | 3.984 | 0.023 | 0.6% | 3.785 | OK |

### Randomized diff

| Metric | Current | Baseline | Delta | Delta% | Threshold | Status |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| avg_reward | 3955.190 | 3906.195 | 48.995 | 1.3% | 3593.699 | OK |
| avg_steps | 520.000 | 520.000 | 0.000 | 0.0% | n/a | N/A |
| avg_births | 13.485 | 13.600 | -0.115 | -0.8% | n/a | N/A |
| avg_deaths | 0.665 | 1.050 | -0.385 | -36.7% | n/a | N/A |
| stock_min | 0.905 | 0.960 | -0.055 | -5.7% | 0.883 | OK |
| stock_avg | 0.965 | 0.985 | -0.020 | -2.0% | n/a | N/A |
| crit | 0.000 | 0.000 | 0.000 | n/a | n/a | N/A |
| idle | 0.090 | 0.135 | -0.045 | -33.3% | n/a | N/A |
| raid_count | 0.410 | 0.375 | 0.035 | 9.3% | n/a | N/A |
| raid_deaths | 0.515 | 0.500 | 0.015 | 3.0% | n/a | N/A |
| raid_exposed | 0.860 | 0.770 | 0.090 | 11.7% | n/a | N/A |
| raid_defense | 0.600 | 0.600 | 0.000 | 0.0% | n/a | N/A |
| under_depthProgress | 0.000 | n/a | n/a | n/a | n/a | N/A |
| under_championProgress | 0.000 | n/a | n/a | n/a | n/a | N/A |
| under_frontierContested | 0.000 | n/a | n/a | n/a | n/a | N/A |
| under_championCooldown | 0.000 | n/a | n/a | n/a | n/a | N/A |
| under_readinessScore | 0.590 | n/a | n/a | n/a | n/a | N/A |
| under_readinessGap | 0.410 | n/a | n/a | n/a | n/a | N/A |
| under_readinessBlocked | 0.510 | n/a | n/a | n/a | n/a | N/A |
| under_readinessWarning | 0.475 | n/a | n/a | n/a | n/a | N/A |
| under_combatPressure | 0.225 | n/a | n/a | n/a | n/a | N/A |
| node_food | 0.150 | 0.115 | 0.035 | 30.4% | n/a | N/A |
| node_water | 0.065 | 0.060 | 0.005 | 8.3% | n/a | N/A |
| node_wood | 0.165 | 0.165 | 0.000 | 0.0% | n/a | N/A |
| node_stone | 0.075 | 0.075 | 0.000 | 0.0% | n/a | N/A |
| short_food | 0.040 | 0.050 | -0.010 | -20.0% | n/a | N/A |
| short_water | 0.005 | 0.010 | -0.005 | -50.0% | n/a | N/A |
| short_wood | 0.225 | 0.240 | -0.015 | -6.2% | n/a | N/A |
| short_stone | 0.075 | 0.040 | 0.035 | 87.5% | n/a | N/A |
| extinction_rate | 0.000 | 0.000 | 0.000 | n/a | 0.050 | OK |

### Eval seed metrics

| Seed | avg_reward | avg_steps | avg_births | avg_deaths | score |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 12345 | 9621.916 | 1200.000 | 49.850 | 2.400 | 4.009 |
| 22222 | 9611.336 | 1200.000 | 51.100 | 1.850 | 4.005 |

### Randomized seed metrics

| Seed | avg_reward | avg_steps | avg_births | avg_deaths | stock_min | stock_avg | extinction_rate |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 12345 | 3923.250 | 520.000 | 13.120 | 0.780 | 0.910 | 0.970 | 0.000 |
| 22222 | 3987.130 | 520.000 | 13.850 | 0.550 | 0.900 | 0.960 | 0.000 |

## underrealm

Config seeds: 12345, 22222
Eval episodes/max_steps: 20/1200
Random episodes/max_steps: 40/520

### Eval diff

| Metric | Current | Baseline | Delta | Delta% | Threshold | Status |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| avg_reward | 9616.626 | 9255.690 | 360.936 | 3.9% | 8792.906 | OK |
| avg_steps | 1200.000 | 1200.000 | 0.000 | 0.0% | n/a | N/A |
| avg_births | 50.475 | 52.075 | -1.600 | -3.1% | n/a | N/A |
| avg_deaths | 2.125 | 1.875 | 0.250 | 13.3% | 2.156 | OK |
| score | 4.007 | 3.857 | 0.150 | 3.9% | 3.664 | OK |

### Randomized diff

| Metric | Current | Baseline | Delta | Delta% | Threshold | Status |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| avg_reward | 3955.190 | 3908.800 | 46.390 | 1.2% | 3596.096 | OK |
| avg_steps | 520.000 | 520.000 | 0.000 | 0.0% | n/a | N/A |
| avg_births | 13.485 | 13.550 | -0.065 | -0.5% | n/a | N/A |
| avg_deaths | 0.665 | 0.560 | 0.105 | 18.8% | n/a | N/A |
| stock_min | 0.905 | 0.915 | -0.010 | -1.1% | 0.842 | OK |
| stock_avg | 0.965 | 0.975 | -0.010 | -1.0% | n/a | N/A |
| crit | 0.000 | 0.000 | 0.000 | n/a | n/a | N/A |
| idle | 0.090 | 0.100 | -0.010 | -10.0% | n/a | N/A |
| raid_count | 0.410 | 0.375 | 0.035 | 9.3% | n/a | N/A |
| raid_deaths | 0.515 | 0.425 | 0.090 | 21.2% | n/a | N/A |
| raid_exposed | 0.860 | 0.830 | 0.030 | 3.6% | n/a | N/A |
| raid_defense | 0.600 | 0.600 | 0.000 | 0.0% | n/a | N/A |
| under_depthProgress | 0.000 | 0.000 | 0.000 | n/a | n/a | N/A |
| under_championProgress | 0.000 | 0.000 | 0.000 | n/a | n/a | N/A |
| under_frontierContested | 0.000 | 0.000 | 0.000 | n/a | n/a | N/A |
| under_championCooldown | 0.000 | 0.000 | 0.000 | n/a | n/a | N/A |
| under_readinessScore | 0.590 | 0.580 | 0.010 | 1.7% | n/a | N/A |
| under_readinessGap | 0.410 | 0.420 | -0.010 | -2.4% | n/a | N/A |
| under_readinessBlocked | 0.510 | 0.625 | -0.115 | -18.4% | n/a | N/A |
| under_readinessWarning | 0.475 | 0.375 | 0.100 | 26.7% | n/a | N/A |
| under_combatPressure | 0.225 | 0.245 | -0.020 | -8.2% | n/a | N/A |
| node_food | 0.150 | 0.165 | -0.015 | -9.1% | n/a | N/A |
| node_water | 0.065 | 0.060 | 0.005 | 8.3% | n/a | N/A |
| node_wood | 0.165 | 0.165 | 0.000 | 0.0% | n/a | N/A |
| node_stone | 0.075 | 0.075 | 0.000 | 0.0% | n/a | N/A |
| short_food | 0.040 | 0.035 | 0.005 | 14.3% | n/a | N/A |
| short_water | 0.005 | 0.010 | -0.005 | -50.0% | n/a | N/A |
| short_wood | 0.225 | 0.220 | 0.005 | 2.3% | n/a | N/A |
| short_stone | 0.075 | 0.060 | 0.015 | 25.0% | n/a | N/A |
| extinction_rate | 0.000 | 0.000 | 0.000 | n/a | 0.050 | OK |

### Eval seed metrics

| Seed | avg_reward | avg_steps | avg_births | avg_deaths | score |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 12345 | 9621.916 | 1200.000 | 49.850 | 2.400 | 4.009 |
| 22222 | 9611.336 | 1200.000 | 51.100 | 1.850 | 4.005 |

### Randomized seed metrics

| Seed | avg_reward | avg_steps | avg_births | avg_deaths | stock_min | stock_avg | extinction_rate |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 12345 | 3923.250 | 520.000 | 13.120 | 0.780 | 0.910 | 0.970 | 0.000 |
| 22222 | 3987.130 | 520.000 | 13.850 | 0.550 | 0.900 | 0.960 | 0.000 |
