# NodeDwarves Regression Report

Generated: 2026-02-19T13:50:35.775Z
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
| avg_reward | 9556.210 | 9562.588 | -6.378 | -0.1% | 9084.459 | OK |
| avg_steps | 1200.000 | 1200.000 | 0.000 | 0.0% | n/a | N/A |
| avg_births | 49.750 | 49.550 | 0.200 | 0.4% | n/a | N/A |
| avg_deaths | 2.025 | 4.375 | -2.350 | -53.7% | 5.031 | OK |
| score | 3.982 | 3.984 | -0.003 | -0.1% | 3.785 | OK |

### Randomized diff

| Metric | Current | Baseline | Delta | Delta% | Threshold | Status |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| avg_reward | 3970.350 | 3906.195 | 64.155 | 1.6% | 3593.699 | OK |
| avg_steps | 520.000 | 520.000 | 0.000 | 0.0% | n/a | N/A |
| avg_births | 13.660 | 13.600 | 0.060 | 0.4% | n/a | N/A |
| avg_deaths | 0.575 | 1.050 | -0.475 | -45.2% | n/a | N/A |
| stock_min | 0.910 | 0.960 | -0.050 | -5.2% | 0.883 | OK |
| stock_avg | 0.970 | 0.985 | -0.015 | -1.5% | n/a | N/A |
| crit | 0.000 | 0.000 | 0.000 | n/a | n/a | N/A |
| idle | 0.095 | 0.135 | -0.040 | -29.6% | n/a | N/A |
| raid_count | 0.350 | 0.375 | -0.025 | -6.7% | n/a | N/A |
| raid_deaths | 0.425 | 0.500 | -0.075 | -15.0% | n/a | N/A |
| raid_exposed | 0.835 | 0.770 | 0.065 | 8.4% | n/a | N/A |
| raid_defense | 0.600 | 0.600 | 0.000 | 0.0% | n/a | N/A |
| under_depthProgress | 0.000 | n/a | n/a | n/a | n/a | N/A |
| under_championProgress | 0.000 | n/a | n/a | n/a | n/a | N/A |
| under_frontierContested | 0.000 | n/a | n/a | n/a | n/a | N/A |
| under_championCooldown | 0.000 | n/a | n/a | n/a | n/a | N/A |
| under_readinessScore | 0.610 | n/a | n/a | n/a | n/a | N/A |
| under_readinessGap | 0.390 | n/a | n/a | n/a | n/a | N/A |
| under_readinessBlocked | 0.525 | n/a | n/a | n/a | n/a | N/A |
| under_readinessWarning | 0.475 | n/a | n/a | n/a | n/a | N/A |
| under_combatPressure | 0.235 | n/a | n/a | n/a | n/a | N/A |
| node_food | 0.160 | 0.115 | 0.045 | 39.1% | n/a | N/A |
| node_water | 0.060 | 0.060 | 0.000 | 0.0% | n/a | N/A |
| node_wood | 0.165 | 0.165 | 0.000 | 0.0% | n/a | N/A |
| node_stone | 0.075 | 0.075 | 0.000 | 0.0% | n/a | N/A |
| short_food | 0.040 | 0.050 | -0.010 | -20.0% | n/a | N/A |
| short_water | 0.005 | 0.010 | -0.005 | -50.0% | n/a | N/A |
| short_wood | 0.220 | 0.240 | -0.020 | -8.3% | n/a | N/A |
| short_stone | 0.060 | 0.040 | 0.020 | 50.0% | n/a | N/A |
| extinction_rate | 0.000 | 0.000 | 0.000 | n/a | 0.050 | OK |

### Eval seed metrics

| Seed | avg_reward | avg_steps | avg_births | avg_deaths | score |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 12345 | 9583.145 | 1200.000 | 49.450 | 2.050 | 3.993 |
| 22222 | 9529.274 | 1200.000 | 50.050 | 2.000 | 3.971 |

### Randomized seed metrics

| Seed | avg_reward | avg_steps | avg_births | avg_deaths | stock_min | stock_avg | extinction_rate |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 12345 | 3957.180 | 520.000 | 13.620 | 0.620 | 0.890 | 0.960 | 0.000 |
| 22222 | 3983.520 | 520.000 | 13.700 | 0.530 | 0.930 | 0.980 | 0.000 |

## underrealm

Config seeds: 12345, 22222
Eval episodes/max_steps: 20/1200
Random episodes/max_steps: 40/520

### Eval diff

| Metric | Current | Baseline | Delta | Delta% | Threshold | Status |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| avg_reward | 9556.210 | 9255.690 | 300.520 | 3.2% | 8792.906 | OK |
| avg_steps | 1200.000 | 1200.000 | 0.000 | 0.0% | n/a | N/A |
| avg_births | 49.750 | 52.075 | -2.325 | -4.5% | n/a | N/A |
| avg_deaths | 2.025 | 1.875 | 0.150 | 8.0% | 2.156 | OK |
| score | 3.982 | 3.857 | 0.125 | 3.2% | 3.664 | OK |

### Randomized diff

| Metric | Current | Baseline | Delta | Delta% | Threshold | Status |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| avg_reward | 3970.350 | 3908.800 | 61.550 | 1.6% | 3596.096 | OK |
| avg_steps | 520.000 | 520.000 | 0.000 | 0.0% | n/a | N/A |
| avg_births | 13.660 | 13.550 | 0.110 | 0.8% | n/a | N/A |
| avg_deaths | 0.575 | 0.560 | 0.015 | 2.7% | n/a | N/A |
| stock_min | 0.910 | 0.915 | -0.005 | -0.5% | 0.842 | OK |
| stock_avg | 0.970 | 0.975 | -0.005 | -0.5% | n/a | N/A |
| crit | 0.000 | 0.000 | 0.000 | n/a | n/a | N/A |
| idle | 0.095 | 0.100 | -0.005 | -5.0% | n/a | N/A |
| raid_count | 0.350 | 0.375 | -0.025 | -6.7% | n/a | N/A |
| raid_deaths | 0.425 | 0.425 | 0.000 | 0.0% | n/a | N/A |
| raid_exposed | 0.835 | 0.830 | 0.005 | 0.6% | n/a | N/A |
| raid_defense | 0.600 | 0.600 | 0.000 | 0.0% | n/a | N/A |
| under_depthProgress | 0.000 | 0.000 | 0.000 | n/a | n/a | N/A |
| under_championProgress | 0.000 | 0.000 | 0.000 | n/a | n/a | N/A |
| under_frontierContested | 0.000 | 0.000 | 0.000 | n/a | n/a | N/A |
| under_championCooldown | 0.000 | 0.000 | 0.000 | n/a | n/a | N/A |
| under_readinessScore | 0.610 | 0.580 | 0.030 | 5.2% | n/a | N/A |
| under_readinessGap | 0.390 | 0.420 | -0.030 | -7.1% | n/a | N/A |
| under_readinessBlocked | 0.525 | 0.625 | -0.100 | -16.0% | n/a | N/A |
| under_readinessWarning | 0.475 | 0.375 | 0.100 | 26.7% | n/a | N/A |
| under_combatPressure | 0.235 | 0.245 | -0.010 | -4.1% | n/a | N/A |
| node_food | 0.160 | 0.165 | -0.005 | -3.0% | n/a | N/A |
| node_water | 0.060 | 0.060 | 0.000 | 0.0% | n/a | N/A |
| node_wood | 0.165 | 0.165 | 0.000 | 0.0% | n/a | N/A |
| node_stone | 0.075 | 0.075 | 0.000 | 0.0% | n/a | N/A |
| short_food | 0.040 | 0.035 | 0.005 | 14.3% | n/a | N/A |
| short_water | 0.005 | 0.010 | -0.005 | -50.0% | n/a | N/A |
| short_wood | 0.220 | 0.220 | 0.000 | 0.0% | n/a | N/A |
| short_stone | 0.060 | 0.060 | 0.000 | 0.0% | n/a | N/A |
| extinction_rate | 0.000 | 0.000 | 0.000 | n/a | 0.050 | OK |

### Eval seed metrics

| Seed | avg_reward | avg_steps | avg_births | avg_deaths | score |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 12345 | 9583.145 | 1200.000 | 49.450 | 2.050 | 3.993 |
| 22222 | 9529.274 | 1200.000 | 50.050 | 2.000 | 3.971 |

### Randomized seed metrics

| Seed | avg_reward | avg_steps | avg_births | avg_deaths | stock_min | stock_avg | extinction_rate |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 12345 | 3957.180 | 520.000 | 13.620 | 0.620 | 0.890 | 0.960 | 0.000 |
| 22222 | 3983.520 | 520.000 | 13.700 | 0.530 | 0.930 | 0.980 | 0.000 |
