# NodeDwarves Regression Report

Generated: 2026-09-16T10:19:46.739Z
All profiles mode: no
Gate result: PASS
Average profile score: 100.0
Seed pack: none

## Profiles

| Profile | Eval | Random | Score |
| --- | --- | --- | ---: |
| underrealm | PASS | PASS | 100.0 |

## underrealm

Config seeds: 12345, 22222
Seed pack: none
Eval episodes/max_steps: 20/1200
Eval scenarios: baseline, underrealm_push, compound_crisis
Random episodes/max_steps: 40/520

### Eval diff

| Metric | Current | Baseline | Delta | Delta% | Threshold | Status |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| avg_reward | 10168.941 | 9255.690 | 913.250 | 9.9% | 8792.906 | OK |
| avg_steps | 1200.000 | 1200.000 | 0.000 | 0.0% | n/a | N/A |
| avg_births | 56.350 | 52.075 | 4.275 | 8.2% | 44.264 | OK |
| avg_deaths | 3.150 | 1.875 | 1.275 | 68.0% | 3.375 | OK |
| score | 4.237 | 3.857 | 0.381 | 9.9% | 3.664 | OK |

### Randomized diff

| Metric | Current | Baseline | Delta | Delta% | Threshold | Status |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| avg_reward | 4020.105 | 3908.800 | 111.305 | 2.8% | 3596.096 | OK |
| avg_steps | 520.000 | 520.000 | 0.000 | 0.0% | n/a | N/A |
| avg_births | 11.860 | 13.550 | -1.690 | -12.5% | n/a | N/A |
| avg_deaths | 0.810 | 0.560 | 0.250 | 44.6% | n/a | N/A |
| death_starvation | 0.000 | n/a | n/a | n/a | n/a | N/A |
| death_oldAge | 0.000 | n/a | n/a | n/a | n/a | N/A |
| death_raid | 0.550 | n/a | n/a | n/a | n/a | N/A |
| death_deepRaid | 0.000 | n/a | n/a | n/a | n/a | N/A |
| death_ruins | 0.000 | n/a | n/a | n/a | n/a | N/A |
| death_hunt | 0.265 | n/a | n/a | n/a | n/a | N/A |
| death_warriorLeague | 0.000 | n/a | n/a | n/a | n/a | N/A |
| stock_min | 0.895 | 0.915 | -0.020 | -2.2% | 0.842 | OK |
| stock_avg | 0.970 | 0.975 | -0.005 | -0.5% | n/a | N/A |
| crit | 0.090 | 0.000 | 0.090 | n/a | n/a | N/A |
| idle | 0.090 | 0.100 | -0.010 | -10.0% | n/a | N/A |
| raid_count | 0.500 | 0.375 | 0.125 | 33.3% | n/a | N/A |
| raid_deaths | 0.550 | 0.425 | 0.125 | 29.4% | n/a | N/A |
| raid_exposed | 0.855 | 0.830 | 0.025 | 3.0% | n/a | N/A |
| raid_defense | 0.600 | 0.600 | 0.000 | 0.0% | n/a | N/A |
| under_depthProgress | 0.000 | 0.000 | 0.000 | n/a | n/a | N/A |
| under_championProgress | 0.000 | 0.000 | 0.000 | n/a | n/a | N/A |
| under_frontierContested | 0.000 | 0.000 | 0.000 | n/a | n/a | N/A |
| under_championCooldown | 0.000 | 0.000 | 0.000 | n/a | n/a | N/A |
| under_readinessScore | 0.540 | 0.580 | -0.040 | -6.9% | n/a | N/A |
| under_readinessGap | 0.460 | 0.420 | 0.040 | 9.5% | n/a | N/A |
| under_readinessBlocked | 0.590 | 0.625 | -0.035 | -5.6% | n/a | N/A |
| under_readinessWarning | 0.315 | 0.375 | -0.060 | -16.0% | n/a | N/A |
| under_combatPressure | 0.220 | 0.245 | -0.025 | -10.2% | n/a | N/A |
| node_food | 0.180 | 0.165 | 0.015 | 9.1% | n/a | N/A |
| node_water | 0.050 | 0.060 | -0.010 | -16.7% | n/a | N/A |
| node_wood | 0.165 | 0.165 | 0.000 | 0.0% | n/a | N/A |
| node_stone | 0.075 | 0.075 | 0.000 | 0.0% | n/a | N/A |
| short_food | 0.110 | 0.035 | 0.075 | 214.3% | n/a | N/A |
| short_water | 0.005 | 0.010 | -0.005 | -50.0% | n/a | N/A |
| short_wood | 0.255 | 0.220 | 0.035 | 15.9% | n/a | N/A |
| short_stone | 0.075 | 0.060 | 0.015 | 25.0% | n/a | N/A |
| extinction_rate | 0.000 | 0.000 | 0.000 | n/a | 0.050 | OK |

### Eval seed metrics

| Seed | avg_reward | avg_steps | avg_births | avg_deaths | score |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 12345 | 10098.592 | 1200.000 | 55.550 | 3.400 | 4.208 |
| 22222 | 10239.290 | 1200.000 | 57.150 | 2.900 | 4.266 |

### Randomized seed metrics

| Seed | avg_reward | avg_steps | avg_births | avg_deaths | stock_min | stock_avg | extinction_rate |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 12345 | 3996.010 | 520.000 | 11.820 | 1.050 | 0.880 | 0.960 | 0.000 |
| 22222 | 4044.200 | 520.000 | 11.900 | 0.570 | 0.910 | 0.980 | 0.000 |
