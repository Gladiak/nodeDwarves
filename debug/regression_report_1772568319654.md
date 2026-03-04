# NodeDwarves Regression Report

Generated: 2026-03-03T20:05:19.655Z
All profiles mode: yes
Gate result: FAIL
Average profile score: 94.4
Seed pack: none

## Profiles

| Profile | Eval | Random | Score |
| --- | --- | --- | ---: |
| standard | PASS | PASS | 100.0 |
| underrealm | FAIL | PASS | 83.3 |
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
| avg_reward | 11054.110 | 9562.588 | 1491.522 | 15.6% | 9084.459 | OK |
| avg_steps | 1200.000 | 1200.000 | 0.000 | 0.0% | n/a | N/A |
| avg_births | 50.950 | 49.550 | 1.400 | 2.8% | n/a | N/A |
| avg_deaths | 2.100 | 4.375 | -2.275 | -52.0% | 5.031 | OK |
| score | 4.606 | 3.984 | 0.621 | 15.6% | 3.785 | OK |

### Randomized diff

| Metric | Current | Baseline | Delta | Delta% | Threshold | Status |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| avg_reward | 4395.860 | 3906.195 | 489.665 | 12.5% | 3593.699 | OK |
| avg_steps | 520.000 | 520.000 | 0.000 | 0.0% | n/a | N/A |
| avg_births | 13.250 | 13.600 | -0.350 | -2.6% | n/a | N/A |
| avg_deaths | 0.575 | 1.050 | -0.475 | -45.2% | n/a | N/A |
| death_starvation | 0.000 | n/a | n/a | n/a | n/a | N/A |
| death_oldAge | 0.000 | n/a | n/a | n/a | n/a | N/A |
| death_raid | 0.425 | n/a | n/a | n/a | n/a | N/A |
| death_deepRaid | 0.000 | n/a | n/a | n/a | n/a | N/A |
| death_ruins | 0.000 | n/a | n/a | n/a | n/a | N/A |
| death_hunt | 0.145 | n/a | n/a | n/a | n/a | N/A |
| death_warriorLeague | 0.000 | n/a | n/a | n/a | n/a | N/A |
| stock_min | 0.895 | 0.960 | -0.065 | -6.8% | 0.883 | OK |
| stock_avg | 0.965 | 0.985 | -0.020 | -2.0% | n/a | N/A |
| crit | 0.090 | 0.000 | 0.090 | n/a | n/a | N/A |
| idle | 0.095 | 0.135 | -0.040 | -29.6% | n/a | N/A |
| raid_count | 0.425 | 0.375 | 0.050 | 13.3% | n/a | N/A |
| raid_deaths | 0.425 | 0.500 | -0.075 | -15.0% | n/a | N/A |
| raid_exposed | 0.865 | 0.770 | 0.095 | 12.3% | n/a | N/A |
| raid_defense | 0.600 | 0.600 | 0.000 | 0.0% | n/a | N/A |
| under_depthProgress | 0.000 | n/a | n/a | n/a | n/a | N/A |
| under_championProgress | 0.000 | n/a | n/a | n/a | n/a | N/A |
| under_frontierContested | 0.030 | n/a | n/a | n/a | n/a | N/A |
| under_championCooldown | 0.000 | n/a | n/a | n/a | n/a | N/A |
| under_readinessScore | 0.590 | n/a | n/a | n/a | n/a | N/A |
| under_readinessGap | 0.410 | n/a | n/a | n/a | n/a | N/A |
| under_readinessBlocked | 0.460 | n/a | n/a | n/a | n/a | N/A |
| under_readinessWarning | 0.465 | n/a | n/a | n/a | n/a | N/A |
| under_combatPressure | 0.220 | n/a | n/a | n/a | n/a | N/A |
| node_food | 0.155 | 0.115 | 0.040 | 34.8% | n/a | N/A |
| node_water | 0.060 | 0.060 | 0.000 | 0.0% | n/a | N/A |
| node_wood | 0.165 | 0.165 | 0.000 | 0.0% | n/a | N/A |
| node_stone | 0.075 | 0.075 | 0.000 | 0.0% | n/a | N/A |
| short_food | 0.080 | 0.050 | 0.030 | 60.0% | n/a | N/A |
| short_water | 0.005 | 0.010 | -0.005 | -50.0% | n/a | N/A |
| short_wood | 0.230 | 0.240 | -0.010 | -4.2% | n/a | N/A |
| short_stone | 0.065 | 0.040 | 0.025 | 62.5% | n/a | N/A |
| extinction_rate | 0.000 | 0.000 | 0.000 | n/a | 0.050 | OK |

### Eval seed metrics

| Seed | avg_reward | avg_steps | avg_births | avg_deaths | score |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 12345 | 10998.368 | 1200.000 | 51.850 | 1.850 | 4.583 |
| 22222 | 11109.852 | 1200.000 | 50.050 | 2.350 | 4.629 |

### Randomized seed metrics

| Seed | avg_reward | avg_steps | avg_births | avg_deaths | stock_min | stock_avg | extinction_rate |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 12345 | 4464.730 | 520.000 | 13.620 | 0.680 | 0.930 | 0.980 | 0.000 |
| 22222 | 4326.990 | 520.000 | 12.880 | 0.470 | 0.860 | 0.950 | 0.000 |

## underrealm

Config seeds: 12345, 22222
Seed pack: none
Eval episodes/max_steps: 20/1200
Eval scenarios: baseline, underrealm_push, compound_crisis
Random episodes/max_steps: 40/520

### Eval diff

| Metric | Current | Baseline | Delta | Delta% | Threshold | Status |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| avg_reward | 10512.967 | 9255.690 | 1257.276 | 13.6% | 8792.906 | OK |
| avg_steps | 1200.000 | 1200.000 | 0.000 | 0.0% | n/a | N/A |
| avg_births | 56.500 | 52.075 | 4.425 | 8.5% | n/a | N/A |
| avg_deaths | 2.950 | 1.875 | 1.075 | 57.3% | 2.156 | REGRESS |
| score | 4.380 | 3.857 | 0.524 | 13.6% | 3.664 | OK |

### Randomized diff

| Metric | Current | Baseline | Delta | Delta% | Threshold | Status |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| avg_reward | 4395.860 | 3908.800 | 487.060 | 12.5% | 3596.096 | OK |
| avg_steps | 520.000 | 520.000 | 0.000 | 0.0% | n/a | N/A |
| avg_births | 13.250 | 13.550 | -0.300 | -2.2% | n/a | N/A |
| avg_deaths | 0.575 | 0.560 | 0.015 | 2.7% | n/a | N/A |
| death_starvation | 0.000 | n/a | n/a | n/a | n/a | N/A |
| death_oldAge | 0.000 | n/a | n/a | n/a | n/a | N/A |
| death_raid | 0.425 | n/a | n/a | n/a | n/a | N/A |
| death_deepRaid | 0.000 | n/a | n/a | n/a | n/a | N/A |
| death_ruins | 0.000 | n/a | n/a | n/a | n/a | N/A |
| death_hunt | 0.145 | n/a | n/a | n/a | n/a | N/A |
| death_warriorLeague | 0.000 | n/a | n/a | n/a | n/a | N/A |
| stock_min | 0.895 | 0.915 | -0.020 | -2.2% | 0.842 | OK |
| stock_avg | 0.965 | 0.975 | -0.010 | -1.0% | n/a | N/A |
| crit | 0.090 | 0.000 | 0.090 | n/a | n/a | N/A |
| idle | 0.095 | 0.100 | -0.005 | -5.0% | n/a | N/A |
| raid_count | 0.425 | 0.375 | 0.050 | 13.3% | n/a | N/A |
| raid_deaths | 0.425 | 0.425 | -0.000 | -0.0% | n/a | N/A |
| raid_exposed | 0.865 | 0.830 | 0.035 | 4.2% | n/a | N/A |
| raid_defense | 0.600 | 0.600 | 0.000 | 0.0% | n/a | N/A |
| under_depthProgress | 0.000 | 0.000 | 0.000 | n/a | n/a | N/A |
| under_championProgress | 0.000 | 0.000 | 0.000 | n/a | n/a | N/A |
| under_frontierContested | 0.030 | 0.000 | 0.030 | n/a | n/a | N/A |
| under_championCooldown | 0.000 | 0.000 | 0.000 | n/a | n/a | N/A |
| under_readinessScore | 0.590 | 0.580 | 0.010 | 1.7% | n/a | N/A |
| under_readinessGap | 0.410 | 0.420 | -0.010 | -2.4% | n/a | N/A |
| under_readinessBlocked | 0.460 | 0.625 | -0.165 | -26.4% | n/a | N/A |
| under_readinessWarning | 0.465 | 0.375 | 0.090 | 24.0% | n/a | N/A |
| under_combatPressure | 0.220 | 0.245 | -0.025 | -10.2% | n/a | N/A |
| node_food | 0.155 | 0.165 | -0.010 | -6.1% | n/a | N/A |
| node_water | 0.060 | 0.060 | 0.000 | 0.0% | n/a | N/A |
| node_wood | 0.165 | 0.165 | 0.000 | 0.0% | n/a | N/A |
| node_stone | 0.075 | 0.075 | 0.000 | 0.0% | n/a | N/A |
| short_food | 0.080 | 0.035 | 0.045 | 128.6% | n/a | N/A |
| short_water | 0.005 | 0.010 | -0.005 | -50.0% | n/a | N/A |
| short_wood | 0.230 | 0.220 | 0.010 | 4.5% | n/a | N/A |
| short_stone | 0.065 | 0.060 | 0.005 | 8.3% | n/a | N/A |
| extinction_rate | 0.000 | 0.000 | 0.000 | n/a | 0.050 | OK |

### Eval seed metrics

| Seed | avg_reward | avg_steps | avg_births | avg_deaths | score |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 12345 | 10486.758 | 1200.000 | 56.900 | 2.700 | 4.369 |
| 22222 | 10539.175 | 1200.000 | 56.100 | 3.200 | 4.391 |

### Randomized seed metrics

| Seed | avg_reward | avg_steps | avg_births | avg_deaths | stock_min | stock_avg | extinction_rate |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 12345 | 4464.730 | 520.000 | 13.620 | 0.680 | 0.930 | 0.980 | 0.000 |
| 22222 | 4326.990 | 520.000 | 12.880 | 0.470 | 0.860 | 0.950 | 0.000 |

## governance

Config seeds: 12345, 22222
Seed pack: none
Eval episodes/max_steps: 20/1200
Eval scenarios: baseline, governance_pressure, compound_crisis
Random episodes/max_steps: 40/520

### Eval diff

| Metric | Current | Baseline | Delta | Delta% | Threshold | Status |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| avg_reward | 10813.763 | 9338.205 | 1475.558 | 15.8% | 8871.295 | OK |
| avg_steps | 1200.000 | 1200.000 | 0.000 | 0.0% | n/a | N/A |
| avg_births | 50.125 | 48.825 | 1.300 | 2.7% | n/a | N/A |
| avg_deaths | 1.750 | 2.225 | -0.475 | -21.3% | 2.559 | OK |
| score | 4.506 | 3.891 | 0.615 | 15.8% | 3.696 | OK |

### Randomized diff

| Metric | Current | Baseline | Delta | Delta% | Threshold | Status |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| avg_reward | 4395.860 | 3970.350 | 425.510 | 10.7% | 3652.722 | OK |
| avg_steps | 520.000 | 520.000 | 0.000 | 0.0% | n/a | N/A |
| avg_births | 13.250 | 13.660 | -0.410 | -3.0% | n/a | N/A |
| avg_deaths | 0.575 | 0.575 | 0.000 | 0.0% | n/a | N/A |
| death_starvation | 0.000 | n/a | n/a | n/a | n/a | N/A |
| death_oldAge | 0.000 | n/a | n/a | n/a | n/a | N/A |
| death_raid | 0.425 | n/a | n/a | n/a | n/a | N/A |
| death_deepRaid | 0.000 | n/a | n/a | n/a | n/a | N/A |
| death_ruins | 0.000 | n/a | n/a | n/a | n/a | N/A |
| death_hunt | 0.145 | n/a | n/a | n/a | n/a | N/A |
| death_warriorLeague | 0.000 | n/a | n/a | n/a | n/a | N/A |
| stock_min | 0.895 | 0.910 | -0.015 | -1.6% | 0.837 | OK |
| stock_avg | 0.965 | 0.970 | -0.005 | -0.5% | n/a | N/A |
| crit | 0.090 | 0.000 | 0.090 | n/a | n/a | N/A |
| idle | 0.095 | 0.095 | 0.000 | 0.0% | n/a | N/A |
| raid_count | 0.425 | 0.350 | 0.075 | 21.4% | n/a | N/A |
| raid_deaths | 0.425 | 0.425 | -0.000 | -0.0% | n/a | N/A |
| raid_exposed | 0.865 | 0.835 | 0.030 | 3.6% | n/a | N/A |
| raid_defense | 0.600 | 0.600 | 0.000 | 0.0% | n/a | N/A |
| under_depthProgress | 0.000 | 0.000 | 0.000 | n/a | n/a | N/A |
| under_championProgress | 0.000 | 0.000 | 0.000 | n/a | n/a | N/A |
| under_frontierContested | 0.030 | 0.000 | 0.030 | n/a | n/a | N/A |
| under_championCooldown | 0.000 | 0.000 | 0.000 | n/a | n/a | N/A |
| under_readinessScore | 0.590 | 0.610 | -0.020 | -3.3% | n/a | N/A |
| under_readinessGap | 0.410 | 0.390 | 0.020 | 5.1% | n/a | N/A |
| under_readinessBlocked | 0.460 | 0.525 | -0.065 | -12.4% | n/a | N/A |
| under_readinessWarning | 0.465 | 0.475 | -0.010 | -2.1% | n/a | N/A |
| under_combatPressure | 0.220 | 0.235 | -0.015 | -6.4% | n/a | N/A |
| node_food | 0.155 | 0.160 | -0.005 | -3.1% | n/a | N/A |
| node_water | 0.060 | 0.060 | 0.000 | 0.0% | n/a | N/A |
| node_wood | 0.165 | 0.165 | 0.000 | 0.0% | n/a | N/A |
| node_stone | 0.075 | 0.075 | 0.000 | 0.0% | n/a | N/A |
| short_food | 0.080 | 0.040 | 0.040 | 100.0% | n/a | N/A |
| short_water | 0.005 | 0.005 | 0.000 | 0.0% | n/a | N/A |
| short_wood | 0.230 | 0.220 | 0.010 | 4.5% | n/a | N/A |
| short_stone | 0.065 | 0.060 | 0.005 | 8.3% | n/a | N/A |
| extinction_rate | 0.000 | 0.000 | 0.000 | n/a | 0.050 | OK |

### Eval seed metrics

| Seed | avg_reward | avg_steps | avg_births | avg_deaths | score |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 12345 | 10826.355 | 1200.000 | 50.700 | 1.600 | 4.511 |
| 22222 | 10801.170 | 1200.000 | 49.550 | 1.900 | 4.500 |

### Randomized seed metrics

| Seed | avg_reward | avg_steps | avg_births | avg_deaths | stock_min | stock_avg | extinction_rate |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 12345 | 4464.730 | 520.000 | 13.620 | 0.680 | 0.930 | 0.980 | 0.000 |
| 22222 | 4326.990 | 520.000 | 12.880 | 0.470 | 0.860 | 0.950 | 0.000 |
