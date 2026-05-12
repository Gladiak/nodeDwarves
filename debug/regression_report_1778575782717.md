# NodeDwarves Regression Report

Generated: 2026-05-12T08:49:42.723Z
All profiles mode: no
Gate result: FAIL
Average profile score: 83.3
Seed pack: none

## Profiles

| Profile | Eval | Random | Score |
| --- | --- | --- | ---: |
| social | FAIL | PASS | 83.3 |

## social

Config seeds: 12345, 22222
Seed pack: none
Eval episodes/max_steps: 20/1200
Eval scenarios: baseline, social_tension_pressure, governance_pressure
Random episodes/max_steps: 40/520

### Eval diff

| Metric | Current | Baseline | Delta | Delta% | Threshold | Status |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| avg_reward | 10465.678 | 10803.801 | -338.123 | -3.1% | 10263.611 | OK |
| avg_steps | 1200.000 | 1200.000 | 0.000 | 0.0% | n/a | N/A |
| avg_births | 46.875 | 49.925 | -3.050 | -6.1% | n/a | N/A |
| avg_deaths | 2.275 | 1.600 | 0.675 | 42.2% | 1.840 | REGRESS |
| score | 4.361 | 4.502 | -0.141 | -3.1% | 4.277 | OK |

### Randomized diff

| Metric | Current | Baseline | Delta | Delta% | Threshold | Status |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| avg_reward | 4008.165 | 4162.125 | -153.960 | -3.7% | 3829.155 | OK |
| avg_steps | 520.000 | 520.000 | 0.000 | 0.0% | n/a | N/A |
| avg_births | 11.765 | 12.500 | -0.735 | -5.9% | n/a | N/A |
| avg_deaths | 0.760 | 0.750 | 0.010 | 1.3% | n/a | N/A |
| death_starvation | 0.000 | 0.000 | 0.000 | n/a | n/a | N/A |
| death_oldAge | 0.000 | 0.000 | 0.000 | n/a | n/a | N/A |
| death_raid | 0.515 | 0.415 | 0.100 | 24.1% | n/a | N/A |
| death_deepRaid | 0.000 | 0.000 | 0.000 | n/a | n/a | N/A |
| death_ruins | 0.000 | 0.000 | 0.000 | n/a | n/a | N/A |
| death_hunt | 0.255 | 0.340 | -0.085 | -25.0% | n/a | N/A |
| death_warriorLeague | 0.000 | 0.000 | 0.000 | n/a | n/a | N/A |
| stock_min | 0.870 | 0.915 | -0.045 | -4.9% | 0.842 | OK |
| stock_avg | 0.965 | 0.970 | -0.005 | -0.5% | n/a | N/A |
| crit | 0.090 | 0.090 | 0.000 | 0.0% | n/a | N/A |
| idle | 0.085 | 0.085 | 0.000 | 0.0% | n/a | N/A |
| raid_count | 0.435 | 0.390 | 0.045 | 11.5% | n/a | N/A |
| raid_deaths | 0.515 | 0.415 | 0.100 | 24.1% | n/a | N/A |
| raid_exposed | 0.875 | 0.855 | 0.020 | 2.3% | n/a | N/A |
| raid_defense | 0.600 | 0.600 | 0.000 | 0.0% | n/a | N/A |
| under_depthProgress | 0.000 | 0.000 | 0.000 | n/a | n/a | N/A |
| under_championProgress | 0.000 | 0.000 | 0.000 | n/a | n/a | N/A |
| under_frontierContested | 0.000 | 0.000 | 0.000 | n/a | n/a | N/A |
| under_championCooldown | 0.000 | 0.000 | 0.000 | n/a | n/a | N/A |
| under_readinessScore | 0.530 | 0.555 | -0.025 | -4.5% | n/a | N/A |
| under_readinessGap | 0.470 | 0.445 | 0.025 | 5.6% | n/a | N/A |
| under_readinessBlocked | 0.560 | 0.610 | -0.050 | -8.2% | n/a | N/A |
| under_readinessWarning | 0.310 | 0.315 | -0.005 | -1.6% | n/a | N/A |
| under_combatPressure | 0.215 | 0.230 | -0.015 | -6.5% | n/a | N/A |
| node_food | 0.175 | 0.150 | 0.025 | 16.7% | n/a | N/A |
| node_water | 0.050 | 0.055 | -0.005 | -9.1% | n/a | N/A |
| node_wood | 0.165 | 0.165 | 0.000 | 0.0% | n/a | N/A |
| node_stone | 0.075 | 0.075 | 0.000 | 0.0% | n/a | N/A |
| short_food | 0.110 | 0.075 | 0.035 | 46.7% | n/a | N/A |
| short_water | 0.005 | 0.010 | -0.005 | -50.0% | n/a | N/A |
| short_wood | 0.250 | 0.235 | 0.015 | 6.4% | n/a | N/A |
| short_stone | 0.075 | 0.060 | 0.015 | 25.0% | n/a | N/A |
| extinction_rate | 0.000 | 0.000 | 0.000 | n/a | 0.050 | OK |

### Eval seed metrics

| Seed | avg_reward | avg_steps | avg_births | avg_deaths | score |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 12345 | 10390.956 | 1200.000 | 47.050 | 2.550 | 4.330 |
| 22222 | 10540.399 | 1200.000 | 46.700 | 2.000 | 4.392 |

### Randomized seed metrics

| Seed | avg_reward | avg_steps | avg_births | avg_deaths | stock_min | stock_avg | extinction_rate |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 12345 | 3979.380 | 520.000 | 11.650 | 0.970 | 0.830 | 0.950 | 0.000 |
| 22222 | 4036.950 | 520.000 | 11.880 | 0.550 | 0.910 | 0.980 | 0.000 |
