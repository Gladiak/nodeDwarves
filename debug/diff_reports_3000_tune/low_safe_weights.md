# Benchmark Report Diff

- baseline report: `/Users/gladiak/ProgettiLavoro/nodeDwarves/benchmark_cache/headless_benchmark_baseline.json`
- candidate report: `/Users/gladiak/ProgettiLavoro/nodeDwarves/debug/candidate_reports_3000_tune/low_safe_weights.json`
- baseline variant: `baseline`
- candidate variant: `low_safe_weights`
- compared seeds: `101,202,303,404`

## Summary Deltas (candidate - baseline)

| metric | abs | rel |
| --- | ---: | ---: |
| population | +17.0 | +6.74% |
| morale | +0.0033 | +0.37% |
| beerBoost | +0.0024 | +13.75% |
| hunger | -0.0005 | -0.31% |
| thirst | -0.0020 | -1.82% |
| underDepth | 0.00 | 0.00% |
| underChamp | 0.00 | n/a |
| underFail | -0.25 | -100.00% |
| underBlocked | +0.25 | +12.50% |
| underContested | 0.00 | 0.00% |
| underReadiness | +0.054 | +10.03% |
| underHeroProm | 0.00 | 0.00% |
| underHeroLoss | 0.00 | n/a |
| underHeroAct | 0.00 | 0.00% |
| underHeroSurv | 0.00 | n/a |
| beer | -561.5 | -6.66% |
| food | +3.7 | +0.94% |
| water | -3.4 | -0.90% |
| resource_avg_rel | n/a | -2.20% |

## Schism Decree Deltas

| metric | abs | rel |
| --- | ---: | ---: |
| decrees_issued_total | -2 | -9.52% |
| decrees_active_ticks_total | -400 | -9.52% |

| decree | issued abs | issued rel | issued share delta | active ticks abs | active ticks rel | active share delta |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| deep_claims | 0 | 0.00% | +1.50pp | 0 | 0.00% | +1.50pp |
| forge_quota | 0 | 0.00% | +1.50pp | 0 | 0.00% | +1.50pp |
| frontier_levy | -1 | -25.00% | -3.26pp | -200 | -25.00% | -3.26pp |
| granary_compact | -1 | -12.50% | -1.25pp | -200 | -12.50% | -1.25pp |
| hearth_festivity | 0 | 0.00% | +1.50pp | 0 | 0.00% | +1.50pp |

## Seed Deltas

| seed | metric | abs | rel |
| ---: | --- | ---: | ---: |
| 101 | population | -7.0 | -2.77% |
| 101 | morale | -0.0045 | -0.51% |
| 101 | beerBoost | +0.0011 | +6.13% |
| 101 | hunger | +0.0112 | +7.42% |
| 101 | thirst | +0.0006 | +0.52% |
| 101 | underDepth | 0.00 | 0.00% |
| 101 | underChamp | 0.00 | n/a |
| 101 | underFail | -1.00 | -100.00% |
| 101 | underBlocked | 0.00 | 0.00% |
| 101 | underContested | 0.00 | 0.00% |
| 101 | underReadiness | -0.057 | -10.24% |
| 101 | underHeroProm | 0.00 | 0.00% |
| 101 | underHeroLoss | 0.00 | n/a |
| 101 | underHeroAct | 0.00 | 0.00% |
| 101 | underHeroSurv | 0.00 | n/a |
| 101 | beer | -2581.5 | -27.19% |
| 101 | food | -63.3 | -15.21% |
| 101 | water | -59.0 | -14.77% |
| 101 | resource_avg_rel | n/a | -19.06% |
| 202 | population | +19.0 | +7.34% |
| 202 | morale | +0.0159 | +1.83% |
| 202 | beerBoost | +0.0065 | +45.49% |
| 202 | hunger | -0.0156 | -9.42% |
| 202 | thirst | -0.0064 | -5.68% |
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
| 202 | beer | +384.3 | +5.31% |
| 202 | food | +3.3 | +0.71% |
| 202 | water | +12.6 | +2.75% |
| 202 | resource_avg_rel | n/a | +2.92% |
| 303 | population | +56.0 | +34.36% |
| 303 | morale | +0.0017 | +0.20% |
| 303 | beerBoost | +0.0019 | +9.16% |
| 303 | hunger | +0.0024 | +1.49% |
| 303 | thirst | -0.0023 | -1.96% |
| 303 | underDepth | 0.00 | 0.00% |
| 303 | underChamp | 0.00 | n/a |
| 303 | underFail | 0.00 | n/a |
| 303 | underBlocked | +1.00 | +50.00% |
| 303 | underContested | 0.00 | 0.00% |
| 303 | underReadiness | +0.271 | +51.86% |
| 303 | underHeroProm | 0.00 | 0.00% |
| 303 | underHeroLoss | 0.00 | n/a |
| 303 | underHeroAct | 0.00 | 0.00% |
| 303 | underHeroSurv | 0.00 | n/a |
| 303 | beer | -48.8 | -0.55% |
| 303 | food | +74.6 | +28.58% |
| 303 | water | +32.7 | +12.26% |
| 303 | resource_avg_rel | n/a | +13.43% |
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

