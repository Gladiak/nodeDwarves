# NodeDwarves Regression Report

Generated: 2026-02-26T13:18:44.936Z
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
| avg_reward | 9506.358 | 9562.588 | -56.230 | -0.6% | 9084.459 | OK |
| avg_steps | 1200.000 | 1200.000 | 0.000 | 0.0% | n/a | N/A |
| avg_births | 50.650 | 49.550 | 1.100 | 2.2% | n/a | N/A |
| avg_deaths | 1.925 | 4.375 | -2.450 | -56.0% | 5.031 | OK |
| score | 3.961 | 3.984 | -0.023 | -0.6% | 3.785 | OK |

### Randomized diff

| Metric | Current | Baseline | Delta | Delta% | Threshold | Status |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| avg_reward | 3926.630 | 3906.195 | 20.435 | 0.5% | 3593.699 | OK |
| avg_steps | 520.000 | 520.000 | 0.000 | 0.0% | n/a | N/A |
| avg_births | 13.345 | 13.600 | -0.255 | -1.9% | n/a | N/A |
| avg_deaths | 0.750 | 1.050 | -0.300 | -28.6% | n/a | N/A |
| stock_min | 0.910 | 0.960 | -0.050 | -5.2% | 0.883 | OK |
| stock_avg | 0.970 | 0.985 | -0.015 | -1.5% | n/a | N/A |
| crit | 0.000 | 0.000 | 0.000 | n/a | n/a | N/A |
| idle | 0.095 | 0.135 | -0.040 | -29.6% | n/a | N/A |
| raid_count | 0.525 | 0.375 | 0.150 | 40.0% | n/a | N/A |
| raid_deaths | 0.675 | 0.500 | 0.175 | 35.0% | n/a | N/A |
| raid_exposed | 0.860 | 0.770 | 0.090 | 11.7% | n/a | N/A |
| raid_defense | 0.600 | 0.600 | 0.000 | 0.0% | n/a | N/A |
| under_depthProgress | 0.000 | n/a | n/a | n/a | n/a | N/A |
| under_championProgress | 0.000 | n/a | n/a | n/a | n/a | N/A |
| under_frontierContested | 0.000 | n/a | n/a | n/a | n/a | N/A |
| under_championCooldown | 0.000 | n/a | n/a | n/a | n/a | N/A |
| under_readinessScore | 0.590 | n/a | n/a | n/a | n/a | N/A |
| under_readinessGap | 0.410 | n/a | n/a | n/a | n/a | N/A |
| under_readinessBlocked | 0.515 | n/a | n/a | n/a | n/a | N/A |
| under_readinessWarning | 0.460 | n/a | n/a | n/a | n/a | N/A |
| under_combatPressure | 0.225 | n/a | n/a | n/a | n/a | N/A |
| node_food | 0.165 | 0.115 | 0.050 | 43.5% | n/a | N/A |
| node_water | 0.060 | 0.060 | 0.000 | 0.0% | n/a | N/A |
| node_wood | 0.165 | 0.165 | 0.000 | 0.0% | n/a | N/A |
| node_stone | 0.075 | 0.075 | 0.000 | 0.0% | n/a | N/A |
| short_food | 0.045 | 0.050 | -0.005 | -10.0% | n/a | N/A |
| short_water | 0.005 | 0.010 | -0.005 | -50.0% | n/a | N/A |
| short_wood | 0.210 | 0.240 | -0.030 | -12.5% | n/a | N/A |
| short_stone | 0.060 | 0.040 | 0.020 | 50.0% | n/a | N/A |
| extinction_rate | 0.000 | 0.000 | 0.000 | n/a | 0.050 | OK |

### Eval seed metrics

| Seed | avg_reward | avg_steps | avg_births | avg_deaths | score |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 12345 | 9502.985 | 1200.000 | 50.800 | 2.050 | 3.960 |
| 22222 | 9509.731 | 1200.000 | 50.500 | 1.800 | 3.962 |

### Randomized seed metrics

| Seed | avg_reward | avg_steps | avg_births | avg_deaths | stock_min | stock_avg | extinction_rate |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 12345 | 3918.990 | 520.000 | 13.570 | 0.850 | 0.940 | 0.980 | 0.000 |
| 22222 | 3934.270 | 520.000 | 13.120 | 0.650 | 0.880 | 0.960 | 0.000 |

## underrealm

Config seeds: 12345, 22222
Seed pack: none
Eval episodes/max_steps: 20/1200
Eval scenarios: baseline, underrealm_push, compound_crisis
Random episodes/max_steps: 40/520

### Eval diff

| Metric | Current | Baseline | Delta | Delta% | Threshold | Status |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| avg_reward | 9333.727 | 9255.690 | 78.037 | 0.8% | 8792.906 | OK |
| avg_steps | 1200.000 | 1200.000 | 0.000 | 0.0% | n/a | N/A |
| avg_births | 47.850 | 52.075 | -4.225 | -8.1% | n/a | N/A |
| avg_deaths | 1.750 | 1.875 | -0.125 | -6.7% | 2.156 | OK |
| score | 3.889 | 3.857 | 0.033 | 0.8% | 3.664 | OK |

### Randomized diff

| Metric | Current | Baseline | Delta | Delta% | Threshold | Status |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| avg_reward | 3926.630 | 3908.800 | 17.830 | 0.5% | 3596.096 | OK |
| avg_steps | 520.000 | 520.000 | 0.000 | 0.0% | n/a | N/A |
| avg_births | 13.345 | 13.550 | -0.205 | -1.5% | n/a | N/A |
| avg_deaths | 0.750 | 0.560 | 0.190 | 33.9% | n/a | N/A |
| stock_min | 0.910 | 0.915 | -0.005 | -0.5% | 0.842 | OK |
| stock_avg | 0.970 | 0.975 | -0.005 | -0.5% | n/a | N/A |
| crit | 0.000 | 0.000 | 0.000 | n/a | n/a | N/A |
| idle | 0.095 | 0.100 | -0.005 | -5.0% | n/a | N/A |
| raid_count | 0.525 | 0.375 | 0.150 | 40.0% | n/a | N/A |
| raid_deaths | 0.675 | 0.425 | 0.250 | 58.8% | n/a | N/A |
| raid_exposed | 0.860 | 0.830 | 0.030 | 3.6% | n/a | N/A |
| raid_defense | 0.600 | 0.600 | 0.000 | 0.0% | n/a | N/A |
| under_depthProgress | 0.000 | 0.000 | 0.000 | n/a | n/a | N/A |
| under_championProgress | 0.000 | 0.000 | 0.000 | n/a | n/a | N/A |
| under_frontierContested | 0.000 | 0.000 | 0.000 | n/a | n/a | N/A |
| under_championCooldown | 0.000 | 0.000 | 0.000 | n/a | n/a | N/A |
| under_readinessScore | 0.590 | 0.580 | 0.010 | 1.7% | n/a | N/A |
| under_readinessGap | 0.410 | 0.420 | -0.010 | -2.4% | n/a | N/A |
| under_readinessBlocked | 0.515 | 0.625 | -0.110 | -17.6% | n/a | N/A |
| under_readinessWarning | 0.460 | 0.375 | 0.085 | 22.7% | n/a | N/A |
| under_combatPressure | 0.225 | 0.245 | -0.020 | -8.2% | n/a | N/A |
| node_food | 0.165 | 0.165 | 0.000 | 0.0% | n/a | N/A |
| node_water | 0.060 | 0.060 | 0.000 | 0.0% | n/a | N/A |
| node_wood | 0.165 | 0.165 | 0.000 | 0.0% | n/a | N/A |
| node_stone | 0.075 | 0.075 | 0.000 | 0.0% | n/a | N/A |
| short_food | 0.045 | 0.035 | 0.010 | 28.6% | n/a | N/A |
| short_water | 0.005 | 0.010 | -0.005 | -50.0% | n/a | N/A |
| short_wood | 0.210 | 0.220 | -0.010 | -4.5% | n/a | N/A |
| short_stone | 0.060 | 0.060 | 0.000 | 0.0% | n/a | N/A |
| extinction_rate | 0.000 | 0.000 | 0.000 | n/a | 0.050 | OK |

### Eval seed metrics

| Seed | avg_reward | avg_steps | avg_births | avg_deaths | score |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 12345 | 9265.079 | 1200.000 | 48.500 | 1.700 | 3.860 |
| 22222 | 9402.376 | 1200.000 | 47.200 | 1.800 | 3.918 |

### Randomized seed metrics

| Seed | avg_reward | avg_steps | avg_births | avg_deaths | stock_min | stock_avg | extinction_rate |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 12345 | 3918.990 | 520.000 | 13.570 | 0.850 | 0.940 | 0.980 | 0.000 |
| 22222 | 3934.270 | 520.000 | 13.120 | 0.650 | 0.880 | 0.960 | 0.000 |

## governance

Config seeds: 12345, 22222
Seed pack: none
Eval episodes/max_steps: 20/1200
Eval scenarios: baseline, governance_pressure, compound_crisis
Random episodes/max_steps: 40/520

### Eval diff

| Metric | Current | Baseline | Delta | Delta% | Threshold | Status |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| avg_reward | 9256.732 | 9338.205 | -81.473 | -0.9% | 8871.295 | OK |
| avg_steps | 1200.000 | 1200.000 | 0.000 | 0.0% | n/a | N/A |
| avg_births | 49.250 | 48.825 | 0.425 | 0.9% | n/a | N/A |
| avg_deaths | 1.650 | 2.225 | -0.575 | -25.8% | 2.559 | OK |
| score | 3.857 | 3.891 | -0.034 | -0.9% | 3.696 | OK |

### Randomized diff

| Metric | Current | Baseline | Delta | Delta% | Threshold | Status |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| avg_reward | 3926.630 | 3970.350 | -43.720 | -1.1% | 3652.722 | OK |
| avg_steps | 520.000 | 520.000 | 0.000 | 0.0% | n/a | N/A |
| avg_births | 13.345 | 13.660 | -0.315 | -2.3% | n/a | N/A |
| avg_deaths | 0.750 | 0.575 | 0.175 | 30.4% | n/a | N/A |
| stock_min | 0.910 | 0.910 | -0.000 | -0.0% | 0.837 | OK |
| stock_avg | 0.970 | 0.970 | 0.000 | 0.0% | n/a | N/A |
| crit | 0.000 | 0.000 | 0.000 | n/a | n/a | N/A |
| idle | 0.095 | 0.095 | 0.000 | 0.0% | n/a | N/A |
| raid_count | 0.525 | 0.350 | 0.175 | 50.0% | n/a | N/A |
| raid_deaths | 0.675 | 0.425 | 0.250 | 58.8% | n/a | N/A |
| raid_exposed | 0.860 | 0.835 | 0.025 | 3.0% | n/a | N/A |
| raid_defense | 0.600 | 0.600 | 0.000 | 0.0% | n/a | N/A |
| under_depthProgress | 0.000 | 0.000 | 0.000 | n/a | n/a | N/A |
| under_championProgress | 0.000 | 0.000 | 0.000 | n/a | n/a | N/A |
| under_frontierContested | 0.000 | 0.000 | 0.000 | n/a | n/a | N/A |
| under_championCooldown | 0.000 | 0.000 | 0.000 | n/a | n/a | N/A |
| under_readinessScore | 0.590 | 0.610 | -0.020 | -3.3% | n/a | N/A |
| under_readinessGap | 0.410 | 0.390 | 0.020 | 5.1% | n/a | N/A |
| under_readinessBlocked | 0.515 | 0.525 | -0.010 | -1.9% | n/a | N/A |
| under_readinessWarning | 0.460 | 0.475 | -0.015 | -3.2% | n/a | N/A |
| under_combatPressure | 0.225 | 0.235 | -0.010 | -4.3% | n/a | N/A |
| node_food | 0.165 | 0.160 | 0.005 | 3.1% | n/a | N/A |
| node_water | 0.060 | 0.060 | 0.000 | 0.0% | n/a | N/A |
| node_wood | 0.165 | 0.165 | 0.000 | 0.0% | n/a | N/A |
| node_stone | 0.075 | 0.075 | 0.000 | 0.0% | n/a | N/A |
| short_food | 0.045 | 0.040 | 0.005 | 12.5% | n/a | N/A |
| short_water | 0.005 | 0.005 | 0.000 | 0.0% | n/a | N/A |
| short_wood | 0.210 | 0.220 | -0.010 | -4.5% | n/a | N/A |
| short_stone | 0.060 | 0.060 | 0.000 | 0.0% | n/a | N/A |
| extinction_rate | 0.000 | 0.000 | 0.000 | n/a | 0.050 | OK |

### Eval seed metrics

| Seed | avg_reward | avg_steps | avg_births | avg_deaths | score |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 12345 | 9170.373 | 1200.000 | 49.750 | 1.650 | 3.821 |
| 22222 | 9343.092 | 1200.000 | 48.750 | 1.650 | 3.893 |

### Randomized seed metrics

| Seed | avg_reward | avg_steps | avg_births | avg_deaths | stock_min | stock_avg | extinction_rate |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 12345 | 3918.990 | 520.000 | 13.570 | 0.850 | 0.940 | 0.980 | 0.000 |
| 22222 | 3934.270 | 520.000 | 13.120 | 0.650 | 0.880 | 0.960 | 0.000 |
