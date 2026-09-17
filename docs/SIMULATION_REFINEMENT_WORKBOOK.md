# NodeDwarves Simulation Refinement Workbook

Last updated: 2026-09-17
Status: Active
Current milestone: `M0 - Measurement and core contracts`
Current executable step: `R0.1 - Add focused core-simulation contract coverage`
Scope: Ordered implementation, validation, decision, and evidence plan for simulation depth,
system interaction, narrative coherence, spatial behavior, and bounded cross-cycle consequences.

This workbook is the source of truth for the next NodeDwarves implementation cycle. It replaces the
completed living-chronicle delivery plan and starts from the repository state after structured
events, Story Director, Chronicle, world legacy, epic conflicts, and landmarks were delivered.

The goal is not to add unrelated features. The goal is to make existing systems interact more
meaningfully while preserving deterministic comparison, gather-first stability, bounded state,
terminal readability, and compatibility with the current PPO policy contract.

## 0) How to use this workbook

For every implementation cycle:

1. Select the first `Ready` item from the execution queue.
2. Mark it `In progress` before changing code or configuration.
3. Freeze or verify the relevant pre-change evidence.
4. Implement the smallest independently testable slice.
5. Run focused contracts and short deterministic comparisons.
6. Run the required long-horizon and AI gates when the risk matrix requires them.
7. Record commands, measurements, artifacts, decisions, and any remaining risk.
8. Update documentation and project-layout references in the same change set.
9. Mark the item `Done` only when all exit criteria are satisfied.

Status vocabulary:

| Status | Meaning |
| --- | --- |
| `Not started` | Approved scope whose dependencies are not yet complete. |
| `Ready` | Dependencies are complete and implementation may begin. |
| `In progress` | Implementation or required validation is active. |
| `Partial` | Code exists, but validation, documentation, or an exit criterion remains open. |
| `Blocked` | A recorded external or technical blocker prevents meaningful progress. |
| `Done` | Implementation, validation, documentation, and evidence are complete. |
| `Deferred` | Explicitly removed from the active delivery window by a recorded decision. |

Checkboxes describe concrete work. The dashboard status is authoritative if it differs from a
checkbox.

## 1) Product objective

> Make a stable colony develop recognizable habits, relationships, routes, institutions, and
> historical consequences, so that long runs differ for understandable reasons instead of only by
> resource totals or isolated events.

The refinement is successful when:

- social history produces bounded, observable consequences without causing population collapse;
- related events form durable sagas more often than disposable fragments;
- roads influence movement and settlement shape without harming gathering throughput;
- completed cycles can grant small, explainable, decaying institutional effects;
- combat and mining configuration contains no misleading inactive gameplay parameters;
- core economy, population, movement, structure, and raid behavior has dedicated contract coverage;
- every accepted change remains measurable against the cached canonical baseline;
- observation and action shapes remain stable unless an explicit fresh-training decision is made.

## 2) Starting evidence and known gaps

Audit snapshot on 2026-09-17:

- `npm test` passes, including narrative, time-control, Chronicle, world-legacy, epic-conflict,
  landmark, policy-shape, governor, and training-schema contracts.
- Narrative producer audit reports structured producers only and no direct legacy-only producer.
- The retained canonical `4 x 8000` benchmark candidate matches its cached baseline with zero delta.
- Social long-arc runtime, telemetry, governor channels, rewards, and observation channels already
  exist, but `population.socialDrama.longArc.enabled=false` remains the production default.
- The canonical saga review opened `2850` sagas, reached only `140` terminal sagas (`4.9%`), and
  archived or evicted `2754`; saga quality is therefore excluded from Chronicle retention.
- Road-aware field movement exists but is disabled in the production configuration.
- World-legacy institutions store bounded `legacy_resolve` hooks with `applied=false`; they have no
  gameplay or PPO consumer.
- `structures.watchtower.raid.damagePerTick` and `structures.mine.preciousChanceMin|Max` are
  documented placeholders rather than authoritative runtime behavior.
- Contract coverage is strong for recent narrative/epic systems but lacks a dedicated aggregate
  suite for core economy, consumption, population, structures, movement, and surface raids.
- The remaining operational closure outside this workbook is one remote `Training Quality Gates`
  run with uploaded artifacts (`OQ-6.1`).

## 3) Non-negotiable constraints

- Preserve gather-first economy and stockpile-ratio guardrails.
- Keep all new gameplay tuning in `config.json` and document it in `docs/PARAMETERS.md`.
- Do not change PPO observation or action shapes silently.
- Require `--fresh` training if an approved implementation changes either shape.
- Keep state plain-JSON, versioned where persistent, deterministically repairable, and bounded.
- Do not use wall-clock time for simulation decisions.
- Do not introduce unbounded per-dwarf, per-event, per-place, or per-cycle history.
- Do not activate cross-cycle bonuses without decay, a total cap, and multi-cycle stop rules.
- Keep story selection, rendering, and runtime presentation out of gameplay RNG.
- Preserve the cached canonical baseline workflow; do not create ad-hoc baseline copies.
- Split large modules only behind stable wrappers and without unrelated behavior changes.
- Treat seed collapse, negative stockpiles, severe throughput loss, or unexplained AI regression as
  blockers rather than acceptable variance.

## 4) Delivery map

```text
M0 Measurement and core contracts
  -> M1 Long-horizon social consequences
    -> M2 Saga coherence and Chronicle quality
      -> M3 Road-aware movement and spatial behavior
        -> M4 Active inherited institutions
          -> M5 Gameplay-contract cleanup and selective depth
            -> M6 Release validation and documentation closure
```

Some implementation work may be prepared in parallel, but acceptance follows this order. In
particular, active legacy modifiers must not begin before social and saga behavior have stable
measurement, because all three affect long-run interpretation.

## 5) Progress dashboard

| ID | Workstream | Status | Depends on | Main outcome |
| --- | --- | --- | --- | --- |
| `R0.1` | Core simulation contract suite | `Ready` | none | Deterministic economy/population/movement/raid safety net |
| `R0.2` | Refinement metric baseline | `Not started` | `R0.1` | Frozen pre-change social, saga, traffic, and legacy measurements |
| `R0.3` | Risk-to-validation matrix | `Not started` | `R0.2` | Explicit gate level for every later workstream |
| `S1.1` | Long-arc deterministic fixtures | `Not started` | `R0.1` | Exact memory, drift, mood, and serialization contracts |
| `S1.2` | Long-arc config A/B | `Not started` | `R0.2`, `S1.1` | Conservative candidate with measured balance envelope |
| `S1.3` | Production long-arc rollout | `Not started` | `S1.2` | Enabled bounded social memory with AI non-regression |
| `N2.1` | Saga churn diagnostic | `Not started` | `R0.2` | Cause-level report for opening, merging, closure, archive, eviction |
| `N2.2` | Saga grouping and lifecycle tuning | `Not started` | `N2.1` | Fewer false fragments and more fact-backed terminal arcs |
| `N2.3` | Chronicle saga-quality decision | `Not started` | `N2.2` | Evidence-based retain/continue-disabled decision |
| `P3.1` | Road-affinity movement fixtures | `Not started` | `R0.1` | Deterministic route-choice and fallback contracts |
| `P3.2` | Road-affinity performance/balance A/B | `Not started` | `P3.1` | Traffic improvement without throughput or CPU regression |
| `P3.3` | Production road-affinity rollout | `Not started` | `P3.2` | Roads affect everyday travel with bounded cache behavior |
| `L4.1` | Institution effect contract | `Not started` | `S1.3`, `N2.3` | Typed, source-backed, capped, decaying legacy effects |
| `L4.2` | Institution runtime integration | `Not started` | `L4.1` | One explainable active inherited institution path |
| `L4.3` | Multi-cycle legacy validation | `Not started` | `L4.2` | Stable 2/5/10-cycle behavior and policy compatibility |
| `G5.1` | Watchtower contract decision | `Not started` | `R0.1` | Implement damage/HP or remove misleading parameter |
| `G5.2` | Mine precious-drop contract decision | `Not started` | `R0.1` | Unify with `rareDrops` or remove obsolete placeholders |
| `T5.3` | Opportunistic module boundaries | `Not started` | relevant feature | Smaller thematic modules behind stable APIs |
| `V6.1` | Full release validation | `Not started` | all accepted slices | Green local, canonical, regression, runtime, and docs gates |

## 6) M0 - Measurement and core contracts

### R0.1 - Core simulation contract suite

Objective: protect the stable economy before enabling systems that alter mood, travel, defense, or
cross-cycle modifiers.

Primary implementation:

- Add `scripts/test_core_simulation_contracts.js`.
- Add `npm run test:core-simulation` and include it in `npm test`.
- Prefer small deterministic fixtures over long stochastic integration runs.

Required coverage:

- [ ] Stockpile operations never produce negative or non-finite values.
- [ ] Shortages raise gather demand before optional structure spending.
- [ ] Structure build gates use ratios and respect costs/capacity/queue limits.
- [ ] Consumption changes needs and stockpiles within configured bounds.
- [ ] Reproduction gates and population lifecycle remain deterministic under a fixed seed.
- [ ] Field pathing always returns a walkable bounded step or a safe stay fallback.
- [ ] Road-affinity disabled mode preserves the current route decision contract.
- [ ] Surface raid start/tick/end transitions remain bounded.
- [ ] Watchtower range, hit chance extremes, defense cap, and kill cap are executable contracts.
- [ ] Serialization round trips retain the tested core state without non-finite values.
- [ ] Test fixtures do not alter global config or leak RNG state between cases.

Exit criteria:

- Focused suite passes twice with identical results.
- Aggregate `npm test` remains green.
- No production balance value changes in this step.
- README, MANUAL, AGENTS, and project layout are updated if a file is added.

### R0.2 - Refinement metric baseline

Objective: freeze the measurements needed to judge later changes.

Metrics to capture per seed and in aggregate:

| Domain | Required metrics |
| --- | --- |
| Economy | population, births, deaths, food/water/beer floor and average, idle-adult ratio |
| Social | cohesion, conflict pressure, mentorship coverage, grudge load, support, burden, harmony, strife, incident counts |
| Narrative | sagas opened/merged/resolved/failed/archived/evicted, terminal rate, fragmentation rate, events per saga |
| Movement | mean target distance, mean travel ticks, road-step share, failed/stay steps, path-cache rebuilds |
| Legacy | record counts, active modifier count/magnitude, serialized bytes, evictions |
| Runtime | tick throughput, pathing cost, render mean/p95 where presentation changes |

Implementation checklist:

- [ ] Extend headless summaries only with deterministic read-only counters.
- [ ] Define missing/disabled placeholders explicitly rather than omitting fields.
- [ ] Record the canonical `4 x 8000` baseline metadata and current config hash.
- [ ] Retain a compact Markdown/JSON report under the existing artifact policy.
- [ ] Document interpretation and failure thresholds before candidate tuning.

### R0.3 - Risk-to-validation matrix

| Change class | Minimum validation |
| --- | --- |
| Tests/docs/refactor only | focused test, `npm test`, `git diff --check` |
| Presentation/read-only telemetry | focused test, `npm test`, short parity, runtime smoke |
| Config change affecting gameplay | focused test, repeated short A/B, canonical candidate/diff, relevant regression |
| Social/movement runtime behavior | dedicated contracts, multi-seed A/B, canonical benchmark, standard/governance regression |
| Combat/Underrealm interaction | dedicated contracts, canonical benchmark, Underrealm + horizon profiles |
| Cross-cycle modifier | dedicated contracts, 2/5/10-cycle validator, canonical benchmark, all regression profiles |
| Observation/action shape change | policy contract, explicit decision, `--fresh` training, complete acceptance gate |

## 7) M1 - Long-horizon social consequences

### S1.1 - Deterministic long-arc fixtures

Objective: prove the existing disabled runtime before tuning it.

Required scenarios:

- [ ] Stable friendship and mentorship accumulate support within bounds.
- [ ] Rivalry and grudges accumulate burden within bounds.
- [ ] Positive incidents produce one bounded support shock.
- [ ] Negative incidents produce one bounded burden shock.
- [ ] Memory decays when relationships disappear.
- [ ] Support and burden modify morale/stress/fatigue with configured signs and caps.
- [ ] Settlement harmony and strife drift slowly and remain within `[0, 1]`.
- [ ] Disabled mode resets/holds long-arc aggregates exactly as documented.
- [ ] Save/load and cycle transition do not duplicate shocks or retain invalid actor references.
- [ ] Social governor intent changes incident posture without directly rewriting relationships.

### S1.2 - Long-arc config A/B

Candidate strategy:

- Start at or below current configured effect scales.
- Tune memory first, mood consequences second, incident shocks last.
- Prefer slow, readable accumulation over large event spikes.
- Keep positive and negative paths asymmetric only when measured recovery requires it.

Acceptance signals:

- No collapsed seed in the canonical profile.
- No material reduction in food/water floors.
- Deaths and births remain inside predeclared regression budgets.
- Harmony and strife both activate across the seed set; neither remains permanently saturated.
- Social governor actions remain observable and non-degenerate.
- Existing policy loads with unchanged observation/action shapes.

Stop rules:

- Any non-finite mood or memory value.
- Persistent harmony or strife saturation above `0.95` for most of a run.
- Material mortality increase without a compensating, documented gameplay goal.
- Feedback loop where burden increases incidents faster than configured recovery can resolve them.
- Candidate requires broad unrelated economy retuning.

### S1.3 - Production rollout

- [ ] Enable `population.socialDrama.longArc.enabled` only after A/B acceptance.
- [ ] Update Social telemetry and its reference panel if metric meaning changes.
- [ ] Add player-facing high-level README note.
- [ ] Document formulas and operational diagnosis in MANUAL.
- [ ] Update PARAMETERS for every new or changed knob.
- [ ] Run canonical benchmark, standard/governance regressions, policy-only contract, and runtime smoke.
- [ ] Refresh the cached baseline only after the candidate is accepted.

## 8) M2 - Saga coherence and Chronicle quality

### N2.1 - Saga churn diagnostic

Objective: distinguish legitimate short incidents from false fragmentation.

Add deterministic reporting for:

- opening reason and source event family;
- match path: explicit saga ID, parent cause, actor, place, antagonist, or retained evidence;
- merge count and merge reason;
- event count and lifetime at terminal/archive/eviction;
- status before eviction;
- capacity versus age/cooldown eviction;
- sampled fact-backed timelines for a bounded number of sagas.

Do not tune until the report can answer whether churn is caused by overly broad opening, weak
matching, insufficient capacity, or missing lifecycle transitions.

### N2.2 - Grouping and lifecycle tuning

Implementation order:

1. Prevent low-value ambient/notable events from opening standalone sagas unless explicitly typed.
2. Improve deterministic matches using shared nemesis, stable place, involved actor, and causal IDs.
3. Add a bounded dormant window before archival when a saga has meaningful unresolved evidence.
4. Close resolved/failed sagas from authoritative outcome events rather than inactivity alone.
5. Revisit capacity only after opening and matching behavior is correct.

Quality targets are relative to the frozen baseline and must be fixed in `N2.1`. Initial direction:

- increase terminal/opened rate materially;
- reduce one-event saga share and eviction/opened ratio;
- preserve critical/legendary event ownership;
- avoid broad actor-only merges that create false mega-sagas;
- keep state size and per-event update time within current hard caps.

### N2.3 - Chronicle retention decision

`chronicle.saga_quality.use_for_retention` may be enabled only when:

- terminal and fragmentation metrics meet the accepted targets;
- sampled sagas show coherent facts rather than accidental shared actors;
- Chronicle claim density and chapter balance do not regress;
- all retained claims remain source-resolvable;
- bounded-state and equal-export-hash contracts pass.

Otherwise record a deliberate decision to keep it disabled. Improving watchability is valuable even
if saga membership never becomes a retention signal.

## 9) M3 - Road-aware movement and spatial behavior

### P3.1 - Route-choice contracts

- [ ] With affinity disabled, preserve current deterministic candidate scoring.
- [ ] Long trips prefer a reasonable road route when total cost is competitive.
- [ ] Short trips ignore road detours below `minTargetDistance`.
- [ ] Dwarves may leave roads to reach jobs, homes, resources, and emergencies.
- [ ] Bridges and fords count as road continuity.
- [ ] No-road maps fall back without rebuilding useless distance maps.
- [ ] Dynamic road construction invalidates caches deterministically.
- [ ] Crowding, terrain, inertia, and road costs remain bounded and composable.

### P3.2 - Performance and balance A/B

Compare disabled, `pragmatic`, and `scenic` profiles.

Required measurements:

- road-step share for trips above the distance threshold;
- mean/p95 travel ticks by job family;
- gather and construction throughput;
- stay/fallback rate;
- potential-field and road-distance cache rebuild counts;
- tick throughput at canonical population scale;
- settlement stockpile and mortality deltas.

Acceptance guidance:

- Prefer `pragmatic` for production unless `scenic` has equivalent throughput.
- Reject visually pleasing routes that materially delay critical gathering.
- Avoid increasing radius or cache lifetime solely to hide performance problems.

### P3.3 - Production rollout

- [ ] Enable the accepted profile in `config.json`.
- [ ] Expose only compact operational traffic metrics; do not overcrowd the main HUD.
- [ ] Verify small maps, no-road starts, multi-village layouts, and Underrealm isolation.
- [ ] Run pathing probe, movement batch, canonical benchmark, and relevant regressions.

## 10) M4 - Active inherited institutions

### L4.1 - Effect contract

Objective: make completed cycles matter without creating compounding runaway bonuses.

Contract requirements:

- Every institution effect is derived from verified Chronicle evidence.
- Effects use typed IDs rather than free-form labels.
- The record retains source cycle and source event/chapter references.
- At most one new active institution is admitted per completed cycle initially.
- Per-institution magnitude starts at no more than `0.02` unless evidence approves more.
- Aggregate active magnitude starts at no more than `0.05`, below the existing hard ceiling.
- Effects decay by cycle age and never stack linearly without the global cap.
- Unsupported or unknown effect types remain stored but inactive.
- Application is idempotent across serialization and cycle transition.
- Telemetry explains source, target system, raw magnitude, decayed magnitude, and cap contribution.

Initial effect candidates:

| Institution | Evidence requirement | Candidate bounded effect |
| --- | --- | --- |
| Miners' tradition | mining/Underrealm Chronicle evidence | small mine or rare-drop efficiency bonus |
| Wardens' order | raid/siege defense evidence | small defense or recovery bonus |
| Hearth compact | social/recovery evidence | small negative-stress recovery bonus |
| Builders' guild | landmark/settlement evidence | small construction-time reduction |
| Caravan charter | trade/contract evidence | small reputation or trade-efficiency bonus |

Do not introduce all candidates in the first slice. Implement one end-to-end effect, validate the
contract, and expand only when the consumer boundary is stable.

### L4.2 - Runtime integration

- [ ] Add a single resolver that returns capped effective modifiers by type.
- [ ] Keep record construction separate from gameplay consumption.
- [ ] Apply modifiers at one explicit consumer boundary per system.
- [ ] Prevent effects from mutating historical records.
- [ ] Include current effective modifiers in headless reports.
- [ ] Add structured activation/expiry events only if they improve player understanding.
- [ ] Preserve old saves with `applied=false` migration semantics.

### L4.3 - Multi-cycle validation

Required deterministic profiles:

- two cycles: first creation and first application;
- five cycles: decay, cap, retention, and eviction behavior;
- ten cycles: long-horizon compounding and serialized-size sentinel;
- empty/low-evidence cycle: no invented institution;
- unknown legacy effect: stored safely, gameplay inactive;
- repeated same-type evidence: cap and decay remain authoritative.

Stop rules:

- population collapse attributable to legacy bonuses or their balancing response;
- any modifier total above its configured cap;
- active magnitude increasing monotonically only because cycle count increases;
- stale source references or non-idempotent application;
- policy observation/action shape drift without an approved training plan;
- legacy state above its existing bounded-state threshold.

## 11) M5 - Gameplay-contract cleanup and selective depth

### G5.1 - Watchtower damage contract

Current mismatch: watchtowers kill a targeted beast on a successful hit while `damagePerTick` is a
reserved parameter.

Decision options:

1. Preferred minimal option: remove/deprecate `damagePerTick` and document hit-as-kill behavior.
2. Depth option: add bounded beast HP and make damage authoritative.

Choose option 2 only if it also improves decisions or storytelling. If selected:

- add HP to raid-beast state with deterministic initialization;
- cap damage and targets per tick;
- preserve `maxKillsPerTick` as a hard safety limit;
- render injury only if readable without map noise;
- test migration, serialization, kill attribution, tower scaling, and raid duration;
- rerun surface, governance, Underrealm-overlap, and epic-conflict validation.

### G5.2 - Mine precious-drop contract

Current mismatch: `rareDrops` is authoritative while `preciousChanceMin|Max` is unused.

Preferred resolution:

- remove obsolete fields if no distinct mechanic is required; or
- replace them with one documented level-scaling function consumed by every configured rare drop.

Do not add a second independent random reward path. Any accepted change must preserve resource
caps, rarity ordering, clan modifiers, deterministic seeded comparison, and training overrides.

### T5.3 - Opportunistic module boundaries

Split only the module touched by an accepted feature:

- `warriors.js`: governor, tournaments, progression, legacy, and event integration boundaries;
- `underrealm.js`: crew/governor, economy, combat, shrines, and exploration boundaries;
- `structures.js`: placement, construction, upgrades, and structure-specific managers;
- `telemetry.js`: domain section builders behind the existing telemetry API.

Refactor rules:

- stable wrapper exports;
- no circular dependencies;
- behavior-parity tests before moving logic;
- one thematic extraction per reviewable change;
- no config retuning in a pure refactor commit;
- exact deterministic endpoint parity where behavior is claimed unchanged.

## 12) M6 - Release validation and closure

### V6.1 - Required final gates

- [ ] All accepted focused contract suites pass.
- [ ] `npm test` passes.
- [ ] `npm run audit:narrative-producers` reports zero direct legacy producers.
- [ ] Canonical `4 x 8000` candidate completes with no collapsed seed.
- [ ] Candidate diff is reviewed against the cached baseline.
- [ ] Standard, Underrealm, governance, and horizon profiles required by the risk matrix pass.
- [ ] Policy-only shape and load compatibility pass.
- [ ] Runtime terminal smoke covers supported full and narrow widths.
- [ ] Resize, modal, export-map, and Chronicle export smoke checks pass when affected.
- [ ] No negative/non-finite stockpile, mood, memory, or modifier value appears.
- [ ] Debug artifacts follow retention policy and all documentation links resolve.
- [ ] README, MANUAL, PARAMETERS, TRAINING_OVERRIDES, TRAINING_STATUS, TELEMETRY, AGENTS, and this
      workbook are updated where applicable.
- [ ] `git diff --check` passes.

## 13) Validation commands

Fast contract tier:

```bash
node --check <changed-js-file>
npm run test:core-simulation
npm test
git diff --check
```

Canonical balance tier:

```bash
npm run bench:ensure-baseline
npm run bench:candidate -- --set path=value
npm run bench:diff
```

AI and long-horizon tier:

```bash
node scripts/test_training_contracts.js --policy-only
npm run ai:validate
npm run ai:validate:weekly
```

Artifact cleanup:

```bash
npm run debug:clean -- --dry-run
npm run debug:clean
```

Commands are examples, not substitutes for the risk matrix. Do not refresh the cached baseline until
the candidate is accepted and the previous baseline metadata has been retained in the implementation
log.

## 14) Risk register

| ID | Risk | Likelihood | Impact | Mitigation | Status |
| --- | --- | --- | --- | --- | --- |
| `RR-001` | Social burden creates a self-reinforcing collapse loop | Medium | High | Conservative scales, recovery fixtures, multi-seed mortality/stock gates | Open |
| `RR-002` | Social benefits erase meaningful shortages | Low | Medium | Resource-floor comparison and capped mood effects | Open |
| `RR-003` | Saga tuning merges unrelated events into mega-sagas | Medium | High | Cause/place/antagonist evidence, bounded samples, actor-only merge restrictions | Open |
| `RR-004` | Saga capacity tuning hides a matching defect | Medium | Medium | Diagnose open/merge/close causes before changing caps | Open |
| `RR-005` | Road preference reduces gather throughput | Medium | High | Pragmatic profile, short-trip bypass, travel/stock A/B | Open |
| `RR-006` | Road-distance maps become a per-tick hotspot | Medium | Medium | Cache counters, invalidation contracts, tick-throughput thresholds | Open |
| `RR-007` | Legacy modifiers compound across cycles | Medium | Critical | Decay, total cap, one initial effect, 2/5/10-cycle stop rules | Open |
| `RR-008` | Policy cannot react to a new hidden modifier | Medium | High | Small magnitudes, existing observable outcomes, policy regression, explicit shape decision | Open |
| `RR-009` | Combat depth increases crisis overlap mortality | Medium | High | Prefer parameter removal; dedicated overlap and collapse validation if HP is added | Open |
| `RR-010` | Refactoring large modules changes ordering/RNG | Medium | High | Stable wrappers, parity fixtures, no tuning during extraction | Open |
| `RR-011` | New telemetry makes terminal views unreadable | Low | Medium | Compact rows, reference-panel update, narrow-width smoke | Open |
| `RR-012` | Validation artifacts become noisy or stale | Medium | Medium | Canonical paths, cleanup policy, workbook evidence links | Open |

## 15) Decision log

| Date | ID | Decision | Alternatives | Rationale | Status |
| --- | --- | --- | --- | --- | --- |
| 2026-09-17 | `RD-001` | Start a new refinement workbook after the completed E0-E8 delivery | Continue appending to the completed workbook | Keeps historical delivery separate from new scope and restores a clear executable queue | Approved |
| 2026-09-17 | `RD-002` | Prioritize interaction quality over new standalone feature count | Add another major isolated system first | Existing social, saga, road, and legacy hooks already contain the highest-value unfinished depth | Approved |
| 2026-09-17 | `RD-003` | Add core-simulation contracts before enabling gameplay-affecting hooks | Rely only on canonical benchmark and recent subsystem tests | Faster deterministic failure localization is required for safe tuning | Approved |
| 2026-09-17 | `RD-004` | Validate social memory before active legacy modifiers | Activate cross-cycle bonuses immediately | Avoids overlapping long-horizon behavior changes and makes causality measurable | Approved |
| 2026-09-17 | `RD-005` | Diagnose saga churn before increasing saga capacity | Raise caps first | Current evidence cannot distinguish capacity pressure from weak matching or lifecycle rules | Approved |

## 16) Implementation log

Add one row per completed or materially attempted slice.

| Date | Step | Files | Validation | Result | Artifacts | Next action |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-09-17 | Workbook initialization | `docs/SIMULATION_REFINEMENT_WORKBOOK.md`, documentation references | `npm test`, link/reference audit, `git diff --check` | Plan initialized from a green local contract baseline | none | Start `R0.1` |
| 2026-09-17 | Repository cleanup | obsolete tracked A/B reports, retired epic evidence, unused screenshots, ignored regression temporaries | reference audit, `npm run debug:clean`, `npm test`, `git diff --check` | Removed stale artifacts while retaining canonical/latest reports, three training runs, active docs, models, and operational tooling | none | Start `R0.1` |

Detailed entry template:

```text
Step:
Status:
Scope completed:
Files changed:
Configuration changed:
Observation/action contract:
Focused validation:
Short deterministic comparison:
Canonical/regression validation:
Measured result versus baseline:
Artifacts retained:
Risks opened/closed:
Decision-log updates:
Next executable step:
```

## 17) Definition of Done

A step is Done only when:

- [ ] Scope and dependencies are satisfied.
- [ ] Config parameters and defaults are documented.
- [ ] Focused deterministic tests cover success, disabled mode, bounds, and serialization where relevant.
- [ ] Relevant telemetry is readable and its reference panel remains coherent.
- [ ] Required short and long validation tiers pass.
- [ ] AI policy compatibility is explicitly classified.
- [ ] State growth, performance, and determinism are measured where relevant.
- [ ] README and MANUAL describe player-facing and operational behavior at the right level.
- [ ] AGENTS, README, and MANUAL project layouts match all file changes.
- [ ] Debug artifacts are cleaned and retained evidence paths resolve.
- [ ] Implementation, decision, risk, dashboard, and queue entries are current.
- [ ] `git diff --check` passes.

A milestone is Done only when all included steps are Done and no open High/Critical risk lacks a
tested mitigation.

## 18) Next execution queue

Execute one bounded step at a time:

1. [ ] `R0.1` - Add focused core-simulation contracts without changing production balance.
2. [ ] `R0.2` - Freeze social, saga, traffic, economy, runtime, and legacy baseline metrics.
3. [ ] `R0.3` - Finalize numeric acceptance thresholds and validation tiers.
4. [ ] `S1.1` - Add deterministic long-arc fixtures.
5. [ ] `S1.2` - Run conservative disabled/enabled multi-seed A/B tuning.
6. [ ] `S1.3` - Enable long-arc production defaults only if acceptance gates pass.
7. [ ] `N2.1` - Add cause-level saga churn diagnostics and samples.
8. [ ] `N2.2` - Tune saga opening, matching, lifecycle, and eviction in that order.
9. [ ] `N2.3` - Decide whether saga quality may influence Chronicle retention.
10. [ ] `P3.1` - Add deterministic road-affinity route fixtures.
11. [ ] `P3.2` - Compare disabled, pragmatic, and scenic profiles.
12. [ ] `P3.3` - Roll out the accepted road-affinity profile.
13. [ ] `L4.1` - Define the typed inherited-institution effect contract.
14. [ ] `L4.2` - Implement one source-backed active institution effect end to end.
15. [ ] `L4.3` - Run 2/5/10-cycle legacy stability validation.
16. [ ] `G5.1` - Decide and implement watchtower damage parameter behavior.
17. [ ] `G5.2` - Remove or unify mine precious-drop placeholders.
18. [ ] `T5.3` - Extract thematic module boundaries only where touched work justifies it.
19. [ ] `V6.1` - Run final release gates, documentation review, and artifact cleanup.
