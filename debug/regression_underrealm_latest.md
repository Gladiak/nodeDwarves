# NodeDwarves Regression Report

Generated: 2026-11-11T13:46:09.137Z
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
| avg_reward | 10063.481 | 9255.690 | 807.791 | 8.7% | 8792.906 | OK |
| avg_steps | 1200.000 | 1200.000 | 0.000 | 0.0% | n/a | N/A |
| avg_births | 54.700 | 52.075 | 2.625 | 5.0% | 44.264 | OK |
| avg_deaths | 3.200 | 1.875 | 1.325 | 70.7% | 3.375 | OK |
| score | 4.193 | 3.857 | 0.337 | 8.7% | 3.664 | OK |

### Randomized diff

| Metric | Current | Baseline | Delta | Delta% | Threshold | Status |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| avg_reward | 4003.020 | 3908.800 | 94.220 | 2.4% | 3596.096 | OK |
| avg_steps | 520.000 | 520.000 | 0.000 | 0.0% | n/a | N/A |
| avg_births | 11.310 | 13.550 | -2.240 | -16.5% | n/a | N/A |
| avg_deaths | 0.685 | 0.560 | 0.125 | 22.3% | n/a | N/A |
| death_starvation | 0.000 | n/a | n/a | n/a | n/a | N/A |
| death_oldAge | 0.000 | n/a | n/a | n/a | n/a | N/A |
| death_raid | 0.475 | n/a | n/a | n/a | n/a | N/A |
| death_deepRaid | 0.000 | n/a | n/a | n/a | n/a | N/A |
| death_ruins | 0.000 | n/a | n/a | n/a | n/a | N/A |
| death_hunt | 0.215 | n/a | n/a | n/a | n/a | N/A |
| death_warriorLeague | 0.000 | n/a | n/a | n/a | n/a | N/A |
| stock_min | 0.865 | 0.915 | -0.050 | -5.5% | 0.842 | OK |
| stock_avg | 0.955 | 0.975 | -0.020 | -2.1% | n/a | N/A |
| crit | 0.090 | 0.000 | 0.090 | n/a | n/a | N/A |
| idle | 0.090 | 0.100 | -0.010 | -10.0% | n/a | N/A |
| raid_count | 0.375 | 0.375 | 0.000 | 0.0% | n/a | N/A |
| raid_deaths | 0.475 | 0.425 | 0.050 | 11.8% | n/a | N/A |
| raid_exposed | 0.900 | 0.830 | 0.070 | 8.4% | n/a | N/A |
| raid_defense | 0.600 | 0.600 | 0.000 | 0.0% | n/a | N/A |
| under_depthProgress | 0.000 | 0.000 | 0.000 | n/a | n/a | N/A |
| under_championProgress | 0.000 | 0.000 | 0.000 | n/a | n/a | N/A |
| under_frontierContested | 0.000 | 0.000 | 0.000 | n/a | n/a | N/A |
| under_championCooldown | 0.000 | 0.000 | 0.000 | n/a | n/a | N/A |
| under_readinessScore | 0.555 | 0.580 | -0.025 | -4.3% | n/a | N/A |
| under_readinessGap | 0.445 | 0.420 | 0.025 | 6.0% | n/a | N/A |
| under_readinessBlocked | 0.425 | 0.625 | -0.200 | -32.0% | n/a | N/A |
| under_readinessWarning | 0.435 | 0.375 | 0.060 | 16.0% | n/a | N/A |
| under_combatPressure | 0.195 | 0.245 | -0.050 | -20.4% | n/a | N/A |
| node_food | 0.145 | 0.165 | -0.020 | -12.1% | n/a | N/A |
| node_water | 0.055 | 0.060 | -0.005 | -8.3% | n/a | N/A |
| node_wood | 0.165 | 0.165 | 0.000 | 0.0% | n/a | N/A |
| node_stone | 0.075 | 0.075 | 0.000 | 0.0% | n/a | N/A |
| short_food | 0.085 | 0.035 | 0.050 | 142.9% | n/a | N/A |
| short_water | 0.005 | 0.010 | -0.005 | -50.0% | n/a | N/A |
| short_wood | 0.230 | 0.220 | 0.010 | 4.5% | n/a | N/A |
| short_stone | 0.080 | 0.060 | 0.020 | 33.3% | n/a | N/A |
| extinction_rate | 0.000 | 0.000 | 0.000 | n/a | 0.050 | OK |

### Eval seed metrics

| Seed | avg_reward | avg_steps | avg_births | avg_deaths | score |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 12345 | 10010.173 | 1200.000 | 54.300 | 2.700 | 4.171 |
| 22222 | 10116.789 | 1200.000 | 55.100 | 3.700 | 4.215 |

### Randomized seed metrics

| Seed | avg_reward | avg_steps | avg_births | avg_deaths | stock_min | stock_avg | extinction_rate |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 12345 | 3973.100 | 520.000 | 10.820 | 0.800 | 0.870 | 0.960 | 0.000 |
| 22222 | 4032.940 | 520.000 | 11.800 | 0.570 | 0.860 | 0.950 | 0.000 |
