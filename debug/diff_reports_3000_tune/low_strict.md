# Benchmark Report Diff

- baseline report: `/Users/gladiak/ProgettiLavoro/nodeDwarves/benchmark_cache/headless_benchmark_baseline.json`
- candidate report: `/Users/gladiak/ProgettiLavoro/nodeDwarves/debug/candidate_reports_3000_tune/low_strict.json`
- baseline variant: `baseline`
- candidate variant: `low_strict`
- compared seeds: `101,202,303,404`

## Summary Deltas (candidate - baseline)

| metric | abs | rel |
| --- | ---: | ---: |
| population | -4.5 | -1.78% |
| morale | +0.0002 | +0.02% |
| beerBoost | +0.0020 | +11.25% |
| hunger | +0.0013 | +0.81% |
| thirst | +0.0008 | +0.74% |
| underDepth | 0.00 | 0.00% |
| underChamp | 0.00 | n/a |
| underFail | -0.25 | -100.00% |
| underBlocked | +0.25 | +12.50% |
| underContested | 0.00 | 0.00% |
| underReadiness | +0.057 | +10.76% |
| underHeroProm | 0.00 | 0.00% |
| underHeroLoss | 0.00 | n/a |
| underHeroAct | 0.00 | 0.00% |
| underHeroSurv | 0.00 | n/a |
| beer | +183.6 | +2.18% |
| food | -10.9 | -2.81% |
| water | -23.1 | -6.06% |
| resource_avg_rel | n/a | -2.23% |

## Schism Decree Deltas

| metric | abs | rel |
| --- | ---: | ---: |
| decrees_issued_total | -5 | -23.81% |
| decrees_active_ticks_total | -1000 | -23.81% |

| decree | issued abs | issued rel | issued share delta | active ticks abs | active ticks rel | active share delta |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| deep_claims | -1 | -33.33% | -1.79pp | -200 | -33.33% | -1.79pp |
| forge_quota | -1 | -33.33% | -1.79pp | -200 | -33.33% | -1.79pp |
| frontier_levy | -2 | -50.00% | -6.55pp | -400 | -50.00% | -6.55pp |
| granary_compact | -1 | -12.50% | +5.65pp | -200 | -12.50% | +5.65pp |
| hearth_festivity | 0 | 0.00% | +4.46pp | 0 | 0.00% | +4.46pp |

## Seed Deltas

| seed | metric | abs | rel |
| ---: | --- | ---: | ---: |
| 101 | population | +15.0 | +5.93% |
| 101 | morale | -0.0049 | -0.56% |
| 101 | beerBoost | +0.0005 | +2.80% |
| 101 | hunger | +0.0088 | +5.80% |
| 101 | thirst | +0.0016 | +1.54% |
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
| 101 | beer | +310.1 | +3.27% |
| 101 | food | -57.4 | -13.80% |
| 101 | water | -39.7 | -9.92% |
| 101 | resource_avg_rel | n/a | -6.82% |
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
| 404 | population | -108.0 | -32.34% |
| 404 | morale | -0.0119 | -1.35% |
| 404 | beerBoost | -0.0012 | -7.05% |
| 404 | hunger | +0.0096 | +6.24% |
| 404 | thirst | +0.0103 | +9.35% |
| 404 | underDepth | 0.00 | 0.00% |
| 404 | underChamp | 0.00 | n/a |
| 404 | underFail | 0.00 | n/a |
| 404 | underBlocked | 0.00 | 0.00% |
| 404 | underContested | 0.00 | 0.00% |
| 404 | underReadiness | -0.016 | -2.98% |
| 404 | underHeroProm | 0.00 | 0.00% |
| 404 | underHeroLoss | 0.00 | n/a |
| 404 | underHeroAct | 0.00 | 0.00% |
| 404 | underHeroSurv | 0.00 | n/a |
| 404 | beer | +88.9 | +1.10% |
| 404 | food | -64.1 | -15.37% |
| 404 | water | -98.2 | -24.53% |
| 404 | resource_avg_rel | n/a | -12.94% |

