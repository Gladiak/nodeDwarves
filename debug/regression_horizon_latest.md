# NodeDwarves Regression Report

Generated: 2026-11-11T14:35:25.892Z
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
Seed pack: pack_alpha (weekly; request=weekly, week=107424)
Eval episodes/max_steps: 20/1600
Eval scenarios: baseline, underrealm_push, governance_pressure, compound_crisis
Random episodes/max_steps: 40/700

### Eval diff

| Metric | Current | Baseline | Delta | Delta% | Threshold | Status |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| avg_reward | 13562.228 | 12519.205 | 1043.022 | 8.3% | 11768.053 | OK |
| avg_steps | 1600.000 | 1600.000 | 0.000 | 0.0% | n/a | N/A |
| avg_births | 71.287 | 68.025 | 3.262 | 4.8% | 57.821 | OK |
| avg_deaths | 3.775 | 2.650 | 1.125 | 42.5% | 4.400 | OK |
| score | 4.238 | 3.912 | 0.326 | 8.3% | 3.678 | OK |

### Randomized diff

| Metric | Current | Baseline | Delta | Delta% | Threshold | Status |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| avg_reward | 5735.213 | 5677.035 | 58.178 | 1.0% | 5109.332 | OK |
| avg_steps | 700.000 | 700.000 | 0.000 | 0.0% | n/a | N/A |
| avg_births | 15.400 | 17.215 | -1.815 | -10.5% | n/a | N/A |
| avg_deaths | 1.045 | 0.700 | 0.345 | 49.3% | n/a | N/A |
| death_starvation | 0.000 | n/a | n/a | n/a | n/a | N/A |
| death_oldAge | 0.000 | n/a | n/a | n/a | n/a | N/A |
| death_raid | 0.660 | n/a | n/a | n/a | n/a | N/A |
| death_deepRaid | 0.000 | n/a | n/a | n/a | n/a | N/A |
| death_ruins | 0.000 | n/a | n/a | n/a | n/a | N/A |
| death_hunt | 0.383 | n/a | n/a | n/a | n/a | N/A |
| death_warriorLeague | 0.000 | n/a | n/a | n/a | n/a | N/A |
| stock_min | 0.940 | 0.950 | -0.010 | -1.1% | 0.855 | OK |
| stock_avg | 0.983 | 0.985 | -0.002 | -0.3% | n/a | N/A |
| crit | 0.090 | 0.000 | 0.090 | n/a | n/a | N/A |
| idle | 0.100 | 0.125 | -0.025 | -20.0% | n/a | N/A |
| raid_count | 0.527 | 0.510 | 0.017 | 3.4% | n/a | N/A |
| raid_deaths | 0.660 | 0.575 | 0.085 | 14.8% | n/a | N/A |
| raid_exposed | 0.865 | 0.825 | 0.040 | 4.8% | n/a | N/A |
| raid_defense | 0.600 | 0.600 | 0.000 | 0.0% | n/a | N/A |
| under_depthProgress | 0.000 | 0.000 | 0.000 | n/a | n/a | N/A |
| under_championProgress | 0.000 | 0.000 | 0.000 | n/a | n/a | N/A |
| under_frontierContested | 0.000 | 0.000 | 0.000 | n/a | n/a | N/A |
| under_championCooldown | 0.000 | 0.000 | 0.000 | n/a | n/a | N/A |
| under_readinessScore | 0.545 | 0.515 | 0.030 | 5.8% | 0.453 | OK |
| under_readinessGap | 0.455 | 0.485 | -0.030 | -6.2% | n/a | N/A |
| under_readinessBlocked | 0.825 | 0.875 | -0.050 | -5.7% | 1.067 | OK |
| under_readinessWarning | 0.155 | 0.125 | 0.030 | 24.0% | n/a | N/A |
| under_combatPressure | 0.268 | 0.280 | -0.013 | -4.5% | 0.342 | OK |
| node_food | 0.155 | 0.195 | -0.040 | -20.5% | n/a | N/A |
| node_water | 0.065 | 0.065 | 0.000 | 0.0% | n/a | N/A |
| node_wood | 0.168 | 0.165 | 0.003 | 1.5% | n/a | N/A |
| node_stone | 0.073 | 0.075 | -0.003 | -3.3% | n/a | N/A |
| short_food | 0.075 | 0.030 | 0.045 | 150.0% | n/a | N/A |
| short_water | 0.005 | 0.005 | 0.000 | 0.0% | n/a | N/A |
| short_wood | 0.193 | 0.180 | 0.013 | 6.9% | n/a | N/A |
| short_stone | 0.070 | 0.065 | 0.005 | 7.7% | n/a | N/A |
| extinction_rate | 0.000 | 0.000 | 0.000 | n/a | 0.050 | OK |

### Eval seed metrics

| Seed | avg_reward | avg_steps | avg_births | avg_deaths | score |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 12345 | 13649.849 | 1600.000 | 69.900 | 3.050 | 4.266 |
| 22222 | 13629.226 | 1600.000 | 73.100 | 4.100 | 4.259 |
| 33333 | 13440.332 | 1600.000 | 71.300 | 3.900 | 4.200 |
| 44444 | 13529.505 | 1600.000 | 70.850 | 4.050 | 4.228 |

### Randomized seed metrics

| Seed | avg_reward | avg_steps | avg_births | avg_deaths | stock_min | stock_avg | extinction_rate |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 12345 | 5770.240 | 700.000 | 14.880 | 1.180 | 0.940 | 0.980 | 0.000 |
| 22222 | 5727.680 | 700.000 | 15.620 | 0.950 | 0.950 | 0.990 | 0.000 |
| 33333 | 5671.770 | 700.000 | 15.150 | 0.930 | 0.930 | 0.980 | 0.000 |
| 44444 | 5771.160 | 700.000 | 15.950 | 1.120 | 0.940 | 0.980 | 0.000 |
