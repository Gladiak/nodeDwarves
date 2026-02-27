# NodeDwarves Regression Report

Generated: 2026-02-27T14:33:06.699Z
All profiles mode: yes
Gate result: PASS
Average profile score: 100.0
Seed pack: none

## Profiles

| Profile | Eval | Random | Score |
| --- | --- | --- | ---: |
| standard | PASS | PASS | 100.0 |
| underrealm | PASS | PASS | 100.0 |
| governance | PASS | PASS | 100.0 |

## standard

Config seeds: 12345, 22222
Seed pack: none
Eval episodes/max_steps: 20/1200
Eval scenarios: baseline, full_sim
Random episodes/max_steps: 40/520

### Eval diff

| Metric | Current | Baseline | Delta | Delta% | Threshold | Status |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| avg_reward | 9526.871 | 9562.588 | -35.717 | -0.4% | 9084.459 | OK |
| avg_steps | 1200.000 | 1200.000 | 0.000 | 0.0% | n/a | N/A |
| avg_births | 51.900 | 49.550 | 2.350 | 4.7% | n/a | N/A |
| avg_deaths | 1.775 | 4.375 | -2.600 | -59.4% | 5.031 | OK |
| score | 3.970 | 3.984 | -0.015 | -0.4% | 3.785 | OK |

### Randomized diff

| Metric | Current | Baseline | Delta | Delta% | Threshold | Status |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| avg_reward | 3950.975 | 3906.195 | 44.780 | 1.1% | 3593.699 | OK |
| avg_steps | 520.000 | 520.000 | 0.000 | 0.0% | n/a | N/A |
| avg_births | 13.435 | 13.600 | -0.165 | -1.2% | n/a | N/A |
| avg_deaths | 0.560 | 1.050 | -0.490 | -46.7% | n/a | N/A |
| stock_min | 0.925 | 0.960 | -0.035 | -3.6% | 0.883 | OK |
| stock_avg | 0.980 | 0.985 | -0.005 | -0.5% | n/a | N/A |
| crit | 0.000 | 0.000 | 0.000 | n/a | n/a | N/A |
| idle | 0.095 | 0.135 | -0.040 | -29.6% | n/a | N/A |
| raid_count | 0.355 | 0.375 | -0.020 | -5.3% | n/a | N/A |
| raid_deaths | 0.410 | 0.500 | -0.090 | -18.0% | n/a | N/A |
| raid_exposed | 0.885 | 0.770 | 0.115 | 14.9% | n/a | N/A |
| raid_defense | 0.600 | 0.600 | 0.000 | 0.0% | n/a | N/A |
| under_depthProgress | 0.000 | n/a | n/a | n/a | n/a | N/A |
| under_championProgress | 0.000 | n/a | n/a | n/a | n/a | N/A |
| under_frontierContested | 0.000 | n/a | n/a | n/a | n/a | N/A |
| under_championCooldown | 0.000 | n/a | n/a | n/a | n/a | N/A |
| under_readinessScore | 0.580 | n/a | n/a | n/a | n/a | N/A |
| under_readinessGap | 0.420 | n/a | n/a | n/a | n/a | N/A |
| under_readinessBlocked | 0.535 | n/a | n/a | n/a | n/a | N/A |
| under_readinessWarning | 0.425 | n/a | n/a | n/a | n/a | N/A |
| under_combatPressure | 0.225 | n/a | n/a | n/a | n/a | N/A |
| node_food | 0.155 | 0.115 | 0.040 | 34.8% | n/a | N/A |
| node_water | 0.060 | 0.060 | -0.000 | -0.0% | n/a | N/A |
| node_wood | 0.165 | 0.165 | 0.000 | 0.0% | n/a | N/A |
| node_stone | 0.075 | 0.075 | 0.000 | 0.0% | n/a | N/A |
| short_food | 0.055 | 0.050 | 0.005 | 10.0% | n/a | N/A |
| short_water | 0.005 | 0.010 | -0.005 | -50.0% | n/a | N/A |
| short_wood | 0.220 | 0.240 | -0.020 | -8.3% | n/a | N/A |
| short_stone | 0.055 | 0.040 | 0.015 | 37.5% | n/a | N/A |
| extinction_rate | 0.000 | 0.000 | 0.000 | n/a | 0.050 | OK |

### Eval seed metrics

| Seed | avg_reward | avg_steps | avg_births | avg_deaths | score |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 12345 | 9561.922 | 1200.000 | 50.700 | 1.600 | 3.984 |
| 22222 | 9491.820 | 1200.000 | 53.100 | 1.950 | 3.955 |

### Randomized seed metrics

| Seed | avg_reward | avg_steps | avg_births | avg_deaths | stock_min | stock_avg | extinction_rate |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 12345 | 3958.530 | 520.000 | 13.220 | 0.570 | 0.950 | 0.990 | 0.000 |
| 22222 | 3943.420 | 520.000 | 13.650 | 0.550 | 0.900 | 0.970 | 0.000 |

## underrealm

Config seeds: 12345, 22222
Seed pack: none
Eval episodes/max_steps: 20/1200
Eval scenarios: baseline, underrealm_push, compound_crisis
Random episodes/max_steps: 40/520

### Eval diff

| Metric | Current | Baseline | Delta | Delta% | Threshold | Status |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| avg_reward | 9321.611 | 9255.690 | 65.921 | 0.7% | 8792.906 | OK |
| avg_steps | 1200.000 | 1200.000 | 0.000 | 0.0% | n/a | N/A |
| avg_births | 49.750 | 52.075 | -2.325 | -4.5% | n/a | N/A |
| avg_deaths | 1.400 | 1.875 | -0.475 | -25.3% | 2.156 | OK |
| score | 3.884 | 3.857 | 0.027 | 0.7% | 3.664 | OK |

### Randomized diff

| Metric | Current | Baseline | Delta | Delta% | Threshold | Status |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| avg_reward | 3950.975 | 3908.800 | 42.175 | 1.1% | 3596.096 | OK |
| avg_steps | 520.000 | 520.000 | 0.000 | 0.0% | n/a | N/A |
| avg_births | 13.435 | 13.550 | -0.115 | -0.8% | n/a | N/A |
| avg_deaths | 0.560 | 0.560 | 0.000 | 0.0% | n/a | N/A |
| stock_min | 0.925 | 0.915 | 0.010 | 1.1% | 0.842 | OK |
| stock_avg | 0.980 | 0.975 | 0.005 | 0.5% | n/a | N/A |
| crit | 0.000 | 0.000 | 0.000 | n/a | n/a | N/A |
| idle | 0.095 | 0.100 | -0.005 | -5.0% | n/a | N/A |
| raid_count | 0.355 | 0.375 | -0.020 | -5.3% | n/a | N/A |
| raid_deaths | 0.410 | 0.425 | -0.015 | -3.5% | n/a | N/A |
| raid_exposed | 0.885 | 0.830 | 0.055 | 6.6% | n/a | N/A |
| raid_defense | 0.600 | 0.600 | 0.000 | 0.0% | n/a | N/A |
| under_depthProgress | 0.000 | 0.000 | 0.000 | n/a | n/a | N/A |
| under_championProgress | 0.000 | 0.000 | 0.000 | n/a | n/a | N/A |
| under_frontierContested | 0.000 | 0.000 | 0.000 | n/a | n/a | N/A |
| under_championCooldown | 0.000 | 0.000 | 0.000 | n/a | n/a | N/A |
| under_readinessScore | 0.580 | 0.580 | 0.000 | 0.0% | n/a | N/A |
| under_readinessGap | 0.420 | 0.420 | 0.000 | 0.0% | n/a | N/A |
| under_readinessBlocked | 0.535 | 0.625 | -0.090 | -14.4% | n/a | N/A |
| under_readinessWarning | 0.425 | 0.375 | 0.050 | 13.3% | n/a | N/A |
| under_combatPressure | 0.225 | 0.245 | -0.020 | -8.2% | n/a | N/A |
| node_food | 0.155 | 0.165 | -0.010 | -6.1% | n/a | N/A |
| node_water | 0.060 | 0.060 | 0.000 | 0.0% | n/a | N/A |
| node_wood | 0.165 | 0.165 | 0.000 | 0.0% | n/a | N/A |
| node_stone | 0.075 | 0.075 | 0.000 | 0.0% | n/a | N/A |
| short_food | 0.055 | 0.035 | 0.020 | 57.1% | n/a | N/A |
| short_water | 0.005 | 0.010 | -0.005 | -50.0% | n/a | N/A |
| short_wood | 0.220 | 0.220 | 0.000 | 0.0% | n/a | N/A |
| short_stone | 0.055 | 0.060 | -0.005 | -8.3% | n/a | N/A |
| extinction_rate | 0.000 | 0.000 | 0.000 | n/a | 0.050 | OK |

### Eval seed metrics

| Seed | avg_reward | avg_steps | avg_births | avg_deaths | score |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 12345 | 9328.617 | 1200.000 | 48.800 | 1.200 | 3.887 |
| 22222 | 9314.605 | 1200.000 | 50.700 | 1.600 | 3.881 |

### Randomized seed metrics

| Seed | avg_reward | avg_steps | avg_births | avg_deaths | stock_min | stock_avg | extinction_rate |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 12345 | 3958.530 | 520.000 | 13.220 | 0.570 | 0.950 | 0.990 | 0.000 |
| 22222 | 3943.420 | 520.000 | 13.650 | 0.550 | 0.900 | 0.970 | 0.000 |

## governance

Config seeds: 12345, 22222
Seed pack: none
Eval episodes/max_steps: 20/1200
Eval scenarios: baseline, governance_pressure, compound_crisis
Random episodes/max_steps: 40/520

### Eval diff

| Metric | Current | Baseline | Delta | Delta% | Threshold | Status |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| avg_reward | 9294.540 | 9338.205 | -43.665 | -0.5% | 8871.295 | OK |
| avg_steps | 1200.000 | 1200.000 | 0.000 | 0.0% | n/a | N/A |
| avg_births | 49.700 | 48.825 | 0.875 | 1.8% | n/a | N/A |
| avg_deaths | 1.450 | 2.225 | -0.775 | -34.8% | 2.559 | OK |
| score | 3.873 | 3.891 | -0.018 | -0.5% | 3.696 | OK |

### Randomized diff

| Metric | Current | Baseline | Delta | Delta% | Threshold | Status |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| avg_reward | 3950.975 | 3970.350 | -19.375 | -0.5% | 3652.722 | OK |
| avg_steps | 520.000 | 520.000 | 0.000 | 0.0% | n/a | N/A |
| avg_births | 13.435 | 13.660 | -0.225 | -1.6% | n/a | N/A |
| avg_deaths | 0.560 | 0.575 | -0.015 | -2.6% | n/a | N/A |
| stock_min | 0.925 | 0.910 | 0.015 | 1.6% | 0.837 | OK |
| stock_avg | 0.980 | 0.970 | 0.010 | 1.0% | n/a | N/A |
| crit | 0.000 | 0.000 | 0.000 | n/a | n/a | N/A |
| idle | 0.095 | 0.095 | 0.000 | 0.0% | n/a | N/A |
| raid_count | 0.355 | 0.350 | 0.005 | 1.4% | n/a | N/A |
| raid_deaths | 0.410 | 0.425 | -0.015 | -3.5% | n/a | N/A |
| raid_exposed | 0.885 | 0.835 | 0.050 | 6.0% | n/a | N/A |
| raid_defense | 0.600 | 0.600 | 0.000 | 0.0% | n/a | N/A |
| under_depthProgress | 0.000 | 0.000 | 0.000 | n/a | n/a | N/A |
| under_championProgress | 0.000 | 0.000 | 0.000 | n/a | n/a | N/A |
| under_frontierContested | 0.000 | 0.000 | 0.000 | n/a | n/a | N/A |
| under_championCooldown | 0.000 | 0.000 | 0.000 | n/a | n/a | N/A |
| under_readinessScore | 0.580 | 0.610 | -0.030 | -4.9% | n/a | N/A |
| under_readinessGap | 0.420 | 0.390 | 0.030 | 7.7% | n/a | N/A |
| under_readinessBlocked | 0.535 | 0.525 | 0.010 | 1.9% | n/a | N/A |
| under_readinessWarning | 0.425 | 0.475 | -0.050 | -10.5% | n/a | N/A |
| under_combatPressure | 0.225 | 0.235 | -0.010 | -4.3% | n/a | N/A |
| node_food | 0.155 | 0.160 | -0.005 | -3.1% | n/a | N/A |
| node_water | 0.060 | 0.060 | -0.000 | -0.0% | n/a | N/A |
| node_wood | 0.165 | 0.165 | 0.000 | 0.0% | n/a | N/A |
| node_stone | 0.075 | 0.075 | 0.000 | 0.0% | n/a | N/A |
| short_food | 0.055 | 0.040 | 0.015 | 37.5% | n/a | N/A |
| short_water | 0.005 | 0.005 | 0.000 | 0.0% | n/a | N/A |
| short_wood | 0.220 | 0.220 | 0.000 | 0.0% | n/a | N/A |
| short_stone | 0.055 | 0.060 | -0.005 | -8.3% | n/a | N/A |
| extinction_rate | 0.000 | 0.000 | 0.000 | n/a | 0.050 | OK |

### Eval seed metrics

| Seed | avg_reward | avg_steps | avg_births | avg_deaths | score |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 12345 | 9329.378 | 1200.000 | 48.500 | 1.300 | 3.887 |
| 22222 | 9259.702 | 1200.000 | 50.900 | 1.600 | 3.858 |

### Randomized seed metrics

| Seed | avg_reward | avg_steps | avg_births | avg_deaths | stock_min | stock_avg | extinction_rate |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 12345 | 3958.530 | 520.000 | 13.220 | 0.570 | 0.950 | 0.990 | 0.000 |
| 22222 | 3943.420 | 520.000 | 13.650 | 0.550 | 0.900 | 0.970 | 0.000 |
