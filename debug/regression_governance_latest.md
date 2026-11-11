# NodeDwarves Regression Report

Generated: 2026-11-11T18:23:55.220Z
All profiles mode: no
Gate result: PASS
Average profile score: 100.0
Seed pack: none

## Profiles

| Profile | Eval | Random | Score |
| --- | --- | --- | ---: |
| governance | PASS | PASS | 100.0 |

## governance

Config seeds: 12345, 22222
Seed pack: none
Eval episodes/max_steps: 20/1200
Eval scenarios: baseline, governance_pressure, compound_crisis
Random episodes/max_steps: 40/520

### Eval diff

| Metric | Current | Baseline | Delta | Delta% | Threshold | Status |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| avg_reward | 10298.456 | 9338.205 | 960.251 | 10.3% | 8871.295 | OK |
| avg_steps | 1200.000 | 1200.000 | 0.000 | 0.0% | n/a | N/A |
| avg_births | 46.325 | 48.825 | -2.500 | -5.1% | n/a | N/A |
| avg_deaths | 2.450 | 2.225 | 0.225 | 10.1% | 2.559 | OK |
| score | 4.291 | 3.891 | 0.400 | 10.3% | 3.696 | OK |

### Randomized diff

| Metric | Current | Baseline | Delta | Delta% | Threshold | Status |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| avg_reward | 4003.020 | 3970.350 | 32.670 | 0.8% | 3652.722 | OK |
| avg_steps | 520.000 | 520.000 | 0.000 | 0.0% | n/a | N/A |
| avg_births | 11.310 | 13.660 | -2.350 | -17.2% | n/a | N/A |
| avg_deaths | 0.685 | 0.575 | 0.110 | 19.1% | n/a | N/A |
| death_starvation | 0.000 | n/a | n/a | n/a | n/a | N/A |
| death_oldAge | 0.000 | n/a | n/a | n/a | n/a | N/A |
| death_raid | 0.475 | n/a | n/a | n/a | n/a | N/A |
| death_deepRaid | 0.000 | n/a | n/a | n/a | n/a | N/A |
| death_ruins | 0.000 | n/a | n/a | n/a | n/a | N/A |
| death_hunt | 0.215 | n/a | n/a | n/a | n/a | N/A |
| death_warriorLeague | 0.000 | n/a | n/a | n/a | n/a | N/A |
| stock_min | 0.865 | 0.910 | -0.045 | -4.9% | 0.837 | OK |
| stock_avg | 0.955 | 0.970 | -0.015 | -1.5% | n/a | N/A |
| crit | 0.090 | 0.000 | 0.090 | n/a | n/a | N/A |
| idle | 0.090 | 0.095 | -0.005 | -5.3% | n/a | N/A |
| raid_count | 0.375 | 0.350 | 0.025 | 7.1% | n/a | N/A |
| raid_deaths | 0.475 | 0.425 | 0.050 | 11.8% | n/a | N/A |
| raid_exposed | 0.900 | 0.835 | 0.065 | 7.8% | n/a | N/A |
| raid_defense | 0.600 | 0.600 | 0.000 | 0.0% | n/a | N/A |
| under_depthProgress | 0.000 | 0.000 | 0.000 | n/a | n/a | N/A |
| under_championProgress | 0.000 | 0.000 | 0.000 | n/a | n/a | N/A |
| under_frontierContested | 0.000 | 0.000 | 0.000 | n/a | n/a | N/A |
| under_championCooldown | 0.000 | 0.000 | 0.000 | n/a | n/a | N/A |
| under_readinessScore | 0.555 | 0.610 | -0.055 | -9.0% | n/a | N/A |
| under_readinessGap | 0.445 | 0.390 | 0.055 | 14.1% | n/a | N/A |
| under_readinessBlocked | 0.425 | 0.525 | -0.100 | -19.0% | n/a | N/A |
| under_readinessWarning | 0.435 | 0.475 | -0.040 | -8.4% | n/a | N/A |
| under_combatPressure | 0.195 | 0.235 | -0.040 | -17.0% | n/a | N/A |
| node_food | 0.145 | 0.160 | -0.015 | -9.4% | n/a | N/A |
| node_water | 0.055 | 0.060 | -0.005 | -8.3% | n/a | N/A |
| node_wood | 0.165 | 0.165 | 0.000 | 0.0% | n/a | N/A |
| node_stone | 0.075 | 0.075 | 0.000 | 0.0% | n/a | N/A |
| short_food | 0.085 | 0.040 | 0.045 | 112.5% | n/a | N/A |
| short_water | 0.005 | 0.005 | 0.000 | 0.0% | n/a | N/A |
| short_wood | 0.230 | 0.220 | 0.010 | 4.5% | n/a | N/A |
| short_stone | 0.080 | 0.060 | 0.020 | 33.3% | n/a | N/A |
| extinction_rate | 0.000 | 0.000 | 0.000 | n/a | 0.050 | OK |

### Eval seed metrics

| Seed | avg_reward | avg_steps | avg_births | avg_deaths | score |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 12345 | 10261.295 | 1200.000 | 44.950 | 2.250 | 4.276 |
| 22222 | 10335.617 | 1200.000 | 47.700 | 2.650 | 4.307 |

### Randomized seed metrics

| Seed | avg_reward | avg_steps | avg_births | avg_deaths | stock_min | stock_avg | extinction_rate |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 12345 | 3973.100 | 520.000 | 10.820 | 0.800 | 0.870 | 0.960 | 0.000 |
| 22222 | 4032.940 | 520.000 | 11.800 | 0.570 | 0.860 | 0.950 | 0.000 |
