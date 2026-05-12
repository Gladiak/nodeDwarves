# Benchmark Report Diff

- baseline report: `/Users/gladiak/ProgettiLavoro/nodeDwarves/benchmark_cache/headless_benchmark_baseline.json`
- candidate report: `/Users/gladiak/ProgettiLavoro/nodeDwarves/debug/candidate_reports_8000/low_base_8000.json`
- baseline variant: `baseline`
- candidate variant: `low_base_8000`
- compared seeds: `101,202,303,404`

## Summary Deltas (candidate - baseline)

| metric | abs | rel |
| --- | ---: | ---: |
| population | +0.3 | +0.04% |
| morale | +0.0006 | +0.06% |
| beerBoost | +0.0015 | +7.04% |
| hunger | +0.0032 | +2.03% |
| thirst | -0.0012 | -1.10% |
| underDepth | +0.50 | +28.57% |
| underChamp | +0.50 | +66.67% |
| underFail | +0.50 | +200.00% |
| underBlocked | -0.25 | -7.14% |
| underContested | 0.00 | 0.00% |
| underReadiness | -0.007 | -0.84% |
| underHeroProm | -1.00 | -13.79% |
| underHeroLoss | 0.00 | n/a |
| underHeroAct | 0.00 | 0.00% |
| underHeroSurv | +0.25 | +100.00% |
| beer | +557.5 | +1.29% |
| food | -29.4 | -3.58% |
| water | +83.6 | +10.40% |
| resource_avg_rel | n/a | +2.70% |

## Schism Decree Deltas

| metric | abs | rel |
| --- | ---: | ---: |
| decrees_issued_total | +6 | +10.17% |
| decrees_active_ticks_total | +1200 | +10.17% |

| decree | issued abs | issued rel | issued share delta | active ticks abs | active ticks rel | active share delta |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| deep_claims | +2 | +22.22% | +1.67pp | +400 | +22.22% | +1.67pp |
| forge_quota | +1 | +10.00% | -0.03pp | +200 | +10.00% | -0.03pp |
| frontier_levy | +1 | +6.67% | -0.81pp | +200 | +6.67% | -0.81pp |
| granary_compact | +2 | +9.09% | -0.37pp | +400 | +9.09% | -0.37pp |
| hearth_festivity | 0 | 0.00% | -0.47pp | 0 | 0.00% | -0.47pp |

## Seed Deltas

| seed | metric | abs | rel |
| ---: | --- | ---: | ---: |
| 101 | population | 0.0 | 0.00% |
| 101 | morale | 0.0000 | 0.00% |
| 101 | beerBoost | 0.0000 | 0.00% |
| 101 | hunger | 0.0000 | 0.00% |
| 101 | thirst | 0.0000 | 0.00% |
| 101 | underDepth | 0.00 | 0.00% |
| 101 | underChamp | 0.00 | n/a |
| 101 | underFail | 0.00 | 0.00% |
| 101 | underBlocked | 0.00 | 0.00% |
| 101 | underContested | 0.00 | 0.00% |
| 101 | underReadiness | 0.000 | 0.00% |
| 101 | underHeroProm | 0.00 | 0.00% |
| 101 | underHeroLoss | 0.00 | n/a |
| 101 | underHeroAct | 0.00 | 0.00% |
| 101 | underHeroSurv | 0.00 | n/a |
| 101 | beer | 0.0 | 0.00% |
| 101 | food | 0.0 | 0.00% |
| 101 | water | 0.0 | 0.00% |
| 101 | resource_avg_rel | n/a | 0.00% |
| 202 | population | -6.0 | -0.87% |
| 202 | morale | +0.0077 | +0.88% |
| 202 | beerBoost | +0.0065 | +44.66% |
| 202 | hunger | +0.0064 | +4.22% |
| 202 | thirst | -0.0107 | -9.07% |
| 202 | underDepth | +1.00 | +33.33% |
| 202 | underChamp | +1.00 | +50.00% |
| 202 | underFail | 0.00 | n/a |
| 202 | underBlocked | 0.00 | 0.00% |
| 202 | underContested | 0.00 | n/a |
| 202 | underReadiness | -0.140 | -13.96% |
| 202 | underHeroProm | -4.00 | -44.44% |
| 202 | underHeroLoss | 0.00 | n/a |
| 202 | underHeroAct | 0.00 | 0.00% |
| 202 | underHeroSurv | 0.00 | 0.00% |
| 202 | beer | -10079.5 | -21.56% |
| 202 | food | -129.2 | -13.37% |
| 202 | water | +278.2 | +33.90% |
| 202 | resource_avg_rel | n/a | -0.34% |
| 303 | population | +7.0 | +1.02% |
| 303 | morale | -0.0055 | -0.61% |
| 303 | beerBoost | -0.0006 | -2.65% |
| 303 | hunger | +0.0064 | +4.13% |
| 303 | thirst | +0.0061 | +6.09% |
| 303 | underDepth | +1.00 | +50.00% |
| 303 | underChamp | +1.00 | +100.00% |
| 303 | underFail | +2.00 | n/a |
| 303 | underBlocked | -1.00 | -20.00% |
| 303 | underContested | 0.00 | 0.00% |
| 303 | underReadiness | +0.112 | +12.65% |
| 303 | underHeroProm | 0.00 | 0.00% |
| 303 | underHeroLoss | 0.00 | n/a |
| 303 | underHeroAct | 0.00 | 0.00% |
| 303 | underHeroSurv | +1.00 | n/a |
| 303 | beer | +12309.5 | +33.18% |
| 303 | food | +11.6 | +1.52% |
| 303 | water | +56.2 | +7.43% |
| 303 | resource_avg_rel | n/a | +14.04% |
| 404 | population | 0.0 | 0.00% |
| 404 | morale | 0.0000 | 0.00% |
| 404 | beerBoost | 0.0000 | 0.00% |
| 404 | hunger | 0.0000 | 0.00% |
| 404 | thirst | 0.0000 | 0.00% |
| 404 | underDepth | 0.00 | 0.00% |
| 404 | underChamp | 0.00 | n/a |
| 404 | underFail | 0.00 | n/a |
| 404 | underBlocked | 0.00 | 0.00% |
| 404 | underContested | 0.00 | 0.00% |
| 404 | underReadiness | 0.000 | 0.00% |
| 404 | underHeroProm | 0.00 | 0.00% |
| 404 | underHeroLoss | 0.00 | n/a |
| 404 | underHeroAct | 0.00 | 0.00% |
| 404 | underHeroSurv | 0.00 | n/a |
| 404 | beer | 0.0 | 0.00% |
| 404 | food | 0.0 | 0.00% |
| 404 | water | 0.0 | 0.00% |
| 404 | resource_avg_rel | n/a | 0.00% |

