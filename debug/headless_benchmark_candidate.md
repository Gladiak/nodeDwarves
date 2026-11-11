# NodeDwarves Balance Report

Generated: 2026-11-11T18:06:59.505Z
Ticks: 8000
Seeds: 101, 202, 303, 404
Resources: beer, food, water

## Variant Summary

| Variant | Population | Morale | BeerBoost | Hunger | Thirst |
| --- | ---: | ---: | ---: | ---: | ---: |
| candidate | 678.50 | 0.8841 | 0.0193 | 0.1560 | 0.1097 |

## Refinement Measurements

Per-tick averages/floors; travel samples cover completed surface trips. Full counters are in JSON.
Unavailable measurements are explicit nulls; runtime timings are observational, not deterministic.

| Variant / seed | Births | Food floor / avg | Water floor / avg | Idle adults | Saga terminal | Fragmentation | Road steps | Travel mean | Field rebuilds | ticks/s |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| candidate / 101 | 716 | 19.62 / 421.09 | 47.68 / 414.06 | 20.79% | 47.37% | 69.74% | 10.53% | 5.29 | 1160711 | 43.12 |
| candidate / 202 | 737 | 18.75 / 545.56 | 44.72 / 541.83 | 33.67% | 56.90% | 63.79% | 10.59% | 6.31 | 1245698 | 38.78 |
| candidate / 303 | 761 | 39.99 / 510.98 | 37.93 / 641.06 | 16.63% | 46.58% | 63.01% | 9.03% | 4.97 | 1450735 | 29.59 |
| candidate / 404 | 764 | 39.99 / 475.93 | 49.99 / 509.12 | 15.61% | 47.25% | 70.33% | 8.16% | 4.89 | 1537311 | 27.96 |

## Saga Churn Diagnostics

Matches attach events to existing sagas; registry merges are a separate, unsupported operation (measured zero).
Per-seed JSON retains bounded source-backed timelines, match paths, exit reasons/statuses, event counts and lifetimes.

| Variant / seed | Leading opening types | Opening reasons | Match paths | Exit reasons / prior status | Priority ownership |
| --- | --- | --- | --- | --- | ---: |
| candidate / 101 | combat.deep_raid_started: 11, myth.awakened: 11, lifecycle.death: 9, world.limited_opportunities_completed: 9, combat.surface_raid_resolved: 4 | no_shared_evidence: 69, explicit_id_new: 6, no_active_saga: 1 | explicit_id: 323, actor: 47, place: 28, faction: 24, antagonist: 3 | outcome:open: 32, capacity:resolved: 24, capacity:dormant: 15, capacity:open: 13, outcome:active: 4 | 100.00% |
| candidate / 202 | world.limited_opportunities_completed: 14, combat.deep_raid_started: 9, lifecycle.death: 7, myth.awakened: 5, social.grudge_escalation: 4 | no_shared_evidence: 54, explicit_id_new: 3, no_active_saga: 1 | explicit_id: 1762, actor: 48, place: 45, faction: 11, antagonist: 1 | outcome:open: 30, capacity:resolved: 24, capacity:dormant: 9, outcome:active: 3, capacity:failed: 1 | 100.00% |
| candidate / 303 | combat.deep_raid_started: 17, lifecycle.death: 10, myth.awakened: 10, combat.surface_raid_resolved: 5, myth.tradition_formed: 5 | no_shared_evidence: 69, explicit_id_new: 3, no_active_saga: 1 | place: 46, actor: 44, explicit_id: 35, faction: 24, antagonist: 3 | outcome:open: 31, capacity:resolved: 20, capacity:dormant: 15, capacity:open: 13, outcome:active: 3 | 100.00% |
| candidate / 404 | combat.deep_raid_started: 19, lifecycle.death: 11, social.grudge_escalation: 10, myth.awakened: 9, world.limited_opportunities_completed: 7 | no_shared_evidence: 85, explicit_id_new: 5, no_active_saga: 1 | explicit_id: 94, place: 54, actor: 45, faction: 15, antagonist: 2 | outcome:open: 42, capacity:resolved: 26, capacity:open: 22, capacity:dormant: 13, capacity:active: 3 | 100.00% |

## World Legacy Summary

| Variant | Cycles | Last cycle ticks | Records | Memorials | Institutions | Echoes | Nemeses | Modifier | State bytes | Deaths |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| candidate | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.0000 | 224.0 | 78.00 |

## Epic Conflict Summary

| Variant | Nemeses | Siege active | Started | Completed | Hold wins | Nemesis wins | Reconciled | Injuries | Damaged | Restored | Recovery ticks | State bytes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| candidate | 2.50 | 0.00 | 1.75 | 1.75 | 1.75 | 0.00 | 0.00 | 0.00 | 3.50 | 3.50 | 21.75 | 4115.8 |

## Landmark Summary

| Variant | Founded | Completed | Stages built | Damaged | Abandoned | Restored | State bytes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| candidate | 5.00 | 5.00 | 15.00 | 0.75 | 0.00 | 0.75 | 1866.0 |

## Underrealm Summary

| Variant | Depth | Champions | Failed Expeditions | Blocked Dispatches | Frontier Contested | Readiness Score | Hero Prom | Hero Loss | Hero Active | Hero Surv |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| candidate | 2.50 | 1.50 | 0.25 | 6.00 | 0.75 | 0.746 | 4.75 | 0.00 | 1.00 | 0.00 |

## Story Director Summary

| Variant | Considered | Selected | Suppressed | Preempted | Focus coverage | Critical focus | Legendary focus | Priority context | Sagas opened | Resolved | Failed | Archived | Resolution rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| candidate | 12481 | 133 | 12348 | 32 | 1.1% | 82.9% | 29.4% | 100.0% | 298 | 140 | 6 | 202 | 49.0% |

## Schism Decree Usage

| Variant | Issued total | Issued / seed | Active ticks total | Active ticks / seed |
| --- | ---: | ---: | ---: | ---: |
| candidate | 32 | 8.00 | 6400 | 1600.00 |

### Schism Decrees (candidate)

| Decree | Issued | Issued share | Active ticks | Active share |
| --- | ---: | ---: | ---: | ---: |
| granary_compact | 12 | 37.5% | 2400 | 37.5% |
| frontier_levy | 7 | 21.9% | 1400 | 21.9% |
| forge_quota | 6 | 18.8% | 1200 | 18.8% |
| deep_claims | 5 | 15.6% | 1000 | 15.6% |
| hearth_festivity | 2 | 6.3% | 400 | 6.3% |

Profile alignment: the measured configuration already matches production defaults; no source override was applied.
Normalized effective configuration SHA-256: `f61c0051a7922fd7ff2f51c0ceddc5488bfbaae0e3b1f7d6c3342e749125881d`.
Source configuration SHA-256: `cb322d475bccb958b7113cc95af2f671c9c67488316991c5e776927a4b3161ca`.
The unmodified source report and assignments are retained in canonical_road_refinement.json.

Existing non-policy JSON formatting restored; normalized effective configuration remains unchanged.
