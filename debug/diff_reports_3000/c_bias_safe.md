# Benchmark Report Diff

- baseline report: `/Users/gladiak/ProgettiLavoro/nodeDwarves/benchmark_cache/headless_benchmark_baseline.json`
- candidate report: `/Users/gladiak/ProgettiLavoro/nodeDwarves/debug/candidate_reports_3000/c_bias_safe.json`
- baseline variant: `baseline`
- candidate variant: `c_bias_safe`
- compared seeds: `101,202,303,404`

## Summary Deltas (candidate - baseline)

| metric | abs | rel |
| --- | ---: | ---: |
| population | -5.0 | -1.98% |
| morale | +0.0003 | +0.04% |
| beerBoost | +0.0008 | +4.88% |
| hunger | -0.0022 | -1.39% |
| thirst | +0.0030 | +2.71% |
| underDepth | 0.00 | 0.00% |
| underChamp | 0.00 | n/a |
| underFail | -0.25 | -100.00% |
| underBlocked | 0.00 | 0.00% |
| underContested | 0.00 | 0.00% |
| underReadiness | -0.014 | -2.66% |
| underHeroProm | 0.00 | 0.00% |
| underHeroLoss | 0.00 | n/a |
| underHeroAct | 0.00 | 0.00% |
| underHeroSurv | 0.00 | n/a |
| beer | -145.5 | -1.72% |
| food | -36.7 | -9.45% |
| water | +1.3 | +0.34% |
| resource_avg_rel | n/a | -3.61% |

## Schism Decree Deltas

| metric | abs | rel |
| --- | ---: | ---: |
| decrees_issued_total | -1 | -4.76% |
| decrees_active_ticks_total | -200 | -4.76% |

| decree | issued abs | issued rel | issued share delta | active ticks abs | active ticks rel | active share delta |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| deep_claims | -3 | -100.00% | -14.29pp | -600 | -100.00% | -14.29pp |
| forge_quota | +2 | +66.67% | +10.71pp | +400 | +66.67% | +10.71pp |
| frontier_levy | -4 | -100.00% | -19.05pp | -800 | -100.00% | -19.05pp |
| granary_compact | +4 | +50.00% | +21.90pp | +800 | +50.00% | +21.90pp |
| hearth_festivity | 0 | 0.00% | +0.71pp | 0 | 0.00% | +0.71pp |

## Seed Deltas

| seed | metric | abs | rel |
| ---: | --- | ---: | ---: |
| 101 | population | +12.0 | +4.74% |
| 101 | morale | -0.0013 | -0.15% |
| 101 | beerBoost | -0.0014 | -7.92% |
| 101 | hunger | -0.0073 | -4.82% |
| 101 | thirst | +0.0080 | +7.52% |
| 101 | underDepth | 0.00 | 0.00% |
| 101 | underChamp | 0.00 | n/a |
| 101 | underFail | -1.00 | -100.00% |
| 101 | underBlocked | 0.00 | 0.00% |
| 101 | underContested | 0.00 | 0.00% |
| 101 | underReadiness | -0.025 | -4.58% |
| 101 | underHeroProm | 0.00 | 0.00% |
| 101 | underHeroLoss | 0.00 | n/a |
| 101 | underHeroAct | 0.00 | 0.00% |
| 101 | underHeroSurv | 0.00 | n/a |
| 101 | beer | -795.8 | -8.38% |
| 101 | food | -12.8 | -3.08% |
| 101 | water | -17.2 | -4.30% |
| 101 | resource_avg_rel | n/a | -5.26% |
| 202 | population | +7.0 | +2.70% |
| 202 | morale | +0.0048 | +0.55% |
| 202 | beerBoost | +0.0030 | +20.69% |
| 202 | hunger | -0.0066 | -3.98% |
| 202 | thirst | +0.0020 | +1.82% |
| 202 | underDepth | 0.00 | 0.00% |
| 202 | underChamp | 0.00 | n/a |
| 202 | underFail | 0.00 | n/a |
| 202 | underBlocked | 0.00 | 0.00% |
| 202 | underContested | 0.00 | 0.00% |
| 202 | underReadiness | 0.000 | 0.00% |
| 202 | underHeroProm | 0.00 | 0.00% |
| 202 | underHeroLoss | 0.00 | n/a |
| 202 | underHeroAct | 0.00 | 0.00% |
| 202 | underHeroSurv | 0.00 | n/a |
| 202 | beer | +516.5 | +7.14% |
| 202 | food | -92.2 | -20.04% |
| 202 | water | -42.1 | -9.13% |
| 202 | resource_avg_rel | n/a | -7.35% |
| 303 | population | 0.0 | 0.00% |
| 303 | morale | 0.0000 | 0.00% |
| 303 | beerBoost | 0.0000 | 0.00% |
| 303 | hunger | 0.0000 | 0.00% |
| 303 | thirst | 0.0000 | 0.00% |
| 303 | underDepth | 0.00 | 0.00% |
| 303 | underChamp | 0.00 | n/a |
| 303 | underFail | 0.00 | n/a |
| 303 | underBlocked | 0.00 | 0.00% |
| 303 | underContested | 0.00 | 0.00% |
| 303 | underReadiness | 0.000 | 0.00% |
| 303 | underHeroProm | 0.00 | 0.00% |
| 303 | underHeroLoss | 0.00 | n/a |
| 303 | underHeroAct | 0.00 | 0.00% |
| 303 | underHeroSurv | 0.00 | n/a |
| 303 | beer | 0.0 | 0.00% |
| 303 | food | 0.0 | 0.00% |
| 303 | water | 0.0 | 0.00% |
| 303 | resource_avg_rel | n/a | 0.00% |
| 404 | population | -39.0 | -11.68% |
| 404 | morale | -0.0021 | -0.24% |
| 404 | beerBoost | +0.0018 | +11.05% |
| 404 | hunger | +0.0051 | +3.29% |
| 404 | thirst | +0.0020 | +1.80% |
| 404 | underDepth | 0.00 | 0.00% |
| 404 | underChamp | 0.00 | n/a |
| 404 | underFail | 0.00 | n/a |
| 404 | underBlocked | 0.00 | 0.00% |
| 404 | underContested | 0.00 | 0.00% |
| 404 | underReadiness | -0.031 | -5.93% |
| 404 | underHeroProm | 0.00 | 0.00% |
| 404 | underHeroLoss | 0.00 | n/a |
| 404 | underHeroAct | 0.00 | 0.00% |
| 404 | underHeroSurv | 0.00 | n/a |
| 404 | beer | -302.8 | -3.74% |
| 404 | food | -41.8 | -10.02% |
| 404 | water | +64.5 | +16.11% |
| 404 | resource_avg_rel | n/a | +0.78% |

