# NodeDwarves Regression Report

Generated: 2026-09-16T11:13:06.250Z
All profiles mode: no
Gate result: PASS
Average profile score: 100.0
Seed pack: none

## Profiles

| Profile | Eval | Random | Score |
| --- | --- | --- | ---: |
| horizon | PASS | PASS | 100.0 |

## horizon

Config seeds: 12345, 22222, 33333, 44444
Seed pack: pack_alpha (weekly; request=weekly, week=107416)
Eval episodes/max_steps: 20/1600
Eval scenarios: baseline, underrealm_push, governance_pressure, compound_crisis
Random episodes/max_steps: 40/700

### Eval diff

| Metric | Current | Baseline | Delta | Delta% | Threshold | Status |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| avg_reward | 13773.122 | 12519.205 | 1253.917 | 10.0% | 11768.053 | OK |
| avg_steps | 1600.000 | 1600.000 | 0.000 | 0.0% | n/a | N/A |
| avg_births | 70.425 | 68.025 | 2.400 | 3.5% | 57.821 | OK |
| avg_deaths | 4.150 | 2.650 | 1.500 | 56.6% | 4.400 | OK |
| score | 4.304 | 3.912 | 0.392 | 10.0% | 3.678 | OK |

### Randomized diff

| Metric | Current | Baseline | Delta | Delta% | Threshold | Status |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| avg_reward | 5842.280 | 5677.035 | 165.245 | 2.9% | 5109.332 | OK |
| avg_steps | 700.000 | 700.000 | 0.000 | 0.0% | n/a | N/A |
| avg_births | 15.970 | 17.215 | -1.245 | -7.2% | n/a | N/A |
| avg_deaths | 0.952 | 0.700 | 0.252 | 36.1% | n/a | N/A |
| death_starvation | 0.000 | n/a | n/a | n/a | n/a | N/A |
| death_oldAge | 0.000 | n/a | n/a | n/a | n/a | N/A |
| death_raid | 0.608 | n/a | n/a | n/a | n/a | N/A |
| death_deepRaid | 0.000 | n/a | n/a | n/a | n/a | N/A |
| death_ruins | 0.000 | n/a | n/a | n/a | n/a | N/A |
| death_hunt | 0.345 | n/a | n/a | n/a | n/a | N/A |
| death_warriorLeague | 0.000 | n/a | n/a | n/a | n/a | N/A |
| stock_min | 0.948 | 0.950 | -0.002 | -0.3% | 0.855 | OK |
| stock_avg | 0.985 | 0.985 | -0.000 | -0.0% | n/a | N/A |
| crit | 0.090 | 0.000 | 0.090 | n/a | n/a | N/A |
| idle | 0.110 | 0.125 | -0.015 | -12.0% | n/a | N/A |
| raid_count | 0.547 | 0.510 | 0.037 | 7.4% | n/a | N/A |
| raid_deaths | 0.608 | 0.575 | 0.033 | 5.7% | n/a | N/A |
| raid_exposed | 0.830 | 0.825 | 0.005 | 0.6% | n/a | N/A |
| raid_defense | 0.600 | 0.600 | 0.000 | 0.0% | n/a | N/A |
| under_depthProgress | 0.000 | 0.000 | 0.000 | n/a | n/a | N/A |
| under_championProgress | 0.000 | 0.000 | 0.000 | n/a | n/a | N/A |
| under_frontierContested | 0.000 | 0.000 | 0.000 | n/a | n/a | N/A |
| under_championCooldown | 0.000 | 0.000 | 0.000 | n/a | n/a | N/A |
| under_readinessScore | 0.530 | 0.515 | 0.015 | 2.9% | 0.453 | OK |
| under_readinessGap | 0.470 | 0.485 | -0.015 | -3.1% | n/a | N/A |
| under_readinessBlocked | 0.842 | 0.875 | -0.033 | -3.7% | 1.067 | OK |
| under_readinessWarning | 0.117 | 0.125 | -0.008 | -6.0% | n/a | N/A |
| under_combatPressure | 0.265 | 0.280 | -0.015 | -5.4% | 0.342 | OK |
| node_food | 0.172 | 0.195 | -0.023 | -11.5% | n/a | N/A |
| node_water | 0.065 | 0.065 | 0.000 | 0.0% | n/a | N/A |
| node_wood | 0.168 | 0.165 | 0.003 | 1.5% | n/a | N/A |
| node_stone | 0.073 | 0.075 | -0.003 | -3.3% | n/a | N/A |
| short_food | 0.080 | 0.030 | 0.050 | 166.7% | n/a | N/A |
| short_water | 0.005 | 0.005 | 0.000 | 0.0% | n/a | N/A |
| short_wood | 0.193 | 0.180 | 0.013 | 6.9% | n/a | N/A |
| short_stone | 0.060 | 0.065 | -0.005 | -7.7% | n/a | N/A |
| extinction_rate | 0.000 | 0.000 | 0.000 | n/a | 0.050 | OK |

### Eval seed metrics

| Seed | avg_reward | avg_steps | avg_births | avg_deaths | score |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 12345 | 13731.952 | 1600.000 | 69.200 | 4.350 | 4.291 |
| 22222 | 13870.723 | 1600.000 | 73.050 | 3.850 | 4.335 |
| 33333 | 13786.501 | 1600.000 | 67.050 | 4.150 | 4.308 |
| 44444 | 13703.314 | 1600.000 | 72.400 | 4.250 | 4.282 |

### Randomized seed metrics

| Seed | avg_reward | avg_steps | avg_births | avg_deaths | stock_min | stock_avg | extinction_rate |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 12345 | 5895.390 | 700.000 | 16.300 | 0.880 | 0.950 | 0.990 | 0.000 |
| 22222 | 5861.160 | 700.000 | 15.880 | 0.930 | 0.970 | 0.990 | 0.000 |
| 33333 | 5770.880 | 700.000 | 15.800 | 0.820 | 0.950 | 0.990 | 0.000 |
| 44444 | 5841.690 | 700.000 | 15.900 | 1.180 | 0.920 | 0.970 | 0.000 |
