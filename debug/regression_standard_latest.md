# NodeDwarves Regression Report

Generated: 2026-11-11T18:23:47.061Z
All profiles mode: no
Gate result: PASS
Average profile score: 100.0
Seed pack: none

## Profiles

| Profile | Eval | Random | Score |
| --- | --- | --- | ---: |
| standard | PASS | PASS | 100.0 |

## standard

Config seeds: 12345, 22222
Seed pack: none
Eval episodes/max_steps: 20/1200
Eval scenarios: baseline, full_sim
Random episodes/max_steps: 40/520

### Eval diff

| Metric | Current | Baseline | Delta | Delta% | Threshold | Status |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| avg_reward | 10356.722 | 9562.588 | 794.134 | 8.3% | 9084.459 | OK |
| avg_steps | 1200.000 | 1200.000 | 0.000 | 0.0% | n/a | N/A |
| avg_births | 47.225 | 49.550 | -2.325 | -4.7% | n/a | N/A |
| avg_deaths | 2.750 | 4.375 | -1.625 | -37.1% | 5.031 | OK |
| score | 4.315 | 3.984 | 0.331 | 8.3% | 3.785 | OK |

### Randomized diff

| Metric | Current | Baseline | Delta | Delta% | Threshold | Status |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| avg_reward | 4003.020 | 3906.195 | 96.825 | 2.5% | 3593.699 | OK |
| avg_steps | 520.000 | 520.000 | 0.000 | 0.0% | n/a | N/A |
| avg_births | 11.310 | 13.600 | -2.290 | -16.8% | n/a | N/A |
| avg_deaths | 0.685 | 1.050 | -0.365 | -34.8% | n/a | N/A |
| death_starvation | 0.000 | n/a | n/a | n/a | n/a | N/A |
| death_oldAge | 0.000 | n/a | n/a | n/a | n/a | N/A |
| death_raid | 0.475 | n/a | n/a | n/a | n/a | N/A |
| death_deepRaid | 0.000 | n/a | n/a | n/a | n/a | N/A |
| death_ruins | 0.000 | n/a | n/a | n/a | n/a | N/A |
| death_hunt | 0.215 | n/a | n/a | n/a | n/a | N/A |
| death_warriorLeague | 0.000 | n/a | n/a | n/a | n/a | N/A |
| stock_min | 0.865 | 0.960 | -0.095 | -9.9% | 0.864 | OK |
| stock_avg | 0.955 | 0.985 | -0.030 | -3.0% | n/a | N/A |
| crit | 0.090 | 0.000 | 0.090 | n/a | n/a | N/A |
| idle | 0.090 | 0.135 | -0.045 | -33.3% | n/a | N/A |
| raid_count | 0.375 | 0.375 | 0.000 | 0.0% | n/a | N/A |
| raid_deaths | 0.475 | 0.500 | -0.025 | -5.0% | n/a | N/A |
| raid_exposed | 0.900 | 0.770 | 0.130 | 16.9% | n/a | N/A |
| raid_defense | 0.600 | 0.600 | 0.000 | 0.0% | n/a | N/A |
| under_depthProgress | 0.000 | n/a | n/a | n/a | n/a | N/A |
| under_championProgress | 0.000 | n/a | n/a | n/a | n/a | N/A |
| under_frontierContested | 0.000 | n/a | n/a | n/a | n/a | N/A |
| under_championCooldown | 0.000 | n/a | n/a | n/a | n/a | N/A |
| under_readinessScore | 0.555 | n/a | n/a | n/a | n/a | N/A |
| under_readinessGap | 0.445 | n/a | n/a | n/a | n/a | N/A |
| under_readinessBlocked | 0.425 | n/a | n/a | n/a | n/a | N/A |
| under_readinessWarning | 0.435 | n/a | n/a | n/a | n/a | N/A |
| under_combatPressure | 0.195 | n/a | n/a | n/a | n/a | N/A |
| node_food | 0.145 | 0.115 | 0.030 | 26.1% | n/a | N/A |
| node_water | 0.055 | 0.060 | -0.005 | -8.3% | n/a | N/A |
| node_wood | 0.165 | 0.165 | 0.000 | 0.0% | n/a | N/A |
| node_stone | 0.075 | 0.075 | 0.000 | 0.0% | n/a | N/A |
| short_food | 0.085 | 0.050 | 0.035 | 70.0% | n/a | N/A |
| short_water | 0.005 | 0.010 | -0.005 | -50.0% | n/a | N/A |
| short_wood | 0.230 | 0.240 | -0.010 | -4.2% | n/a | N/A |
| short_stone | 0.080 | 0.040 | 0.040 | 100.0% | n/a | N/A |
| extinction_rate | 0.000 | 0.000 | 0.000 | n/a | 0.050 | OK |

### Eval seed metrics

| Seed | avg_reward | avg_steps | avg_births | avg_deaths | score |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 12345 | 10334.110 | 1200.000 | 47.950 | 2.800 | 4.306 |
| 22222 | 10379.333 | 1200.000 | 46.500 | 2.700 | 4.325 |

### Randomized seed metrics

| Seed | avg_reward | avg_steps | avg_births | avg_deaths | stock_min | stock_avg | extinction_rate |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 12345 | 3973.100 | 520.000 | 10.820 | 0.800 | 0.870 | 0.960 | 0.000 |
| 22222 | 4032.940 | 520.000 | 11.800 | 0.570 | 0.860 | 0.950 | 0.000 |
