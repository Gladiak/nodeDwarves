# NodeDwarves Epic Evolution Workbook

Last updated: 2026-07-16  
Status: Active planning baseline  
Scope: Step-by-step delivery and evidence tracking for the project-wide epic simulation evolution

This workbook turns the "living dwarven chronicle" direction into an executable plan. It is the
source of truth for scope, ordering, progress, decisions, risks, validation evidence, and closure
criteria across narrative, rendering, persistent world memory, and large-scale spectacle.

The goal is not to increase the raw feature count. The goal is to make the systems already present
produce readable, memorable, and persistent stories while preserving simulation stability,
determinism, AI compatibility, and terminal identity.

## 0) How to use this workbook

Update this file during every Epic Evolution implementation cycle:

1. Select the first unblocked item from the execution queue.
2. Change its status to `In progress` before implementation.
3. Record decisions that alter schema, scope, ordering, or player experience.
4. Run the workstream-specific checks and the global validation tier required by the change.
5. Add one implementation-log row with commands, artifacts, and measured results.
6. Mark an item `Done` only when its exit criteria and documentation updates are complete.
7. Update the dashboard, risk register, and next execution queue before closing the cycle.

Status vocabulary:

| Status | Meaning |
| --- | --- |
| `Existing` | Capability was already present before this workbook and can be reused. |
| `Not started` | Approved scope with no implementation work recorded. |
| `Ready` | Dependencies are satisfied and the step can start. |
| `In progress` | Implementation or validation is actively open. |
| `Blocked` | A recorded blocker prevents meaningful progress. |
| `Partial` | Code exists, but validation, docs, or an exit criterion is still open. |
| `Done` | Implementation, validation evidence, and documentation are complete. |
| `Deferred` | Explicitly removed from the current delivery window by decision log. |

Checkboxes are used only for concrete completion criteria. Dashboard status remains the canonical
summary when a checkbox and a status label disagree.

## 1) Product objective and success definition

Product objective:

> Turn NodeDwarves from a deep autonomous simulation into a readable living chronicle in which
> locations, dwarves, factions, crises, victories, and losses form persistent multi-cycle history.

The evolution is successful when an observer can answer these questions without reconstructing the
story from telemetry:

- What important event is happening now?
- Where is it happening, and who is involved?
- Why did it happen?
- What changed because of it?
- Which characters and places matter in this cycle?
- What survived from previous cycles?
- What is the current long-running saga?

Global success signals:

| Signal | Initial target | Evidence source |
| --- | --- | --- |
| Major-event focus coverage | `100%` of critical/legendary events expose actors + location or an explicit world scope | Narrative contract tests + sampled run report |
| Named-actor readability | At least `95%` of priority lifecycle/social/combat messages use display names instead of raw dwarf IDs | Event audit report |
| Chronicle factual integrity | `100%` of chronicle claims link to source structured-event IDs | Chronicle contract tests |
| Story signal-to-noise | No more than one auto-focus interruption inside its configured cooldown unless severity escalates | Story Director report |
| Persistent legacy | Every completed cycle carries at least one bounded historical record and one visible or inspectable legacy hook | Multi-cycle regression |
| Rendering cost | No material regression versus the frozen frame-time baseline; thresholds fixed in E0 | Render benchmark |
| Simulation balance | Cached benchmark comparison and relevant regression profiles pass | Benchmark/regression reports |
| AI compatibility | No observation/action shape drift through Milestones 1-3 unless separately approved | `npm test` + policy-only contract check |

## 2) Current foundation inventory

These capabilities already exist and should be extended instead of duplicated.

| Foundation | Status | Current capability | Reuse direction |
| --- | --- | --- | --- |
| Rolling event pipeline | `Existing` | HUD events plus a bounded event log with inferred categories | Upgrade to a backward-compatible structured event envelope |
| Event Log modal | `Existing` | Scrollable log with all/drama filters | Add importance, actor, location, saga, and consequence views |
| Deterministic dwarf lore | `Existing` | Names, houses, traits, heraldry, vows, and template saga lines | Use as identity seed; replace template-only saga claims with lived history |
| Dwarf Inspect panel | `Existing` | Profile, stats, social links, and deterministic lore | Add deeds, relationships-in-context, scars, and chronicle references |
| Social drama | `Existing` | Friendship, rivalry, mentorship, grudges, and incidents | Feed relationship events into long-running narrative arcs |
| Warrior League | `Existing` | Champions, scars, vows, lineage, Hall of Fame, and company carry-over | Supply hero arcs and dynasty anchors |
| Underrealm | `Existing` | Depth progression, champions, delvers, shrines, raids, and hostile pressure | Supply exploration sagas and named nemeses |
| Schism | `Existing` | Pressure, legitimacy, doctrine, rituals, decrees, and climax | Supply political sagas with colony-wide consequences |
| Villages and roads | `Existing` | Multiple settlement centers and constructed links | Add stable place identity and local history |
| Temple and prestige | `Existing` | Multi-stage visible landmark and cycle prestige carry-over | Reference model for monumental visual progression |
| Endgame transition | `Existing` | Fade/hold/new-frontier transition and partial carry-over | Add cycle summary, archive, and bounded world legacy |
| Map inset and alerts | `Existing` | Compact operational status and critical emphasis | Add current story signal without turning it into another telemetry page |
| Deterministic validation | `Existing` | Cached benchmark, regression profiles, policy contracts, extended gates | Extend with narrative and rendering contracts |

Known experience gaps at workbook creation:

- Events are primarily message strings, so causality, actors, locations, and consequences are not a
  reliable machine-readable contract.
- Important messages can use raw IDs even though display names already exist.
- Dwarf saga text is deterministic flavor rather than a record of lived simulation events.
- The renderer shows the full world and does not yet have a narrative focus/camera contract.
- Only a bounded subset of a large population is rendered, without a universal story-importance
  guarantee.
- Player time control is pause/resume only; important moments can pass at the normal `20 ms` tick.
- Most spatial and social history is reset between cycles.
- The long-arc social configuration exists but is disabled by default and must not be enabled without
  focused balance validation.

## 3) Delivery map and dependency order

Milestones are deliberately cumulative:

```text
M0 Measurement + contracts
  -> M1 Structured stories (E1 + E2)
    -> M2 Watchable simulation (E3 + E4)
      -> M3 Lived history (E5)
        -> M4 Persistent civilization (E6)
          -> M5 Epic threats + monumental world (E7 + E8)
```

Dashboard:

| Milestone | Workstreams | Outcome | Status | Entry gate | Exit gate |
| --- | --- | --- | --- | --- | --- |
| M0 - Measurement | E0 | Frozen narrative/watchability baseline and executable contracts | `Done` | Workbook initialized | E0 gate passes |
| M1 - Structured stories | E1, E2 | Events know who/where/why; messages use stable identities | `Ready` | M0 done | Structured-event + identity gates pass |
| M2 - Watchable simulation | E3, E4 | The terminal guides attention and protects important moments | `Not started` | M1 done | Director + presentation gates pass |
| M3 - Lived history | E5 | Biographies and chronicles contain actual deeds | `Not started` | M2 done | Chronicle integrity + cycle export gate passes |
| M4 - Persistent civilization | E6 | Cycles inherit bounded, visible history | `Not started` | M3 done | Deterministic multi-cycle gate passes |
| M5 - Epic world | E7, E8 | Named nemeses, staged sieges, and evolving landmarks | `Not started` | M4 done | Full quality gate + experience review passes |

Rules for ordering:

- E1 precedes all new narrative consumers. Do not create parallel ad-hoc event formats.
- E3 owns story selection; render modules must not independently decide narrative importance.
- E4 begins with focus overlays and render prioritization. A true camera/zoom abstraction is a later
  decision after the low-risk presentation layer is measured.
- E5 records only facts emitted by the structured event contract.
- E6 stores bounded summaries and stable references, not full prior-cycle simulation states.
- E7 and E8 consume the prior narrative and legacy layers; they must not introduce a second story
  engine.

## 4) Workstream E0 - Baseline, metrics, and contracts

Status: `Done`

Objective: measure the current experience and define executable contracts before changing runtime
behavior.

### E0.1 Freeze the implementation baseline

Status: `Done`

- [x] Record branch, commit, config hash, cached benchmark metadata, terminal size, and active policy.
- [x] Confirm the cached headless baseline matches the active benchmark profile.
- [x] Capture one surface screenshot, one Underrealm screenshot, one Data Center screenshot, and one
      character inspect screenshot from the same deterministic run where practical.
- [x] Record current event-log category distribution over short and long deterministic runs.
- [x] Record current frame-build time separately from terminal write time.

Artifacts:

- `debug/epic_baseline_summary.json`
- `debug/epic_baseline_summary.md`
- existing cached benchmark files in `benchmark_cache/`

E0.1 closure snapshot (2026-07-16):

- Repository freeze: branch `epicEvolution`, commit `c9cda62f495f83cf825f28b63db1f79c1abb1540`,
  config SHA-256 `16cab5b529e99eed7f65ce3f4a08fe994f7828a8cb2e7be690926a0b253bffb3`.
- Cached baseline refreshed because its prior config hash was stale; a second cache-guard run confirmed
  alignment at `8000` ticks, seeds `101,202,303,404`, resources `beer,food,water`, layout `120x40`.
- Refreshed balance reference: population `698.25`, morale `0.8851`, Underrealm depth `2.25`; no
  benchmark seed collapsed.
- Visual references frozen from the existing sequential `2904x2048` product screenshots: surface,
  Data Center, character Inspect, and Underrealm. Their seed is not embedded, so hashes/ticks are
  visual evidence rather than deterministic metric evidence.
- Short event-log snapshot (`t1000`): `631` retained entries, raw dwarf IDs in `37.72%`.
- Long event-log snapshot (`t8000`): `1200/1200` retained entries, every seed at the `300` cap,
  only the latest `859-1166` ticks retained, raw dwarf IDs in `38.50%`.
- Current event schema fields are only `tick`, `message`, `category`, and `source`.
- Frozen render-build means: surface `1.146 ms`, Underrealm `0.817 ms`, telemetry `1.449 ms`, Inspect
  `1.914 ms`; the highest observed seed p95 was Inspect at `7.832 ms`.
- Output-write timings are isolated synchronous `/dev/null` byte-write costs; terminal-emulator paint
  is explicitly outside this headless baseline.
- Evidence: `debug/epic_baseline_summary.json`, `debug/epic_baseline_summary.md`, and refreshed
  `benchmark_cache/headless_benchmark_baseline.json|.md`.

### E0.2 Define the structured narrative contract

Status: `Done`

Minimum event envelope:

```js
{
  id,              // deterministic stable event id
  tick,
  type,
  category,
  importance,      // ambient | notable | major | critical | legendary
  message,
  actors,          // stable typed references
  location,        // surface/depth/world scope
  causes,          // source event/state references
  consequences,    // bounded structured deltas/tags
  sagaId,
  source
}
```

- [x] Document normalization and fallback behavior for legacy string-only callers.
- [x] Define deterministic ID construction and collision behavior.
- [x] Define bounded actor/location/reference schemas.
- [x] Define event retention limits separately from chronicle retention.
- [x] Define serialization constraints for training and report tooling.

E0.2 closure snapshot (2026-07-16):

- Approved schema v1 with generated `cycle/tick/sequence` identity, closed enums, bounded typed
  references, and a 16 KiB serialized-event ceiling.
- Preserved the string, transitional string-plus-details, and structured-object producer paths for
  incremental migration; legacy v0 records remain read-only display inputs and do not receive
  invented persistent IDs.
- Kept `state.events` as the compact HUD list and `state.eventLog` as a capped UI buffer. Future
  Story Director, Chronicle, and cycle-legacy stores own separate caps and retain compact facts plus
  provenance IDs instead of full event history.
- Confirmed that E1.1 must not change RNG consumption, AI observation/action shapes, benchmark report
  payloads, or the current map-export snapshot.
- Normative specification and E0.3 fixture matrix: `docs/NARRATIVE_EVENT_CONTRACT.md`.

### E0.3 Add narrative contract tests

Status: `Done`

- [x] Validate required fields and normalized enums.
- [x] Validate stable IDs for equal seed/state/event order.
- [x] Validate backward compatibility for existing `pushEvent` callers.
- [x] Validate bounded retention and no unbounded nested state references.
- [x] Validate event-log filtering after schema introduction.

Implemented files:

- `src/simulation/narrative_contract.js`
- `scripts/test_narrative_contracts.js`
- `package.json` (`test:narrative` plus aggregate `test` wiring)

E0.3 closure snapshot (2026-07-16):

- Added a strict reusable schema-v1 validator and transactional deterministic identity helpers in
  `src/simulation/narrative_contract.js`; the module is not wired into event emission yet, so runtime
  behavior remains unchanged until E1.1.
- Added `scripts/test_narrative_contracts.js` with valid and deliberately malformed fixtures covering
  envelope fields/enums, plain-JSON bounds, UTF-8 limits, ID coherence, same-tick ordering, rejected
  candidate semantics, cycle separation, and serialization round trips.
- Exercised current string-only and string-plus-details `pushEvent` compatibility, category inference,
  `maxEntries`/`logMaxEntries` including zero, and explicit RNG neutrality.
- Rendered a mixed v0/v1 Event Log fixture through both all/drama filters and asserted that rendering
  does not mutate retained records.
- Guarded AI observation and map-export isolation from narrative buffers.
- Added `npm run test:narrative` for the focused fast gate and made it the first lane in `npm test`.
- Focused result: `[test:narrative] PASS envelope malformed identity legacy retention bounds
  serialization renderer ai_isolation export_isolation`.

E0 exit criteria:

- [x] Baseline artifacts recorded.
- [x] Event schema decision approved and logged.
- [x] Narrative contract tests fail on malformed fixtures and pass on valid fixtures.
- [x] Current `npm test` remains green.

## 5) Workstream E1 - Structured events and causal history

Status: `Ready`

Objective: turn the existing rolling log into a deterministic, machine-readable story substrate
without breaking current message consumers.

### E1.1 Backward-compatible event core

- [ ] Extend `src/simulation/events.js` with normalized structured payload support.
- [ ] Preserve `state.events` as the compact HUD message list during migration.
- [ ] Preserve `state.eventLog` compatibility for the current Event Log panel.
- [ ] Add importance defaults by category/type through config, not hidden constants.
- [ ] Keep explicit event data free of render-only ANSI/color concerns.

### E1.2 Priority producer migration

Migrate in this order:

- [ ] Lifecycle: births, deaths, partnerships, and founding events.
- [ ] Social drama: mentorship, rivalry, grudges, and reconciliation.
- [ ] Combat: surface raids, ruins expeditions, Underrealm fights, and champion changes.
- [ ] Warrior League: tournaments, scars, vows, retirements, and Hall of Fame changes.
- [ ] Political: schism phases, rituals, decrees, and climax resolution.
- [ ] Endgame: artifact completion, cycle closure, transition, and carry-over.

Each migrated event must declare actors and location when those facts exist in state.

### E1.3 Secondary producer migration

- [ ] World events, external camps, caravans, merchants, and contracts.
- [ ] Myths, alchemy, festivals, weather, and wildlife.
- [ ] Construction, upgrades, villages, roads, temple stages, and resource milestones.
- [ ] Add an audit that reports remaining legacy-only producers.

### E1.4 Event Log integration

- [ ] Render importance, named actors, location, and saga membership without overcrowding the panel.
- [ ] Keep the existing all/drama filters and define additional filters only after usage evidence.
- [ ] Add a compact event-detail view or expandable row only if the terminal layout remains readable.
- [ ] Preserve scroll behavior and bounded storage.

E1 exit criteria:

- [ ] All priority producers emit valid structured events.
- [ ] Legacy producers still render correctly through compatibility normalization.
- [ ] Same-seed narrative event IDs and ordering are reproducible.
- [ ] No simulation state or balance delta is caused by the presentation-only migration.
- [ ] README, MANUAL, parameter reference, telemetry reference, and project layout are updated as needed.

## 6) Workstream E2 - Identity, places, and readable actors

Status: `Not started`

Objective: make events human-readable and give geography stable identity.

### E2.1 Shared identity resolver

- [ ] Add one public helper for resolving dwarf display name, house, role title, and fallback ID.
- [ ] Reuse the deterministic lore seed; do not create competing name generators.
- [ ] Cache display identities safely for high-frequency render paths.
- [ ] Define behavior for dead, retired, carried-over, or missing actors.

### E2.2 Named event messages

- [ ] Replace raw dwarf IDs in priority lifecycle/social/combat messages with display names.
- [ ] Keep stable IDs available in structured actor references and detailed inspection.
- [ ] Include house/clan/title only when it materially distinguishes the actor.
- [ ] Add tests for newborn, deceased, retired, and unknown actor formatting.

### E2.3 Stable place identity

- [ ] Generate deterministic names for villages, roads, major gates, lifts, ruins, and temple sites.
- [ ] Store names in authoritative state instead of regenerating them in render code.
- [ ] Reference place names in events, inspect views, telemetry, and chronicles.
- [ ] Preserve compact fallback labels for narrow terminals.

### E2.4 Priority visibility

- [ ] Define story actor priority tiers for the bounded visible-dwarf selection.
- [ ] Guarantee current critical/legendary actors are rendered when their layer is visible.
- [ ] Prefer champions, endangered dwarves, saga protagonists, and current incident actors.
- [ ] Keep selection stable enough to avoid visual flicker.

E2 exit criteria:

- [ ] Priority message named-actor share meets the frozen target.
- [ ] Named locations are deterministic across equal seeds.
- [ ] Identity resolution has no per-tick unbounded allocation hotspot.
- [ ] Render-priority tests cover population above `display.dwarves.maxVisible`.

## 7) Workstream E3 - Epic Story Director

Status: `Not started`

Objective: aggregate events into readable arcs and choose what deserves observer attention.

### E3.1 Director state and configuration

- [ ] Add bounded `state.story` runtime state with current focus, saga registry, cooldowns, and history.
- [ ] Add config for importance thresholds, interruption budget, escalation, saga inactivity timeout,
      and history limits.
- [ ] Keep story selection deterministic and isolated from gameplay RNG.
- [ ] Exclude render timing and wall-clock time from story decisions.

### E3.2 Event scoring and focus selection

- [ ] Score events by severity, rarity, named actors, consequences, current saga, and player visibility.
- [ ] Implement cooldown and escalation rules to prevent focus spam.
- [ ] Allow critical events to preempt notable events deterministically.
- [ ] Record the reason trace for every focus selection or suppression.

### E3.3 Saga aggregation

- [ ] Group causal events by actor, location, faction, threat, and explicit parent references.
- [ ] Define deterministic saga lifecycle: opened, active, dormant, resolved, failed, archived.
- [ ] Generate chapter summaries from facts, not unconstrained flavor text.
- [ ] Keep chapter and saga lengths bounded by config.

### E3.4 Explainability and telemetry

- [ ] Expose current saga, current focus, interruption cooldown, and selection reason.
- [ ] Add a Story Director section to the telemetry reference when metrics become player-facing.
- [ ] Add headless report counters for focus coverage, suppressed events, and saga resolution.

E3 exit criteria:

- [ ] Critical/legendary focus coverage reaches target.
- [ ] Same-seed focus decisions and saga IDs are reproducible.
- [ ] Interruption budget and escalation rules pass deterministic tests.
- [ ] Story state remains bounded over a multi-cycle long run.

## 8) Workstream E4 - Cinematic terminal presentation

Status: `Not started`

Objective: make important events immediately visible while preserving the terminal-first interface.

### E4.1 Story ribbon

- [ ] Add a compact in-map story ribbon for the current major event or saga beat.
- [ ] Show actor, action, place, and consequence in that order when width permits.
- [ ] Define narrow-terminal fallbacks and collision rules with existing overlays.
- [ ] Do not duplicate the Data Center inside the ribbon.

### E4.2 Map focus overlays

- [ ] Add deterministic pulse/rune/radius emphasis around the current location.
- [ ] Add off-screen/layer direction cues when the focused event is not in the active view.
- [ ] Highlight involved actors and relevant paths without permanently recoloring terrain.
- [ ] Add configurable animation cadence that does not change simulation state.

### E4.3 Time controls and major-event protection

- [ ] Add explicit speed levels and single-step control.
- [ ] Add configurable auto-slow or auto-hold for critical/legendary events.
- [ ] Ensure headless runs and training remain unaffected by presentation timing.
- [ ] Make manual input override auto-focus safely and predictably.

### E4.4 Camera decision checkpoint

- [ ] Measure the overlay-first approach with real runs and screenshots.
- [ ] Decide whether a camera/viewport abstraction is still needed.
- [ ] If approved, separate world dimensions from terminal viewport dimensions before adding pan/zoom.
- [ ] Record resize, pathing, export, and Underrealm implications before implementation.

E4 exit criteria:

- [ ] An observer can locate every critical/legendary visible-layer event without opening telemetry.
- [ ] Overlay priority and panel collisions pass supported terminal-size checks.
- [ ] Presentation timing does not alter deterministic simulation results.
- [ ] Render performance remains within the E0 threshold.
- [ ] `npm start` smoke covers pause, speed, step, panels, layer switching, and resize.

## 9) Workstream E5 - Living biographies and Chronicle

Status: `Not started`

Objective: replace disconnected flavor with a factual history of dwarves, places, and cycles.

### E5.1 Bounded experience ledger

- [ ] Add per-dwarf deed references for major social, combat, civic, and lifecycle events.
- [ ] Store source event IDs plus compact normalized facts, not copied full event objects.
- [ ] Define importance-based retention and merge rules.
- [ ] Preserve records required by active sagas and Hall of Fame entries.

### E5.2 Inspect-panel biography

- [ ] Show recent deeds, defining deed, active relationships, scars, and current saga role.
- [ ] Keep deterministic flavor fields, but clearly separate inherited lore from lived history.
- [ ] Resolve dead or missing related actors through archived identities.
- [ ] Keep content readable at configured panel dimensions.

### E5.3 Cycle Chronicle

- [ ] Build chapters for settlement growth, crises, politics, expeditions, heroes, deaths, and legacy.
- [ ] Link every factual statement to one or more source event IDs in the data model.
- [ ] Generate an in-game summary before the new-frontier reset.
- [ ] Add optional Markdown/JSON export with deterministic ordering and safe filenames.

### E5.4 Chronicle verification

- [ ] Reject or omit claims whose source actor/location/event no longer resolves.
- [ ] Test empty, short, peaceful, catastrophic, and multi-cycle chronicles.
- [ ] Validate retention bounds with high event density.
- [ ] Compare exported chapter hashes across equal seeded runs.

E5 exit criteria:

- [ ] Chronicle factual integrity reaches target.
- [ ] Priority dwarf biographies contain lived deeds when qualifying events occurred.
- [ ] Endgame transition presents a readable cycle legacy summary.
- [ ] Exported Chronicle is deterministic and bounded.

## 10) Workstream E6 - Persistent world legacy

Status: `Not started`

Objective: make each completed cycle leave inspectable and visible history without carrying an entire
old simulation state.

### E6.1 Legacy state contract

- [ ] Define bounded `worldLegacy` state for cycle summaries, archived identities, named places,
      memorials, scars, and inherited hooks.
- [ ] Define versioning and migration behavior.
- [ ] Set explicit per-category and total retention caps.
- [ ] Keep carry-over deterministic and compatible with randomized new terrain seeds.

### E6.2 Memorials and inherited institutions

- [ ] Carry selected champions, founders, myths, houses, and Warrior Company history.
- [ ] Create memorial, tomb, statue, or ancestor-hall records for qualifying figures.
- [ ] Allow institutions to inherit names, mottos, or bounded modifiers.
- [ ] Prevent prestige/bonus stacking from becoming an uncontrolled economy accelerator.

### E6.3 Geographic echoes

- [ ] Map prior-cycle places to new-world echoes instead of copying invalid coordinates.
- [ ] Support ancient road, lost hold, ancestral ruin, or named frontier hooks.
- [ ] Make inherited sites visible and usable by future sagas.
- [ ] Record provenance to the source cycle and chronicle chapter.

### E6.4 Multi-cycle balance

- [ ] Add deterministic 2-cycle and 5-cycle validation profiles.
- [ ] Track legacy count, bonus magnitude, population stability, deaths, stockpiles, and endgame time.
- [ ] Add stop rules for runaway compounding or state growth.
- [ ] Verify old legacy entries expire or compact as configured.

E6 exit criteria:

- [ ] Every normal completed cycle creates at least one bounded legacy record.
- [ ] Multi-cycle state size respects configured caps.
- [ ] No unbounded prestige/economy/combat bonus accumulation.
- [ ] Multi-cycle benchmark and AI non-regression gates pass.

## 11) Workstream E7 - Nemeses and staged sieges

Status: `Not started`

Objective: create recognizable antagonists whose actions form persistent sagas.

### E7.1 Nemesis identity and memory

- [ ] Add deterministic identity, faction, traits, goals, scars, victories, defeats, and grudges.
- [ ] Promote existing Underrealm champions or raider leaders through explicit eligibility rules.
- [ ] Persist only qualifying nemeses through the bounded legacy contract.
- [ ] Make nemesis state visible in events, saga view, and relevant inspect panels.

### E7.2 Staged conflict lifecycle

- [ ] Define warning, approach, demand, breach, battle, retreat/victory, and aftermath stages.
- [ ] Reuse raids, external camps, schism, roads, watchtowers, and Warrior League where possible.
- [ ] Attach structured consequences to damaged structures, casualties, morale, politics, and territory.
- [ ] Add recovery windows so conflicts do not create unrecoverable event storms.

### E7.3 Rivalry and consequence arcs

- [ ] Track specific hero-nemesis encounters and outcomes.
- [ ] Allow rescue, revenge, reconciliation, succession, or inherited-grudge branches.
- [ ] Convert major outcomes into Chronicle chapters and memorial/legacy candidates.
- [ ] Keep branch selection deterministic and config-driven.

E7 exit criteria:

- [ ] At least one deterministic scenario exercises a full staged siege.
- [ ] Nemesis identity and encounter history remain stable across the scenario.
- [ ] Colony recovery and collapse guardrails are both meaningful.
- [ ] Combat presentation and aftermath are visible without telemetry reconstruction.

## 12) Workstream E8 - Monumental settlement evolution

Status: `Not started`

Objective: make colony progress physically legible through a small number of iconic, evolving
landmarks.

### E8.1 Landmark framework

- [ ] Generalize the proven Temple multi-stage footprint pattern where practical.
- [ ] Define footprint reservation, construction stages, symbols, colors, and collision behavior.
- [ ] Keep landmark count intentionally small and configuration-driven.
- [ ] Include export-map support and legend updates.

### E8.2 Initial landmark set

Candidate order, subject to decision log:

- [ ] Great Hall: civic center, Chronicle archive, and cycle identity.
- [ ] Warrior Arena: tournament history and champion monuments.
- [ ] Legendary Forge: artifact, weapon, and lineage focal point.
- [ ] Gate Fortress: visible raid defense and siege damage state.
- [ ] Necropolis or Ancestor Walk: memorial visualization.

### E8.3 District and damage readability

- [ ] Add optional compact district identity around major institutions.
- [ ] Show construction, prosperity, damage, abandonment, and restoration states.
- [ ] Make changes readable at normal terminal scale without excessive symbol noise.
- [ ] Keep per-tick rendering and simulation scans bounded.

E8 exit criteria:

- [ ] Landmark progression is visible in runtime and exported maps.
- [ ] Placement remains valid across supported terrain seeds and terminal sizes.
- [ ] Damage/restoration loops pass deterministic scenario checks.
- [ ] Structure/economy and render-performance gates pass.

## 13) AI and training compatibility plan

Default policy: Milestones M0-M3 are presentation/history work and must not change policy observation
or action shapes.

For every workstream:

- [ ] Classify the change as presentation-only, simulation-affecting, reward-affecting, or contract-affecting.
- [ ] Run `node scripts/test_training_contracts.js --policy-only` after any policy-adjacent edit.
- [ ] Run `npm test` before workstream closure.
- [ ] Record whether old policies remain loadable.
- [ ] Use `--fresh` training only when an approved observation/action contract change requires it.

AI integration is considered only after the player-visible feature is stable:

- Story Director should initially observe simulation events, not influence decisions.
- Chronicle and legacy data should not enter observations by default.
- Nemesis/siege gameplay that changes resource, defense, diplomacy, or expedition decisions requires
  explicit reward/observation impact review.
- Landmark build decisions require governor integration only when autonomous default logic cannot
  maintain stable config-driven behavior.

## 14) Validation matrix and stop rules

Validation tiers:

| Tier | When | Minimum checks |
| --- | --- | --- |
| V0 - Static | Every code edit | `node --check` for changed JS, JSON parse, focused unit/contract tests |
| V1 - Short | Every implementation step | Deterministic short scenario, runtime render smoke, targeted assertions |
| V2 - Workstream | Before marking a workstream Done | Dedicated narrative/render/multi-cycle test plus `npm test` |
| V3 - Balance | Any simulation/config effect | Cached baseline guard, candidate benchmark, report diff, relevant regression profiles |
| V4 - Release | Milestone closure | `npm run ai:validate`, runtime/resize/panel checks, docs review, debug cleanup |
| V5 - Deep | Persistent legacy, sieges, or AI changes | Long-horizon and multi-cycle profiles, weekly sentinel where applicable |

Required narrative metrics in reports as they become available:

- events by type/category/importance;
- legacy-only producer count;
- named-actor and named-location coverage;
- focus selected/suppressed/preempted counts;
- focus coverage by severity;
- sagas opened/resolved/failed/archived;
- chronicle claims and unresolved source references;
- biography deed retention and compaction counts;
- legacy records/bytes by cycle;
- render build-time percentiles and overlay counts.

Stop rules:

- Stop and fix before proceeding when deterministic event IDs/order diverge on equal seeded runs.
- Stop when a presentation-only change alters simulation end-state metrics.
- Stop when story or legacy state grows without a configured hard cap.
- Stop when critical events can be silently suppressed without an explicit reason trace.
- Stop when Chronicle output contains a factual claim without resolvable source evidence.
- Stop when priority actors disappear because the visible population cap is full.
- Stop when render performance exceeds the E0 threshold or supported terminal layouts become unreadable.
- Stop on population collapse, strong stockpile regression, negative stockpiles, or AI policy-contract
  regression unless the behavior is intentional and documented.

## 15) Risk register

| ID | Risk | Probability | Impact | Mitigation | Status |
| --- | --- | --- | --- | --- | --- |
| ER-001 | Narrative state becomes another unbounded log | Medium | High | Hard caps, compaction, source references, long-run size assertions | Open |
| ER-002 | Story Director creates constant interruptions | High | High | Importance threshold, cooldown budget, escalation, suppression trace | Open |
| ER-003 | Structured-event migration changes simulation behavior | Low | High | Backward-compatible wrapper, presentation-only tests, end-state parity | Open |
| ER-004 | Display-name resolution becomes a render hotspot | Medium | Medium | Stable cached identity resolver and allocation profiling | Open |
| ER-005 | Chronicle flavor invents unsupported facts | Medium | High | Fact templates bound to structured source events; integrity tests | Open |
| ER-006 | Multi-cycle legacy creates runaway bonuses | Medium | High | Bounded modifiers, diminishing returns, 2/5-cycle gates | Open |
| ER-007 | Camera refactor couples world size to terminal size incorrectly | Medium | High | Overlay-first milestone; explicit architecture decision checkpoint | Open |
| ER-008 | Landmark footprints break placement/pathing/export | Medium | Medium | Reuse temple pattern, deterministic placement scenarios, export tests | Open |
| ER-009 | New threats make stable colonies unrecoverable | Medium | High | Staged rollout, recovery windows, cached benchmark and collapse blockers | Open |
| ER-010 | AI observes a world contract that changed silently | Low | High | Shape contracts, compatibility classification, explicit fresh-training gate | Open |

## 16) Decision log

Record every non-trivial scope or architecture decision.

| Date | ID | Decision | Alternatives considered | Reason | Impact | Status |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-07-16 | ED-001 | Use a structured event substrate as the first implementation layer | Add isolated cinematic messages per system; start with camera rewrite | All later narrative, Chronicle, focus, and legacy features require shared facts | Architecture and sequencing | Approved |
| 2026-07-16 | ED-002 | Preserve terminal-first product identity | Rewrite runtime as a browser UI; add a second primary frontend | Current terminal rendering is a product strength and already supports rich overlays | Product scope | Approved |
| 2026-07-16 | ED-003 | Start cinematic work with overlays and render prioritization | Immediate world/viewport/camera decoupling | Delivers attention guidance with lower pathing, resize, and export risk | M2 scope | Approved |
| 2026-07-16 | ED-004 | Keep M0-M3 observation/action shapes unchanged by default | Feed story/legacy state into AI immediately | Isolates player-facing value and protects trained-policy compatibility | AI stability | Approved |
| 2026-07-16 | ED-005 | Store Chronicle facts as references to structured events | Generate free-form summaries without sources | Enables deterministic factual verification and bounded storage | Narrative integrity | Approved |
| 2026-07-16 | ED-006 | Carry bounded summaries/echoes across cycles, not entire prior states | Serialize full old worlds; reset all history | Preserves history without invalid coordinates or uncontrolled state growth | Persistent legacy | Approved |
| 2026-07-16 | ED-007 | Generate v1 event IDs from schema version, cycle, tick, and accepted-event sequence | Random UUIDs; wall-clock IDs; message/content hashes | Preserves seeded determinism without consuming RNG or coupling identity to mutable display text | Event identity and replay comparison | Approved |
| 2026-07-16 | ED-008 | Keep legacy v0 records display-only while new writers emit canonical v1 events through a backward-compatible `pushEvent` API | Eagerly rewrite retained records; require an all-at-once producer migration | Lets current string-only producers and Event Log rendering survive incremental migration | E1 migration scope and compatibility | Approved |
| 2026-07-16 | ED-009 | Treat `state.eventLog` as a capped UI buffer and give future Story/Chronicle/legacy stores separate bounded ownership | Grow the Event Log into permanent history; retain full prior events across cycles | Prevents tick-proportional state growth while preserving compact facts and provenance IDs | Retention architecture | Approved |
| 2026-07-16 | ED-010 | Implement the E0.3 schema validator and identity transaction helpers as a pure reusable module, without wiring it into `pushEvent` until E1.1 | Keep a test-only duplicate contract oracle; implement the full event core during E0.3 | Gives tests production-reusable rules while preserving the planned runtime migration boundary | Contract enforcement and E1.1 risk | Approved |

## 17) Implementation log

Add one row for every implementation or validation cycle. Keep artifact paths only while they remain
within the repository retention policy.

| Date | ID | Scope | Files | Validation | Result | Artifacts / notes |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-07-16 | EW-000 | Initialize Epic Evolution workbook, baseline inventory, dependency plan, gates, risks, and documentation indexes | `docs/EPIC_EVOLUTION_WORKBOOK.md`, `AGENTS.md`, `README.md`, `MANUAL.md` | Markdown/link review, `git diff --check`, `npm test` | Done | Planning-only change; no simulation/config/policy behavior changed |
| 2026-07-16 | EW-001 | E0.1 freeze: align cached benchmark, fingerprint repo/config/policy/layout/screenshots, measure retained event-log distribution at `1000/8000` ticks, and isolate frame-build/output-write timings | `benchmark_cache/headless_benchmark_baseline.json`, `benchmark_cache/headless_benchmark_baseline.md`, `debug/epic_baseline_summary.json`, `debug/epic_baseline_summary.md`, `docs/EPIC_EVOLUTION_WORKBOOK.md` | `npm run bench:ensure-baseline` (refresh + aligned recheck), deterministic 4-seed probe, JSON parse, `git diff --check`, `npm test` | Done | No seed collapse; long log saturated `1200/1200`, raw-ID share `38.50%`; surface build mean `1.146 ms`, Inspect max seed p95 `7.832 ms` |
| 2026-07-16 | EW-002 | E0.2 contract: specify the v1 narrative envelope, deterministic IDs/order, legacy normalization, typed reference bounds, independent retention, serialization ceiling, and E0.3 acceptance matrix | `docs/NARRATIVE_EVENT_CONTRACT.md`, `docs/EPIC_EVOLUTION_WORKBOOK.md`, `AGENTS.md`, `README.md`, `MANUAL.md` | Contract consistency audit, documentation index review, `git diff --check`, `npm test` | Done | Specification-only change; no config, runtime, simulation, rendering, export, or AI behavior changed |
| 2026-07-16 | EW-003 | E0.3 executable contracts: add strict v1 validation/identity helpers, malformed fixtures, legacy/retention checks, mixed v0/v1 renderer checks, and AI/export isolation gates | `src/simulation/narrative_contract.js`, `scripts/test_narrative_contracts.js`, `package.json`, `docs/NARRATIVE_EVENT_CONTRACT.md`, `docs/EPIC_EVOLUTION_WORKBOOK.md`, `AGENTS.md`, `README.md`, `MANUAL.md` | `node --check src/simulation/narrative_contract.js`, `node --check scripts/test_narrative_contracts.js`, `npm run test:narrative`, `npm test`, `git diff --check` | Done | Focused and aggregate suites pass; malformed fixtures fail with deterministic diagnostics; no event-runtime/config/AI/export behavior changed |

## 18) Checkpoint template

Copy this block for each implementation checkpoint:

```text
Checkpoint: EX-X.Y
Date: YYYY-MM-DD
Owner:
Status: Ready | In progress | Partial | Done | Blocked

Objective:
Dependencies:
Files in scope:
Config parameters:
Simulation impact classification:
AI compatibility classification:

Implementation completed:
-

Validation commands:
-

Measured result versus baseline:
-

Artifacts:
-

Open risks/blockers:
-

Decision-log updates:
-

Next executable step:
-
```

## 19) Definition of Done

A step is Done only when:

- [ ] Its implementation checklist is complete.
- [ ] Config tunables are documented in `docs/PARAMETERS.md` when applicable.
- [ ] Training overrides are documented when scenario or policy behavior changes.
- [ ] README contains only the appropriate high-level player-facing impact.
- [ ] MANUAL contains technical and operational behavior.
- [ ] Telemetry reference matches any changed player-facing telemetry.
- [ ] Project layout docs match every added, moved, renamed, or removed file.
- [ ] Focused short-run validation passes.
- [ ] Required long-run benchmark/regression gates pass.
- [ ] Explicit AI non-regression checks pass.
- [ ] Determinism and bounded-state assertions pass.
- [ ] Implementation log contains commands, results, and retained evidence.
- [ ] Debug artifacts are cleaned according to repository retention rules.

A milestone is Done only when every included workstream is Done, its release validation tier passes,
and no open High-impact risk is unmitigated.

## 20) Next execution queue

Execute one bounded step at a time:

1. [x] `E0.1` - Freeze repository, benchmark, event-distribution, screenshot, and render-time baseline.
2. [x] `E0.2` - Finalize the structured event envelope and deterministic ID rules.
3. [x] `E0.3` - Add executable narrative contract tests.
4. `E1.1` - Implement the backward-compatible structured event core. **Next.**
5. `E1.2` - Migrate lifecycle events and validate end-state parity.
6. Continue priority producer migration only after the lifecycle slice is closed.

The first implementation slice should remain deliberately narrow: event schema, birth/death
producers, identity resolution, Event Log compatibility, deterministic tests, and documentation.
It should not include camera work, persistent legacy, new combat systems, or AI shape changes.
