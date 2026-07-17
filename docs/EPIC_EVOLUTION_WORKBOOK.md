# NodeDwarves Epic Evolution Workbook

Last updated: 2026-07-17
Status: Active implementation - M1 complete; M2 in progress
Completed checkpoint: `E3.4` done
Next executable step: `E4.1` ready
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
| M1 - Structured stories | E1, E2 | Events know who/where/why; messages use stable identities | `Done` | M0 done | Structured-event + identity gates pass |
| M2 - Watchable simulation | E3, E4 | The terminal guides attention and protects important moments | `In progress` | M1 done | Director + presentation gates pass |
| M3 - Lived history | E5 | Biographies and chronicles contain actual deeds | `Not started` | M2 done | Chronicle integrity + cycle export gate passes |
| M4 - Persistent civilization | E6 | Cycles inherit bounded, visible history | `Not started` | M3 done | Deterministic multi-cycle gate passes |
| M5 - Epic world | E7, E8 | Named nemeses, staged sieges, and evolving landmarks | `Not started` | M4 done | Full quality gate + experience review passes |

Current checkpoint: `E3.4` is `Done`; `E4.1` is the next executable step. Canonical events now drive
bounded deterministic scoring, focus, preemption, saga aggregation/lifecycle, fact-backed chapters,
player-facing Story Director telemetry, and headless focus/saga counters without gameplay RNG,
timing sources, PPO observation changes, or balance drift.

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

Status: `Done`

Objective: turn the existing rolling log into a deterministic, machine-readable story substrate
without breaking current message consumers.

### E1.1 Backward-compatible event core

Status: `Done`

- [x] Extend `src/simulation/events.js` with normalized structured payload support.
- [x] Preserve `state.events` as the compact HUD message list during migration.
- [x] Preserve `state.eventLog` compatibility for the current Event Log panel.
- [x] Add importance defaults by category/type through config, not hidden constants.
- [x] Keep explicit event data free of render-only ANSI/color concerns.

E1.1 closure snapshot (2026-07-17):

- `pushEvent` accepts legacy strings, transitional string-plus-details calls, and structured objects;
  every accepted input returns a canonical v1 event while existing callers may ignore the return.
- Draft normalization and optional-payload reduction live in the dedicated
  `src/simulation/narrative_normalizer.js` module, keeping the event gateway focused on state flow.
- Generated identity is transactional: rejected/malformed/colliding drafts do not consume sequence,
  log messages, or invoke RNG. Equal state/order produces equal cycle/tick/sequence IDs.
- `state.events` remains a capped string mini-log; `state.eventLog` now retains capped full v1 objects
  and the Event Log renderer continues to accept both v0 and v1 records.
- Added initial `eventClock` and bounded scalar `eventStats` state, including accepted, rejected,
  legacy-normalized, truncated, and collision counts.
- Importance uses config precedence: explicit → `by_type` → `by_category` → default → `ambient`.
- Structured text/references are ANSI-free, plain JSON, UTF-8 bounded, and deterministically reduced
  under the 16 KiB ceiling.
- No producer-specific migration is included; existing emitters currently surface as
  `legacy.<category>` until E1.2/E1.3 supplies actor/location/causal facts.
- Full cached profile remained numerically identical to E0.1: seed populations `683/678/732/700`,
  average population `698.25`, morale `0.8851`, hunger `0.1575`, thirst `0.1083`, and Underrealm
  depth `2.25`; the cache guard then confirmed the new config hash is aligned.

### E1.2 Priority producer migration

Status: `Done`

Migrate in this order:

- [x] Lifecycle: births, deaths, partnerships, and founding events.
- [x] Social drama: mentorship, rivalry, grudges, and reconciliation.
- [x] Combat: surface raids, ruins expeditions, Underrealm fights, and champion changes.
- [x] Warrior League: tournaments, scars, vows, retirements, and Hall of Fame changes.
- [x] Political: schism phases, rituals, decrees, and climax resolution.
- [x] Endgame: artifact completion, cycle closure, transition, and carry-over.

Each migrated event must declare actors and location when those facts exist in state.

E1.2 lifecycle slice closure snapshot (2026-07-17):

- Added `src/simulation/lifecycle_events.js` as the single structured payload boundary for cycle
  founding, births, natural deaths, and first-mutual-bond partnerships.
- Every migrated event keeps the existing compact message while adding stable dwarf/settlement IDs,
  deterministic lore-name snapshots, last-known surface locations, causal facts, and typed
  consequences. No retained event contains a live simulation object.
- `stepState` records settlement founding at tick `0` before advancing a newly initialized cycle;
  `state.lifecycle.foundingEmitted` prevents duplicates and is committed only after event acceptance.
- Natural-death cleanup preserves the deceased snapshot for emission after authoritative population,
  job, relationship, and pregnancy cleanup. Partnership emission observes the existing relationship
  transition and does not alter its mechanics or random-call order.
- Config assigns `notable` to birth/partnership and `major` to death/founding through
  `events.importance.by_type`.
- Focused lifecycle integration fixtures cover once-per-cycle founding, a due-pregnancy birth,
  starvation death, first partnership without duplicate emission, strict v1 validity, and RNG
  neutrality. The two-seed `1000`-tick smoke retained exact pre-migration endpoints.
- The refreshed `4 x 8000` cached profile retained exact frozen populations `683/678/732/700`,
  average population `698.25`, morale `0.8851`, hunger `0.1575`, thirst `0.1083`, and Underrealm
  depth `2.25`. Cache hash `752fdfc76240b106447411200689f6ca636f825334f4583bd0bb7baf47923620`
  passed the immediate aligned recheck.
- The endgame row remains open; E1.2 is not
  complete until those priority producer slices close.

E1.2 social-drama slice closure snapshot (2026-07-17):

- Added `src/simulation/social_events.js` as the structured payload boundary for mentorship
  breakthroughs, rivalry clashes, grudge escalations, and reconciliations.
- `social_drama.js` emits only after the existing effects, cooldown, history, and counter updates
  commit. Selection weights, random-call order, messages, gameplay deltas, and ledger behavior remain
  unchanged.
- Events retain deterministic actor-name snapshots and pre-incident pair metrics. Mentorship records
  mentor/beneficiary roles; symmetric conflicts do not invent an instigator. Location uses a shared
  coordinate/home fact when defensible and otherwise falls back to world scope.
- Type importance is config-driven: grudge escalation is `major`; mentorship breakthrough, rivalry
  clash, and reconciliation are `notable`.
- Focused fixtures cover all four event families, strict v1 validity, no pair mutation, no emission
  RNG, and one real rivalry incident through `updateSocialDrama`.
- The pre/post deterministic `2 x 1000` profile is numerically identical: seed populations `18/30`,
  average population `24.0`, morale `0.8905`, hunger `0.1493`, thirst `0.1003`, and matching
  stockpile/Underrealm/decree endpoints. Aggregate contracts and terminal render smoke also pass.
- Per ED-013, the active config hash
  `ef9bf430516893b04e96cbca3703d30a527c395d5d138430f1e05dc6571eee08` is temporarily different
  from cached baseline hash `752fdfc76240b106447411200689f6ca636f825334f4583bd0bb7baf47923620`.
  No report-to-report claim may use that stale cache; refresh remains deferred until E1.2 closure
  unless a full-profile risk trigger appears.

E1.2 combat slice closure snapshot (2026-07-17):

- Added `src/simulation/combat_events.js` as the structured boundary for surface raid start/end,
  ruins expedition dispatch/outcome, deterministic depth-champion encounters, hostile deep-raid
  start/casualties/end, and Dwarf Champion appointment/fall.
- Existing compact messages and authoritative gameplay order remain unchanged. Event builders run
  only after results commit; victim and party objects are snapshotted before removal when needed.
- Structured facts retain settlement/faction/threat/dwarf actors, surface or depth location, combat
  difficulty/readiness/strength evidence, casualties, stolen resources, contested state, and unlocks.
- Readiness blocks, artifacts, lift progression, shrine/oath events, and failure-cooldown operations
  remain legacy because they are not combat outcomes. Tournament champion changes are owned by the
  completed Warrior League slice below.
- Focused fixtures validate all twelve combat event types, strict v1 shape, actor/cause/consequence
  coverage, victim name retention, unlock facts, config importance, and zero emission RNG. A real
  no-loss raid conclusion also passes through `updateRaidTick`.
- The pre/post deterministic `2 x 1000` profile remains numerically identical: seed populations
  `18/30`, average population `24.0`, morale `0.8905`, hunger `0.1493`, thirst `0.1003`, with matching
  stockpile, Underrealm, and decree endpoints.
- Per ED-013, active config hash
  `3ffacb47062db4b9bc00c6f6f76edd6c48639397fcd87af2a280163d836fd263` remains intentionally
  different from cached hash `752fdfc76240b106447411200689f6ca636f825334f4583bd0bb7baf47923620`.
  The stale cache remains excluded from report comparisons until final E1.2 refresh.

E1.2 Warrior League slice closure snapshot (2026-07-17):

- Added `src/simulation/warrior_events.js` as the structured boundary for scar/title progression,
  vows, retirement, tournament injury/death, hero succession, season crowns, Hall of Fame induction,
  and Underrealm command synchronization/relinquishment.
- Existing compact messages, tournament seeding, duel resolution, progression deltas, governor
  decisions, and RNG order remain unchanged. Builders observe committed runtime state and never
  participate in fighter selection or consequence rolls.
- Tournament deaths retain the fatal fighter object when the outcome is selected, then emit only
  after population, jobs, social references, league champion, company roster, and Underrealm command
  cleanup. Retirement facts emit after eligibility and applicable command state are cleared.
- The season-crown fact emits after ranking, champion, tournament statistics, company roster and
  identity, and Hall of Fame state commit. Its typed consequences retain both champion status and the
  Hall of Fame induction.
- Eleven focused type fixtures validate actor/cause/consequence coverage, strict v1 shape, config
  importance, Hall of Fame evidence, and zero emission RNG. A real two-fighter deterministic
  tournament validates fatal cleanup/name retention, the crown, and committed Hall of Fame
  integration through `updateWarriors`.
- The two remaining `pushEvent` calls in `warriors.js` are deliberately legacy: the company doctrine
  operational summary and cross-cycle carry-over seed summary. The latter belongs to endgame; neither
  is a tournament, mark, vow, retirement, or Hall of Fame change.
- The pre/post deterministic `2 x 1000` profile is numerically identical: seed populations `18/30`,
  average population `24.0`, morale `0.8905`, hunger `0.1493`, thirst `0.1003`, with matching
  stockpile, Underrealm, and decree endpoints.
- Per ED-013, active config hash
  `8dc1cfe0e471a1222c5e380e79cd0c9332b77fb73485db140c3d8725f6e428c6` remains intentionally
  different from cached hash `752fdfc76240b106447411200689f6ca636f825334f4583bd0bb7baf47923620`.
  The stale cache remains excluded from report comparisons until final E1.2 refresh.

E1.2 political slice closure snapshot (2026-07-17):

- Added `src/simulation/political_events.js` as the structured boundary for doctrine and phase
  shifts, ritual-window opening, council ignition, ritual invocation/expiry, decree
  proposal/enactment/expiry, and schism climax start/resolution.
- All eleven former `pushEvent` sites in `schism.js` now emit canonical facts. Existing compact
  messages, doctrine and candidate selection, costs, pressure/legitimacy math, modifier resolution,
  and RNG order remain unchanged.
- Doctrine, phase, council, ritual/decree activation, and climax events emit after their counters,
  active state, and immediate deltas commit. Ritual/decree expiration retains a detached snapshot,
  archives bounded history, resets active state, and only then emits.
- Political actors use the Council of the Nine Braziers plus bounded ritual/decree institutions.
  Facts carry current pressure/legitimacy, previous doctrine/phase, season or expiry thresholds,
  option slates, immediate deltas, and typed active/resolved outcomes.
- Eleven focused type fixtures validate strict v1 shape, actor/cause/consequence coverage, bounded
  decree options, config importance, and zero emission RNG. Real runtime fixtures cover phase and
  climax start/resolution plus council ritual invocation, ritual expiry, decree expiry, history
  archival, and inactive-state commit.
- The pre/post deterministic `2 x 1000` profile is numerically identical: seed populations `18/30`,
  average population `24.0`, morale `0.8905`, hunger `0.1493`, thirst `0.1003`, with matching
  stockpile, Underrealm, and decree endpoints.
- Per ED-013, active config hash
  `4a33da3606928847cdc13b3904bd6f4aac2493c91c72cc3d46ae4d159a747b00` remains intentionally
  different from cached hash `752fdfc76240b106447411200689f6ca636f825334f4583bd0bb7baf47923620`.
  The stale cache remains excluded from report comparisons until final E1.2 refresh.

E1.2 endgame slice and priority-migration closure snapshot (2026-07-17):

- Added `src/simulation/endgame_events.js` as the structured boundary for individual artifact
  recovery, one-shot collection completion, fade start/completion, cycle closure, and Warrior
  Company carry-over.
- Artifact recovery emits after the ruins collection and counters commit, retaining the artifact,
  configured collection progress, and expedition depth. Collection completion emits only when
  `endgameArtifactsTick` first latches, including when the configured wait is zero.
- `app.js` emits presentation transition facts after fade state commits. Simulation reset remains in
  `endgame.js`; transition builders do not control phase timing, seed selection, or state replacement.
- Cycle closure and Warrior Company carry-over emit after the replacement state installs
  `cycleStats`, fixing the former legacy carry-over event's pre-install cycle identity. The existing
  bonus math, roster seeding, lineage archive, Hall of Fame carry, prestige, myths, messages, and RNG
  order remain unchanged.
- Six focused payload fixtures validate strict v1 shape, actors, locations, causes, consequences,
  source-cycle saga links, config importance, and zero emission RNG. A real two-reset fixture covers
  latch uniqueness, wait maturity, post-swap `cycle/tick/sequence` IDs, prestige/myth continuity,
  Warrior Company seeding, and absence of the former legacy carry-over event; a source guard keeps
  both private `app.js` fade hooks wired after their phase commits.
- The deterministic pre/post `2 x 1000` profile is exactly identical: seed populations `18/30`,
  average population `24.0`, morale `0.8905`, hunger `0.1493`, thirst `0.1003`, with matching
  stockpile, Underrealm, and decree endpoints.
- Per ED-013, final priority-producer closure refreshed the full `4 x 8000` cache. Frozen
  populations remain exactly `683/678/732/700` (average `698.25`), with morale `0.8851`, hunger
  `0.1575`, thirst `0.1083`, and Underrealm depth `2.25`; hash
  `e1519c0df9bd6c76c2d06de0f1f02f7cd2cddba47f426565c7ad5da3a4872656` passed the immediate
  aligned recheck. Aggregate contracts and terminal render smoke also pass.
- All six E1.2 priority families are now migrated. E1 remains open for secondary producers and Event
  Log presentation work in E1.3/E1.4.

### E1.3 Secondary producer migration

Status: `Done`

- [x] World events, external camps, caravans, merchants, and contracts.
- [x] Myths, alchemy, festivals, weather, and wildlife.
- [x] Construction, upgrades, villages, roads, temple stages, and resource milestones.
- [x] Add an audit that reports remaining legacy-only producers.

E1.3 closure snapshot (2026-07-17):

- Added `src/simulation/secondary_events.js` as the shared RNG-neutral boundary for secondary
  producer facts. It supplies stable actor/location helpers and signed resource consequences without
  participating in gameplay selection, costs, rewards, placement, or random rolls.
- Migrated world events, camps, caravans, merchants, contracts, myths, alchemy, festivals, weather,
  wildlife, construction/upgrades, villages, roads, Temple stages, ruins readiness, Underrealm
  discovery/Deep Lift/shrine milestones, deep resource finds, hunt deaths, and the final Warrior
  Company doctrine summary. Existing compact messages and authoritative mutation order remain intact.
- Added config-driven importance for narrative-sensitive secondary types. Routine weather/wildlife
  stays `ambient`; ordinary economy/culture milestones are `notable`; failures, unlocks, myths,
  villages, and Temple stages are `major`; full Temple completion is `legendary`.
- Added `scripts/audit_narrative_producers.js`, `npm run audit:narrative-producers`, and aggregate-test
  wiring. The audit reports approved structured boundary sites and fails on any direct simulation
  `pushEvent` call outside those boundaries; closure result is `structured=35 legacy=0`.
- A deterministic 2000-tick integration probe accepted `357` events across the migrated families
  with `rejected=0`, `legacyNormalized=0`, `truncated=0`, and `collisions=0`. The representative
  boundary fixture also proves strict v1 validity, actor/location/resource-fact retention, and zero
  emission RNG calls.
- The short `2 x 1000` profile remains exactly `18/30` population (average `24.0`), morale `0.8905`,
  hunger `0.1493`, and thirst `0.1003`. The full `4 x 8000` profile remains exactly
  `683/678/732/700` population (average `698.25`), morale `0.8851`, hunger `0.1575`, thirst `0.1083`,
  and Underrealm depth `2.25`.
- Refreshed the cached benchmark for config hash
  `5f7eb76f2a01df15bfc32eb814de4bb52e37efa73c16fa75160e1e33cb84e4be`; the immediate cache guard
  reports aligned. Aggregate contracts, terminal render smoke, and whitespace checks pass. E1
  remains open only for E1.4 Event Log presentation.

### E1.4 Event Log integration

Status: `Done`

- [x] Render importance, named actors, location, and saga membership without overcrowding the panel.
- [x] Keep the existing all/drama filters and define additional filters only after usage evidence.
- [x] Add a compact event-detail view or expandable row only if the terminal layout remains readable.
- [x] Preserve scroll behavior and bounded storage.

E1.4 closure snapshot (2026-07-17):

- Event rows now render a deterministic textual importance badge beside the tick. Major events keep
  warning emphasis; critical and legendary events use critical emphasis without embedding ANSI in
  retained narrative data.
- A compact wrapped context row exposes up to three unique named actors (plus a bounded `+N`
  remainder), location label/scope/coordinates, and stable saga membership. Retained actor labels
  take precedence over ID fallbacks; no separate identity cache or competing resolver was added.
- The existing `All events` and `Dwarf drama` filters, entry-based offset semantics, keyboard
  controls, newest-first order, and configured storage cap remain unchanged. No speculative filter
  or additional mutable detail-panel state was introduced.
- Mixed v0/v1 fixtures prove structured context, ambient legacy fallback, read-only rendering, and
  the minimum `72x18` layout without line overflow. `npm run test:narrative` and `npm test` pass.
- A deterministic `2 x 1000` benchmark retains exact E1.3 endpoints: populations `18/30` (average
  `24.0`), morale `0.8905`, hunger `0.1493`, and thirst `0.1003`. The cached `4 x 8000` baseline is
  still aligned because E1.4 changes only the renderer; terminal render smoke and syntax checks pass.
- No config value, simulation decision, RNG order, retained-event schema/cap, map export, telemetry,
  or AI observation/action shape changed. E1 is closed; E2.1 is the next executable step.

E1 exit criteria:

- [x] All priority producers emit valid structured events.
- [x] Legacy producers still render correctly through compatibility normalization.
- [x] Same-seed narrative event IDs and ordering are reproducible.
- [x] No simulation state or balance delta has been caused by the completed E1 migration.
- [x] README, MANUAL, parameter reference, telemetry reference, and project layout are updated for
      the completed E1 scope.

The contract, presentation, and non-regression exit evidence is complete. E1 is `Done`.

## 6) Workstream E2 - Identity, places, and readable actors

Status: `Done`

Objective: make events human-readable and give geography stable identity.

### E2.1 Shared identity resolver

Status: `Done`

- [x] Add one public helper for resolving dwarf display name, house, role title, and fallback ID.
- [x] Reuse the deterministic lore seed; do not create competing name generators.
- [x] Cache display identities safely for high-frequency render paths.
- [x] Define behavior for dead, retired, carried-over, or missing actors.

E2.1 closure snapshot (2026-07-17):

- Added `src/dwarf_identity.js` as the single public read model for stable ID, name, house, role
  title, formatted label, lifecycle status, and resolution provenance. It reuses `dwarf_lore.js` for
  live actors and never consumes RNG or mutates simulation state.
- Resolution order is explicit: live dwarf; supplied/retained event snapshot; bounded Hall of Fame
  or carry-over snapshot; `Unknown <id>`. Retired live dwarves remain readable, death facts retain
  their event label, carried champions retain name/house/title across cycle seeds, and truly missing
  actors never receive invented lore from the current cycle.
- Added a hard-capped operation cache with FIFO identity eviction plus bounded requested-ID live and
  historical indexes, and a `2048`-entry process cache limited to seed/ID-stable name/house fields.
  It does not copy the full population per render; dynamic status stays operation-local and cache
  entries are frozen.
- Integrated the resolver into Event Log actor context, Inspect and social links, lifecycle actor
  snapshots, Warrior League display wrappers, and Warrior telemetry. New Hall of Fame/carry-over
  records persist only three bounded identity strings; old records degrade safely.
- Focused contracts cover equal-seed identity, cache hits/hard caps, stable ID labels, living,
  retired, dead, carried-over, and missing actors, plus Hall of Fame snapshot commit.
- `npm run test:narrative` and `npm test` pass. The deterministic `2 x 1000` profile retains exact
  populations `18/30` (average `24.0`), morale `0.8905`, hunger `0.1493`, and thirst `0.1003`.
  No config, RNG order, simulation decision, event schema/cap, export, or AI shape changed.

### E2.2 Named event messages

Status: `Done`

- [x] Replace raw dwarf IDs in priority lifecycle/social/combat messages with display names.
- [x] Keep stable IDs available in structured actor references and detailed inspection.
- [x] Include house/clan/title only when it materially distinguishes the actor.
- [x] Add tests for newborn, deceased, retired, and unknown actor formatting.

E2.2 closure snapshot (2026-07-17):

- Added shared named-message formatting to the E2.1 identity boundary. Lifecycle, social, Dwarf
  Champion combat, and Warrior League emitters now replace raw dwarf IDs and full inspect labels
  immediately before `pushEvent`; producer mechanics and compact message intent remain unchanged.
- Canonical dwarf actor IDs, causes, consequences, event identity/order, and detailed Inspect labels
  remain intact. Only player-facing message text changes.
- Duplicate references to one actor are deduplicated. True equal-name collisions add `of House
  <house>` only when it distinguishes the actors, then fall back to stable ID only if still
  ambiguous. Tournament clan context remains because clan standings materially affect that story.
- Unknown historical actors use the explicit `Unknown <id>` fallback without nested replacements.
  Focused fixtures cover newborns, deceased actors, retired warriors, unknown actors, pair messages,
  champion appointment/fall, collision disambiguation, and duplicate-reference handling.
- A deterministic seed-`101`, `2000`-tick probe measured `165/165` retained priority messages with
  named dwarf references and `0` raw-ID references (`100%`, above the frozen `95%` target).
- `npm run test:narrative` and `npm test` pass. The deterministic `2 x 1000` benchmark retains exact
  balance endpoints; no config, RNG order, simulation decision, event schema/cap, export, telemetry
  metric, or AI observation/action shape changed.

### E2.3 Stable place identity

Status: `Done`

- [x] Generate deterministic names for villages, roads, major gates, lifts, ruins, and temple sites.
- [x] Store names in authoritative state instead of regenerating them in render code.
- [x] Reference place names in events, inspect views, telemetry, and chronicles.
- [x] Preserve compact fallback labels for narrow terminals.

E2.3 closure snapshot (2026-07-17):

- Added `state.places`, a schema-versioned plain-JSON registry with stable insertion order, ID lookup,
  scalar rejection diagnostics, and a hard `256`-record cap. Established records are never evicted
  or renamed; coordinate/depth refreshes preserve identity.
- Full names derive from the authoritative terrain seed, kind, stable ID, and committed spatial facts
  through a local hash and fixed vocabulary. The generator consumes no gameplay RNG. Every record
  also retains a compact label for narrow presentation.
- Initial state registers the Deep Gate and bounded depth ruins. Village founding, road completion,
  Temple site selection, and lift milestones register after authoritative state commits. Events
  snapshot stable `placeId` and names; Event Log prefers registry state, Inspect shows the nearest
  named village, and Underrealm/Temple telemetry share the same lookup.
- Chronicle runtime remains scheduled for E5; its contract is now explicit: consume retained event
  source IDs plus authoritative place IDs/names and never synthesize a second place identity.
- Focused contracts cover equal-seed generation, RNG isolation, stable re-registration, compact/full
  labels, serialization, hard-cap rejection, initial gate/ruins bootstrap, and authoritative Event
  Log lookup. A deterministic `2000`-tick probe produced `15` places across gate/ruins/Temple/
  village/road kinds, with `0` duplicate names, `0` rejected records, and `0` stale named-event
  locations. Deep Lifts are covered by their milestone registration contract because this probe did
  not reach a lift transition.
- `npm run test:narrative` and `npm test` pass. A deterministic repeated `1000`-tick run is byte-exact
  (SHA-256 `bafc98fd533ebe9e3b411d3ead950853893c5c9b8e9e3b4b56f8071cf71f7408`). No config,
  gameplay decision, RNG order, event-v1 schema/cap, map-export schema, or AI observation/action shape
  changed.

### E2.4 Priority visibility

Status: `Done`

- [x] Define story actor priority tiers for the bounded visible-dwarf selection.
- [x] Guarantee current critical/legendary actors are rendered when their layer is visible.
- [x] Prefer champions, endangered dwarves, saga protagonists, and current incident actors.
- [x] Keep selection stable enough to avoid visual flicker.

E2.4 closure snapshot (2026-07-17):

- Added one shared renderer selector with explicit tiers: recent critical/legendary event actors;
  endangered dwarves; active League/Deep champions; recent saga protagonists; current incident
  actors; the prior visible set; adults; other life stages. Surface and layer-local Underrealm
  candidate sets use the same ordering.
- The selector scans at most `160` newest retained events. Urgent and incident windows are `240`
  ticks; saga continuity is `1200` ticks. Only live, layer-eligible dwarf actors are retained. If a
  tier alone exceeds `maxVisible`, newest event/actor order wins without exceeding the configured
  cap.
- Previous visible order breaks equal-tier ties, so unchanged input returns the exact same ordered
  IDs. A new urgent actor preempts only the lowest selected tier. Stable population order is the
  final fallback; no render-time shuffle or gameplay RNG remains in `src/render/`.
- Focused above-cap contracts use `80` live dwarves with `maxVisible=6` and prove urgent child,
  endangered, champion, saga, incident, and retained actors fill the expected slots; a new legendary
  actor deterministically preempts the retained fallback. Hidden/unlimited caps and Underrealm-local
  ranking retain their contracts.
- A synthetic `240`-dwarf/`160`-event render probe with cap `60` measured selector mean `0.134 ms`,
  full-frame mean `0.865 ms`, and frame p95 `1.010 ms` over `300` frames, with `0` RNG calls. This is
  below the frozen E0 surface-build mean of `1.146 ms` and shows no material render regression.
- `npm run test:narrative` and `npm test` pass. Cached benchmark metadata remains aligned; config,
  structured-event retention, map-export schema, and AI observation/action shapes are unchanged.
  Removing the old view-layer shuffle intentionally ends presentation-dependent interactive RNG
  drift; headless simulation and balance decisions are unchanged.

E2 exit criteria:

- [x] Priority message named-actor share meets the frozen target.
- [x] Named locations are deterministic across equal seeds.
- [x] Identity resolution has no per-tick unbounded allocation hotspot.
- [x] Render-priority tests cover population above `display.dwarves.maxVisible`.

All E2 exit evidence is complete. E2 and M1 are `Done`.

## 7) Workstream E3 - Epic Story Director

Status: `Done`

Objective: aggregate events into readable arcs and choose what deserves observer attention.

### E3.1 Director state and configuration

Status: `Done`

- [x] Add bounded `state.story` runtime state with current focus, saga registry, cooldowns, and history.
- [x] Add config for importance thresholds, interruption budget, escalation, saga inactivity timeout,
      and history limits.
- [x] Keep story selection deterministic and isolated from gameplay RNG.
- [x] Exclude render timing and wall-clock time from story decisions.

E3.1 closure snapshot (2026-07-17):

- `src/simulation/story_director.js` owns a plain-JSON per-cycle schema with nullable focus, ordered
  saga registry, cooldowns, interruption budget, history, reason trace, cursor, and scalar counters.
- Configured storage limits are protected by absolute runtime ceilings (`64` sagas, `32` event refs
  per saga, `512` focus records, and `512` reason records), including malformed-state repair.
- Equal config creates byte-equal state without RNG; JSON round trips are stable; cycle reset drops
  all prior focus/saga/history state until E6 defines explicit bounded carry-over.
- Focus selection and saga aggregation remain intentionally empty here and belong to E3.2/E3.3.
- The refreshed `4 x 8000` cache retained the exact frozen endpoints (`683/678/732/700`, mean
  `698.3`); only config hash/timestamp changed. Active hash:
  `281d36086cbc4eb1c3383fc6a0c67d9009ee03ab044d10568d6b4236c85e398a`.

### E3.2 Event scoring and focus selection

Status: `Done`

- [x] Score events by severity, rarity, named actors, consequences, current saga, and player visibility.
- [x] Implement cooldown and escalation rules to prevent focus spam.
- [x] Allow critical events to preempt notable events deterministically.
- [x] Record the reason trace for every focus selection or suppression.

E3.2 closure snapshot (2026-07-17):

- Every committed canonical event reaches the Director directly, independently of Event Log
  retention, and advances one cycle/tick/sequence cursor that rejects duplicate replay.
- Additive config-driven scoring retains severity, inverse type frequency, named-actor,
  consequence, explicit current-saga, and active-layer visibility components in every bounded reason
  record. The per-cycle type-frequency registry is hard-capped at `256`.
- Ordinary focus protection, escalation cooldown, and rolling interruption budget prevent spam;
  deterministic fixtures prove `critical > notable` preemption, same-tier score ordering, budget
  exhaustion/reset, focus expiry, and explicit reasons for all selection/suppression paths.
- A deterministic 2000-tick producer probe considered all `462/462` accepted events with zero
  rejection, retained `6` completed focuses, capped trace at `160`, tracked `62` types, and serialized
  story state at `45,632` bytes.
- Repeated `2 x 1000` reports are byte-equal excluding timestamps. The refreshed `4 x 8000` profile
  retains exact endpoints (`683/678/732/700`, mean `698.3`); cache hash
  `2dca7eb6c6fe80e280fb701a963b89ebe38c6c349db225f3e155de46129d3118` is aligned.

### E3.3 Saga aggregation

Status: `Done`

- [x] Group causal events by actor, location, faction, threat, and explicit parent references.
- [x] Define deterministic saga lifecycle: opened, active, dormant, resolved, failed, archived.
- [x] Generate chapter summaries from facts, not unconstrained flavor text.
- [x] Keep chapter and saga lengths bounded by config.

E3.3 closure snapshot (2026-07-17):

- Every committed canonical fact is assigned after identity commit and before Event Log retention.
  Producer `sagaId` is authoritative, followed by parent-event causes, then weighted threat, faction,
  stable place, exact location, and typed actor evidence. Deterministic score/recency/ID tie-breaks
  generate monotonic per-cycle IDs without RNG or time sources.
- The lifecycle covers open, active, dormant, resolved, failed, and archived records. Inactivity,
  terminal type suffixes/tags, threat-destruction consequences, reactivation, and capacity eviction
  are config-driven and protected by hard runtime ceilings.
- Chapters retain only bounded source-event IDs plus sanitized opening/latest messages; summaries
  concatenate those facts and cannot invent narrative claims. Saga/evidence/chapter normalization,
  compaction, serialization, and malformed-state repair remain deterministic.
- A deterministic 2000-tick producer probe considered `418/418` accepted facts, retained the
  configured `24` sagas (`2` active, `16` open, `6` resolved), opened `28` chapters, reached maxima
  of `16` event refs and `5` chapters per saga, and serialized story state at `71,367` bytes.
- Repeated `2 x 1000` reports are byte-equal excluding timestamps. The refreshed `4 x 8000` profile
  retains exact endpoints (`683/678/732/700`, mean `698.3`); cache hash
  `aafb12c5a2522c1d7418ae3117ef1fb59b4cda15900440ba42c8a77c610b4bbf` is aligned.

### E3.4 Explainability and telemetry

Status: `Done`

- [x] Expose current saga, current focus, interruption cooldown, and selection reason.
- [x] Add a Story Director section to the telemetry reference when metrics become player-facing.
- [x] Add headless report counters for focus coverage, suppressed events, and saga resolution.

E3.4 closure snapshot (2026-07-17):

- `src/telemetry/story_director.js` owns read-only Story Director rows plus benchmark counter
  aggregation. The Data Center page exposes current focus, focus score/source/reason, current saga,
  saga lifecycle/summary, focus and escalation cooldowns, interruption budget, latest decision trace,
  selection/suppression totals, priority context coverage, and saga outcome counts.
- Headless benchmark report schema is now `2`. JSON, Markdown, and table outputs include Story
  Director focus coverage, critical/legendary selection coverage, priority context coverage,
  suppressed/preempted totals, opened/resolved/failed/archived/evicted saga totals, and terminal/opened
  saga rate. The balance gate score remains unchanged.
- Priority context coverage is counted when a critical/legendary event has actor plus spatial/place
  context or an explicit world scope. This matches the global major-event focus target while leaving
  ordinary events out of the gate.
- Focused telemetry contracts validate current focus/saga/reason rows, Data Center page wiring,
  bounded panel width, priority context counters, cycle-reset-safe headless aggregation, and no
  double-counting across sampled ticks.
- Repeated `2 x 1000` reports are deterministic excluding timestamps. The refreshed `4 x 8000`
  cached profile retains exact endpoints (`683/678/732/700`, mean `698.3`, morale `0.8851`, hunger
  `0.1575`, thirst `0.1083`) with schema `2` and cache hash
  `aafb12c5a2522c1d7418ae3117ef1fb59b4cda15900440ba42c8a77c610b4bbf`.
- Full Story Director report totals: `120/12637` selected, `12517` suppressed, `7` preempted,
  critical `4/4`, legendary `4/4`, priority context `8/8`, sagas opened `2850`, resolved `134`,
  failed `6`, archived `2754`, evicted `2754`, terminal/opened `4.9%`.

E3 exit criteria:

- [x] Critical/legendary focus coverage reaches target.
- [x] Same-seed focus decisions and saga-ID generation pass deterministic tests.
- [x] Interruption budget and escalation rules pass deterministic tests.
- [x] Story state remains bounded over a multi-cycle long run.

Post-E3 implementation watchlist:

- **Narrative test-suite growth:** `scripts/test_narrative_contracts.js` is `3436` lines after E3.4.
  Before adding another substantial narrative domain, review whether its fixtures belong in a focused
  suite with a thin aggregate runner. Preserve the current single-command `npm test` gate and avoid
  duplicating shared deterministic fixtures during any split.
- **Story module cohesion:** `src/simulation/story_director.js` is `779` lines and
  `src/simulation/story_sagas.js` is `574` lines. E4 must consume their read-only outputs without
  adding presentation logic to either module. Reassess module boundaries before E5 adds Chronicle
  consumers or any new scoring, lifecycle, or retention responsibility.
- **Saga churn and narrative usefulness:** the E3.4 full profile opened `2850` sagas, reached only
  `140` terminal outcomes (`4.9%`), and archived/evicted `2754`. Boundedness passes, but E4/E5 must
  sample whether these results represent useful arcs rather than false fragmentation or premature
  eviction. Do not use saga-derived Chronicle claims as a quality signal until this review passes.
- **Focus selectivity and watchability:** the same profile selected `120/12637` considered events and
  suppressed `12517`, while retaining `100%` critical/legendary coverage. E4 must validate through
  runtime observation and supported-width captures that the selected moments are understandable,
  well paced, and materially useful; counter coverage alone is not an experience gate.
- **Change-set reviewability:** today's checkpoints were retained in four broad commits. Future work
  should prefer checkpoint-scoped commits and implementation-log entries when practical, especially
  when code, tuning, telemetry, and presentation can be reviewed independently. This is a delivery
  hygiene requirement and must not force unsafe partial commits.

## 8) Workstream E4 - Cinematic terminal presentation

Status: `Not started`

Objective: make important events immediately visible while preserving the terminal-first interface.

### E4.1 Story ribbon

- [ ] Add a compact in-map story ribbon for the current major event or saga beat.
- [ ] Show actor, action, place, and consequence in that order when width permits.
- [ ] Define narrow-terminal fallbacks and collision rules with existing overlays.
- [ ] Do not duplicate the Data Center inside the ribbon.
- [ ] Sample selected and suppressed moments in real seeded runs; record whether focus pacing and
  narrative relevance support the E3.4 counters rather than relying on coverage alone.
- [ ] Keep ribbon formatting and layout outside Story Director scoring/saga modules; consume only
  read-only focus and saga state.

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
- [ ] Review saga samples, terminal/opened rate, archive/eviction causes, and false-fragmentation risk
  before treating saga membership as a Chronicle retention or quality signal.

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

E1.2 narrative benchmark cadence:

- Do not repeat the full `4 x 8000` profile after every presentation-only producer migration.
- During each purely narrative E1.2 slice, use focused producer/contract tests, `npm test`, a
  deterministic `2 x 1000` parity smoke, and the relevant runtime render smoke.
- Promote the slice immediately to `4 x 8000` when it changes gameplay decisions, RNG call
  count/order, policy contracts, benchmark-relevant configuration, or a material simulation hot path.
- Otherwise run one full `4 x 8000` cached-baseline refresh and aligned recheck when all E1.2
  priority producers close, before marking E1.2 Done.
- If a presentation-only config addition changes the config hash during an intermediate slice, record
  the temporary cache mismatch and do not use the stale cache for report-to-report claims; refresh it
  at E1.2 closure or sooner if another full-profile trigger applies.

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
| ER-001 | Narrative state becomes another unbounded log | Medium | High | Hard caps, compaction, source references, long-run size assertions | Mitigated through E3.3; monitor Chronicle/legacy consumers |
| ER-002 | Story Director creates constant interruptions | High | High | Importance threshold, cooldown budget, escalation, suppression trace, telemetry/report visibility | Mitigated through E3.4; monitor E4 presentation |
| ER-003 | Structured-event migration changes simulation behavior | Low | High | Backward-compatible wrapper, presentation-only tests, end-state parity | Mitigated; E1 closed |
| ER-004 | Display-name resolution becomes a render hotspot | Low | Medium | Stable cached identity resolver, bounded event scan, and allocation/performance probes | Mitigated through E2.4; monitor Story Director consumers |
| ER-005 | Chronicle flavor invents unsupported facts | Medium | High | Fact templates bound to structured source events; integrity tests | Open |
| ER-006 | Multi-cycle legacy creates runaway bonuses | Medium | High | Bounded modifiers, diminishing returns, 2/5-cycle gates | Open |
| ER-007 | Camera refactor couples world size to terminal size incorrectly | Medium | High | Overlay-first milestone; explicit architecture decision checkpoint | Open |
| ER-008 | Landmark footprints break placement/pathing/export | Medium | Medium | Reuse temple pattern, deterministic placement scenarios, export tests | Open |
| ER-009 | New threats make stable colonies unrecoverable | Medium | High | Staged rollout, recovery windows, cached benchmark and collapse blockers | Open |
| ER-010 | AI observes a world contract that changed silently | Low | High | Shape contracts, compatibility classification, explicit fresh-training gate | Open |
| ER-011 | Place identity grows without bounds or diverges between UI consumers | Low | Medium | Hard-capped authoritative registry, RNG-neutral deterministic names, stable IDs, serialization and UI lookup contracts | Mitigated through E2.3; monitor Chronicle integration |
| ER-012 | Capped rendering hides urgent actors or flickers as population grows | Low | High | Shared deterministic priority tiers, layer eligibility, prior-set stability, urgent preemption, and above-cap contracts | Mitigated through E2.4; monitor Story Director focus integration |
| ER-013 | Narrative contract tests become a monolithic maintenance bottleneck | Medium | Medium | Review thematic suite boundaries before the next substantial narrative domain; retain shared fixtures and one aggregate gate | Monitoring from E4 |
| ER-014 | Story Director and saga modules accumulate presentation or Chronicle responsibilities | Medium | Medium | Keep E4 read-only, preserve module ownership, and reassess boundaries before E5 expansion | Monitoring from E4 |
| ER-015 | High saga churn produces fragmented or prematurely evicted history | Medium | High | Sample seeded arcs, report terminal/opened and eviction causes, and gate Chronicle reliance on a quality review | Monitoring through E4; gate E5 |
| ER-016 | Excellent priority coverage masks poor focus pacing or low-value selected moments | Medium | High | Pair counters with runtime observation, supported-width captures, and selected/suppressed event sampling | Monitoring through E4 |

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
| 2026-07-17 | ED-011 | Canonicalize every accepted legacy call centrally while retaining strings only in the HUD mini-log and full v1 objects in the bounded Event Log | Keep four-field Event Log records until each producer migrates; duplicate legacy and structured pipelines | Creates one deterministic substrate immediately without forcing a risky 116-call-site migration | Runtime event architecture | Approved |
| 2026-07-17 | ED-012 | Centralize lifecycle payload construction and emit settlement founding at cycle tick 0 before the first simulation advance | Build narrative payloads inline in population logic; emit founding during state construction or at tick 1 | Keeps producer mechanics readable, preserves correct installed cycle identity after resets, and adds no RNG or decision changes | E1.2 lifecycle architecture and determinism | Approved |
| 2026-07-17 | ED-013 | Use focused tests plus `2 x 1000` parity smokes for presentation-only E1.2 slices and reserve `4 x 8000` for risk triggers or final E1.2 closure | Run `4 x 8000` after every producer slice; use only contract fixtures until final closure | Keeps iteration proportional while retaining a full long-horizon parity gate where it adds decision value | E1.2 validation cadence and benchmark cost | Approved |
| 2026-07-17 | ED-014 | Emit social narrative facts only after the existing incident transaction commits and keep selection mechanics unaware of the event builder | Build events before effects; combine narrative generation with weighted incident selection | Preserves gameplay/RNG behavior and lets retained facts describe authoritative outcomes | E1.2 social-drama boundary and determinism | Approved |
| 2026-07-17 | ED-015 | Snapshot combat participants before authoritative removal and emit structured facts only after the existing outcome commits | Emit before combat resolution; reconstruct victims from surviving state; mix event construction into combat selection | Preserves historical names and causal outcomes without changing RNG, combat decisions, or compact messages | E1.2 combat boundary and determinism | Approved |
| 2026-07-17 | ED-016 | Treat the completed tournament transaction as the Warrior League narrative boundary; retain fatal fighters before removal and emit death/crown facts after cleanup and Hall of Fame commit | Emit fatal outcomes inside the duel roll; emit the crown before rankings/company history settle; make event builders participate in tournament resolution | Preserves historical identities and authoritative league outcomes without changing RNG, tournament mechanics, or compact messages | E1.2 Warrior League boundary and determinism | Approved |
| 2026-07-17 | ED-017 | Keep political selection/mutation in `schism.js`, emit transitions after commit, and archive/reset expiring ritual or decree state before emitting from detached snapshots | Let event builders select doctrine/decrees; emit expiration before history/reset; reconstruct expired labels from cleared state | Preserves exact governance mechanics and RNG while making retained political facts authoritative and replayable | E1.2 political boundary and determinism | Approved |
| 2026-07-17 | ED-018 | Treat artifact latching and UI fades as pre-reset facts, but emit cycle closure and carry-over only after the replacement state installs its completed-cycle counter | Emit every fact before reset; let carry-over emit during helper mutation; preserve the legacy pre-install identity | Keeps the fade readable in the departing hold while ensuring durable closure/carry-over IDs belong to the authoritative new cycle at tick 0 | E1.2 endgame boundary and cross-cycle identity | Approved |
| 2026-07-17 | ED-019 | Use one shared secondary-event boundary plus a zero-legacy source audit while leaving producer mechanics in their thematic modules | Add one bespoke event-builder module per secondary system; keep compatibility-normalized string producers indefinitely | Gives broad E1.3 coverage with consistent actor/location/resource facts, avoids duplicating envelope boilerplate, and makes future regression visible in `npm test` | E1.3 secondary migration and enforcement | Approved |
| 2026-07-17 | ED-020 | Render structured context as a compact wrapped row beneath each Event Log message and retain only all/drama filters | Add another modal/detail state; add importance/actor/location filters immediately; replace compact messages with dense cards | Exposes E1 facts at the minimum layout without new mutable UI state or unevidenced filter complexity | E1.4 Event Log presentation | Approved |
| 2026-07-17 | ED-021 | Resolve dwarf presentation through one read-only helper with operation-scoped bounded caches and historical identity snapshots | Keep per-consumer lore calls; use an unbounded state cache; regenerate missing cross-cycle actors with the current terrain seed | Keeps identity coherent, avoids stale/unbounded runtime state, and prevents invented cross-cycle names | E2.1 shared identity architecture | Approved |
| 2026-07-17 | ED-022 | Rewrite raw dwarf references at the event-builder presentation boundary and add house/ID context only for real ambiguity | Rewrite mechanics-layer strings everywhere; include full name/house/title/ID in every message; drop stable structured IDs | Isolates display changes from simulation logic, keeps compact messages readable, and preserves machine identity | E2.2 named-message presentation | Approved |
| 2026-07-17 | ED-023 | Store deterministic place identity in one bounded authoritative state registry and make render/telemetry/Chronicle consumers resolve stable place IDs | Generate names independently in each renderer; store names only in event strings; add an unbounded spatial history | Keeps place names coherent and serializable without gameplay RNG, protects narrow layouts with stored compact labels, and gives future Chronicle claims stable references | E2.3 place identity architecture | Approved |
| 2026-07-17 | ED-024 | Rank capped surface and Underrealm dwarf candidates through one RNG-free story-priority selector with bounded event windows and prior-set tie stability | Keep adult-first random fill; pin only champions; let each layer invent independent priority rules; exceed the cap for urgent events | Guarantees the most important live actors when capacity permits, makes saturation deterministic, prevents flicker, and removes presentation-dependent gameplay RNG drift without changing AI or headless simulation | E2.4 priority visibility architecture | Approved |
| 2026-07-17 | ED-025 | Install a per-cycle plain-JSON Story Director schema with configured limits plus absolute hard caps, and defer all cross-cycle carry-over to E6 | Retain live event objects; allow config-only unbounded storage; copy active story state through reset | Gives E3.2/E3.3 one deterministic repairable substrate while preventing malformed config/state growth and premature legacy semantics | E3.1 state ownership, serialization, reset, and AI isolation | Approved |
| 2026-07-17 | ED-026 | Feed committed canonical events directly into a deterministic additive scorer, and allow only threshold-qualified stronger events to preempt under cooldown and rolling budget | Poll the Event Log; use random tie-breaks; let score alone replace any active focus; bypass budgets for all critical events | Direct commit sees events even with zero UI retention, canonical order is reproducible, and severity gates plus explicit component traces keep interruption behavior bounded and explainable | E3.2 scoring, focus lifecycle, and event-runtime boundary | Approved |
| 2026-07-17 | ED-027 | Assign sagas by explicit ID, parent cause, then weighted retained evidence; derive bounded chapters only from canonical messages and use deterministic lifecycle/eviction | Generate arcs from flavor text; group every shared system actor; retain whole events; use random similarity ties; carry sagas across cycles now | Makes causal ownership explicit, prevents invented history and broad false merges, bounds memory, preserves reproducibility, and leaves cross-cycle legacy to E6 | E3.3 saga aggregation, lifecycle, and factual integrity | Approved |
| 2026-07-17 | ED-028 | Expose Story Director state through a read-only telemetry/report helper and version the headless report schema for new story counters | Build display rows inside the scorer; infer metrics from Event Log retention; change balance-gate scoring; wait for E4 ribbon before any visibility | Keeps observability deterministic and reusable, avoids coupling presentation to selection logic, gives benchmark evidence without affecting tuning gates, and lets cache refresh on report-shape drift | E3.4 explainability, Data Center, and headless reporting | Approved |

## 17) Implementation log

Add one row for every implementation or validation cycle. Keep artifact paths only while they remain
within the repository retention policy.

| Date | ID | Scope | Files | Validation | Result | Artifacts / notes |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-07-16 | EW-000 | Initialize Epic Evolution workbook, baseline inventory, dependency plan, gates, risks, and documentation indexes | `docs/EPIC_EVOLUTION_WORKBOOK.md`, `AGENTS.md`, `README.md`, `MANUAL.md` | Markdown/link review, `git diff --check`, `npm test` | Done | Planning-only change; no simulation/config/policy behavior changed |
| 2026-07-16 | EW-001 | E0.1 freeze: align cached benchmark, fingerprint repo/config/policy/layout/screenshots, measure retained event-log distribution at `1000/8000` ticks, and isolate frame-build/output-write timings | `benchmark_cache/headless_benchmark_baseline.json`, `benchmark_cache/headless_benchmark_baseline.md`, `debug/epic_baseline_summary.json`, `debug/epic_baseline_summary.md`, `docs/EPIC_EVOLUTION_WORKBOOK.md` | `npm run bench:ensure-baseline` (refresh + aligned recheck), deterministic 4-seed probe, JSON parse, `git diff --check`, `npm test` | Done | No seed collapse; long log saturated `1200/1200`, raw-ID share `38.50%`; surface build mean `1.146 ms`, Inspect max seed p95 `7.832 ms` |
| 2026-07-16 | EW-002 | E0.2 contract: specify the v1 narrative envelope, deterministic IDs/order, legacy normalization, typed reference bounds, independent retention, serialization ceiling, and E0.3 acceptance matrix | `docs/NARRATIVE_EVENT_CONTRACT.md`, `docs/EPIC_EVOLUTION_WORKBOOK.md`, `AGENTS.md`, `README.md`, `MANUAL.md` | Contract consistency audit, documentation index review, `git diff --check`, `npm test` | Done | Specification-only change; no config, runtime, simulation, rendering, export, or AI behavior changed |
| 2026-07-16 | EW-003 | E0.3 executable contracts: add strict v1 validation/identity helpers, malformed fixtures, legacy/retention checks, mixed v0/v1 renderer checks, and AI/export isolation gates | `src/simulation/narrative_contract.js`, `scripts/test_narrative_contracts.js`, `package.json`, `docs/NARRATIVE_EVENT_CONTRACT.md`, `docs/EPIC_EVOLUTION_WORKBOOK.md`, `AGENTS.md`, `README.md`, `MANUAL.md` | `node --check src/simulation/narrative_contract.js`, `node --check scripts/test_narrative_contracts.js`, `npm run test:narrative`, `npm test`, `git diff --check` | Done | Focused and aggregate suites pass; malformed fixtures fail with deterministic diagnostics; no event-runtime/config/AI/export behavior changed |
| 2026-07-17 | EW-004 | E1.1 structured event core: wire canonical normalization/validation into `pushEvent`, add config importance precedence, initialize event clock/diagnostics, preserve legacy UI paths, and extend integration gates | `src/simulation/events.js`, `src/simulation/narrative_contract.js`, `src/simulation/narrative_normalizer.js`, `src/state/index.js`, `config.json`, `scripts/test_narrative_contracts.js`, `docs/PARAMETERS.md`, `docs/NARRATIVE_EVENT_CONTRACT.md`, `docs/EPIC_EVOLUTION_WORKBOOK.md`, `AGENTS.md`, `README.md`, `MANUAL.md` | `node --check`, `npm run test:narrative`, `npm test`, short two-seed benchmark, cached-baseline refresh + aligned recheck, E0.1 frozen-metric comparison, terminal render smoke, `git diff --check` | Done | Canonical v1 runtime active; deterministic IDs/retention/collisions/AI isolation pass; full profile exactly matches frozen balance endpoints because emission consumes no RNG and changes no simulation decisions |
| 2026-07-17 | EW-005 | E1.2 lifecycle slice: migrate settlement founding, births, natural deaths, and first-mutual-bond partnerships to canonical facts without changing simulation decisions | `src/simulation/lifecycle_events.js`, `src/simulation/population.js`, `src/simulation/index.js`, `src/state/index.js`, `config.json`, `scripts/test_narrative_contracts.js`, `docs/PARAMETERS.md`, `docs/NARRATIVE_EVENT_CONTRACT.md`, `docs/EPIC_EVOLUTION_WORKBOOK.md`, `AGENTS.md`, `README.md`, `MANUAL.md` | Lifecycle integration fixtures, `npm run test:narrative`, aggregate contracts, short two-seed benchmark, cached-baseline refresh + aligned recheck, terminal render smoke, `git diff --check` | Done | Lifecycle facts are canonical and RNG-neutral; full `4 x 8000` endpoints exactly match E0.1/E1.1, cache hash `752fdfc76240b106447411200689f6ca636f825334f4583bd0bb7baf47923620` is aligned, and AI/export shapes remain unchanged |
| 2026-07-17 | EW-006 | E1.2 social-drama slice: migrate mentorship breakthroughs, rivalry clashes, grudge escalations, and reconciliations to canonical facts after incident commit | `src/simulation/social_events.js`, `src/simulation/social_drama.js`, `config.json`, `scripts/test_narrative_contracts.js`, `docs/PARAMETERS.md`, `docs/NARRATIVE_EVENT_CONTRACT.md`, `docs/EPIC_EVOLUTION_WORKBOOK.md`, `AGENTS.md`, `README.md`, `MANUAL.md` | Four-type emitter fixtures, real social-runtime integration fixture, `npm run test:narrative`, `npm test`, deterministic `2 x 1000` parity smoke, terminal render smoke, `git diff --check` | Done | All four social facts are canonical and emission is RNG-neutral; pre/post `2 x 1000` endpoints match exactly, AI/export contracts pass, and the intentional cache-hash mismatch is recorded under ED-013 without a long refresh |
| 2026-07-17 | EW-007 | E1.2 combat slice: migrate surface raids, ruins expeditions, depth-champion encounters, hostile deep raids, and Dwarf Champion transitions after authoritative outcomes | `src/simulation/combat_events.js`, `src/simulation/raids.js`, `src/simulation/ruins.js`, `src/simulation/underrealm.js`, `config.json`, `scripts/test_narrative_contracts.js`, `docs/PARAMETERS.md`, `docs/NARRATIVE_EVENT_CONTRACT.md`, `docs/EPIC_EVOLUTION_WORKBOOK.md`, `AGENTS.md`, `README.md`, `MANUAL.md` | Twelve-type combat fixtures, real raid-resolution integration fixture, `npm run test:narrative`, `npm test`, deterministic pre/post `2 x 1000`, terminal render smoke, `git diff --check` | Done | All twelve combat facts are canonical and emission is RNG-neutral; pre/post `2 x 1000` endpoints match exactly, AI/export contracts pass, terminal smoke passes, and the intentional cache mismatch is recorded under ED-013 without a long refresh |
| 2026-07-17 | EW-008 | E1.2 Warrior League slice: migrate marks, vows, tournament consequences, retirements, hero succession, season crowns, Hall of Fame induction, and command transitions after authoritative updates | `src/simulation/warrior_events.js`, `src/simulation/warriors.js`, `config.json`, `scripts/test_narrative_contracts.js`, `docs/PARAMETERS.md`, `docs/NARRATIVE_EVENT_CONTRACT.md`, `docs/EPIC_EVOLUTION_WORKBOOK.md`, `AGENTS.md`, `README.md`, `MANUAL.md` | Eleven-type emitter fixtures, real deterministic fatal-duel/tournament/Hall of Fame integration fixture, `npm run test:narrative`, `npm test`, deterministic pre/post `2 x 1000`, terminal render smoke, `git diff --check` | Done | All eleven Warrior League facts are canonical and RNG-neutral; pre/post `2 x 1000` endpoints match exactly, existing Warrior contracts and AI/export isolation pass, terminal smoke passes, and the intentional cache mismatch is recorded under ED-013 without a long refresh |
| 2026-07-17 | EW-009 | E1.2 political slice: migrate schism doctrine/phase, ritual windows and lifecycle, council decree lifecycle, and climax start/resolution after authoritative updates | `src/simulation/political_events.js`, `src/simulation/schism.js`, `config.json`, `scripts/test_narrative_contracts.js`, `docs/PARAMETERS.md`, `docs/NARRATIVE_EVENT_CONTRACT.md`, `docs/EPIC_EVOLUTION_WORKBOOK.md`, `AGENTS.md`, `README.md`, `MANUAL.md` | Eleven-type emitter fixtures, real deterministic phase/climax and ritual/decree archival fixtures, `npm run test:narrative`, `npm test`, deterministic pre/post `2 x 1000`, terminal render smoke, `git diff --check` | Done | All eleven political facts are canonical and RNG-neutral; every former `schism.js` producer is migrated, pre/post `2 x 1000` endpoints match exactly, AI/export contracts and terminal smoke pass, and the intentional cache mismatch is recorded under ED-013 without a long refresh |
| 2026-07-17 | EW-010 | E1.2 endgame slice and priority-family closure: migrate artifact recovery/collection, presentation transitions, cycle closure, and Warrior Company carry-over with authoritative cross-cycle identity | `src/simulation/endgame_events.js`, `src/simulation/endgame.js`, `src/simulation/ruins.js`, `src/simulation/warriors.js`, `app.js`, `config.json`, `scripts/test_narrative_contracts.js`, `benchmark_cache/`, `docs/PARAMETERS.md`, `docs/NARRATIVE_EVENT_CONTRACT.md`, `docs/EPIC_EVOLUTION_WORKBOOK.md`, `AGENTS.md`, `README.md`, `MANUAL.md` | Six-type RNG-neutral fixtures, real two-reset/latch/carry-over integration, `npm run test:narrative`, `npm test`, deterministic pre/post `2 x 1000`, final cached `4 x 8000` refresh + aligned recheck, terminal render smoke, `git diff --check` | Done | All endgame priority facts are canonical; post-swap IDs use cycles 3/4 at tick 0 in the multi-cycle fixture; short and full profiles retain exact frozen endpoints; cache hash `e1519c0df9bd6c76c2d06de0f1f02f7cd2cddba47f426565c7ad5da3a4872656` is aligned; E1.2 is closed |
| 2026-07-17 | EW-011 | E1.3 secondary-producer closure: migrate world/diplomacy, culture/environment, and development/resource facts; enforce zero direct legacy producers | `src/simulation/secondary_events.js`, secondary producer modules, `src/simulation/warrior_events.js`, `scripts/audit_narrative_producers.js`, `scripts/test_narrative_contracts.js`, `package.json`, `config.json`, `benchmark_cache/`, narrative/docs/layout references | Zero-legacy audit, RNG-neutral boundary fixture, deterministic 2000-tick event diagnostic, `npm run test:narrative`, `npm test`, `2 x 1000`, `4 x 8000`, cache refresh + aligned recheck, terminal render smoke, `git diff --check` | Done | Audit reports `structured=35 legacy=0`; 2000-tick diagnostic accepted 357 events with zero rejection/legacy normalization; short/full endpoints exactly match frozen values; cache hash `5f7eb76f2a01df15bfc32eb814de4bb52e37efa73c16fa75160e1e33cb84e4be` is aligned; E1.3 is closed |
| 2026-07-17 | EW-012 | E1.4 Event Log closure: expose importance, named actors, place, and saga context in responsive wrapped rows while preserving legacy display, filters, scrolling, and storage | `src/render/event_log_panel.js`, `scripts/test_narrative_contracts.js`, narrative/product/operations docs | Syntax checks, mixed v0/v1 and `72x18` renderer fixtures, `npm run test:narrative`, `npm test`, deterministic `2 x 1000`, cached-baseline aligned guard, terminal render smoke, `git diff --check` | Done | Structured facts render without retained-record mutation or new UI state; short endpoints remain exact; AI/export contracts pass; E1 is closed and E2.1 is ready |
| 2026-07-17 | EW-013 | E2.1 shared identity resolver: unify live/historical dwarf labels, bounded render caches, and Hall of Fame/carry-over snapshots across Event Log, Inspect, lifecycle, Warrior League, and telemetry | `src/dwarf_identity.js`, identity consumers, `src/dwarf_lore.js`, `scripts/test_narrative_contracts.js`, narrative/product/operations/layout docs | Syntax checks, living/retired/dead/carried-over/missing fixtures, cache cap/determinism assertions, Hall snapshot integration, `npm run test:narrative`, `npm test`, deterministic `2 x 1000`, cached-baseline guard, terminal render smoke, `git diff --check` | Done | One RNG-neutral resolver is authoritative; exact short endpoints and AI/export contracts pass; E2.1 is closed and E2.2 is ready |
| 2026-07-17 | EW-014 | E2.2 named messages: replace raw dwarf references across priority lifecycle/social/combat/Warrior presentation while retaining canonical actor IDs and compact ambiguity rules | `src/dwarf_identity.js`, priority event builders, `scripts/test_narrative_contracts.js`, narrative/product/operations docs | Syntax checks, newborn/deceased/retired/unknown/collision fixtures, deterministic 2000-tick coverage probe, `npm run test:narrative`, `npm test`, deterministic `2 x 1000`, cached-baseline guard, terminal render smoke, `git diff --check` | Done | Coverage is `165/165` named and `0` raw (`100%`); exact short endpoints and AI/export contracts pass; E2.2 is closed and E2.3 is ready |
| 2026-07-17 | EW-015 | E2.3 stable place identity: persist deterministic full/compact names for villages, roads, Deep Gate/lifts, ruins, and Temple sites; share them across events and UI | `src/place_identity.js`, state/simulation producers, Event Log/Inspect/telemetry consumers, `scripts/test_narrative_contracts.js`, narrative/product/operations/layout docs | Syntax checks, deterministic/RNG/cap/serialization/renderer fixtures, deterministic 2000-tick place probe, repeated exact 1000-tick run, `npm run test:narrative`, `npm test`, cached-baseline guard, terminal render smoke, `git diff --check` | Done | Probe retained 15 places with 0 duplicate names/rejections/stale named-event locations; repeated run hash is exact; config, simulation decisions, v1/AI/export shapes remain unchanged; E2.3 closed here and E2.4 was subsequently completed in EW-016 |
| 2026-07-17 | EW-016 | E2.4 priority visibility and M1 closure: share deterministic story tiers across capped surface/deep dwarf rendering and remove render-time gameplay RNG | `src/render/dwarf_visibility.js`, `src/render/index.js`, `scripts/test_narrative_contracts.js`, product/parameter/narrative/operations/layout docs | Syntax checks, 80-dwarf above-cap/preemption/stability/layer/RNG fixtures, 240-dwarf selector and 300-frame performance probe, `npm run test:narrative`, `npm test`, deterministic `2 x 1000`, cached-baseline guard, terminal render smoke, `git diff --check` | Done | Cap-6 fixture retains all six required tier representatives; selector mean 0.134 ms, frame mean/p95 0.865/1.010 ms, RNG calls 0; AI/export/config contracts remain stable; E2 and M1 are closed, with E3.1 next |
| 2026-07-17 | EW-017 | E3.1 Director substrate: add bounded per-cycle story state, config normalization, malformed-state repair, clean reset, and explicit RNG/time/AI isolation | `src/simulation/story_director.js`, `src/state/index.js`, `config.json`, `scripts/test_narrative_contracts.js`, `benchmark_cache/`, parameter/narrative/product/operations/layout docs | Syntax checks, bounded/serialization/reset/RNG/time/AI fixtures, `npm run test:narrative`, `npm test`, deterministic `2 x 1000`, cached-baseline refresh + aligned recheck, terminal render smoke, `git diff --check` | Done | No focus is selected before E3.2; hard caps protect saga/history/reason storage; story state resets per cycle and remains outside PPO/map export; exact `4 x 8000` endpoints retained; cache hash `281d36086cbc4eb1c3383fc6a0c67d9009ee03ab044d10568d6b4236c85e398a` aligned |
| 2026-07-17 | EW-018 | E3.2 deterministic scoring/focus: consume committed facts, score six explicit components, enforce focus/escalation cooldowns and rolling interruption budget, and trace every decision | `src/simulation/story_director.js`, `src/simulation/events.js`, `src/simulation/index.js`, `config.json`, `scripts/test_narrative_contracts.js`, `benchmark_cache/`, parameter/narrative/product/operations/layout docs | Formula/preemption/cooldown/budget/expiry/cursor/retention/RNG fixtures, 2000-tick boundedness probe, `npm test`, repeated `2 x 1000`, cached `4 x 8000` refresh + aligned recheck, terminal render smoke, `git diff --check` | Done | Probe considered `462/462` facts with trace capped at `160` and story state `45,632` bytes; repeated short reports exact; full endpoints exact; cache hash `2dca7eb6c6fe80e280fb701a963b89ebe38c6c349db225f3e155de46129d3118` aligned; E3.3 ready |
| 2026-07-17 | EW-019 | E3.3 deterministic saga aggregation: group committed facts by explicit/causal/weighted evidence, advance bounded lifecycles, and retain fact-backed chapters | `src/simulation/story_sagas.js`, `src/simulation/story_director.js`, `src/simulation/events.js`, `config.json`, `scripts/test_narrative_contracts.js`, `benchmark_cache/`, parameter/narrative/product/operations/layout docs | Grouping/ID/lifecycle/chapter/cap/serialization/RNG fixtures, 2000-tick boundedness probe, `npm test`, repeated `2 x 1000`, cached `4 x 8000` refresh + aligned recheck, terminal render smoke, `git diff --check` | Done | Probe retained 24 bounded sagas and 28 chapters in 71,367 bytes; repeated short reports exact; full endpoints exact; cache hash `aafb12c5a2522c1d7418ae3117ef1fb59b4cda15900440ba42c8a77c610b4bbf` aligned; E3.4 ready |
| 2026-07-17 | EW-020 | E3.4 Story Director explainability: expose current focus/saga/cooldowns/reasons in Data Center and add deterministic headless focus/context/saga counters | `src/telemetry/story_director.js`, `src/telemetry/telemetry.js`, `src/telemetry/telemetry_panel.js`, `src/simulation/story_director.js`, `scripts/headless_benchmark.js`, `scripts/ensure_benchmark_baseline.js`, `scripts/test_narrative_contracts.js`, `benchmark_cache/`, telemetry/narrative/product/operations/layout docs | Story telemetry/report fixtures, syntax checks, `npm test`, repeated deterministic `2 x 1000`, cached `4 x 8000` schema-2 refresh + aligned recheck, terminal render smoke, `git diff --check` | Done | Full report: critical `4/4`, legendary `4/4`, priority context `8/8`, selected `120/12637`, suppressed `12517`, preempted `7`, sagas `2850` opened / `140` terminal; endpoints and cache hash unchanged; E3 is closed and E4.1 is ready |

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
- [ ] The change set is checkpoint-scoped and reviewable, or the implementation log records why a
  broader atomic commit was safer.
- [ ] Debug artifacts are cleaned according to repository retention rules.

A milestone is Done only when every included workstream is Done, its release validation tier passes,
and no open High-impact risk is unmitigated.

## 20) Next execution queue

Execute one bounded step at a time:

1. [x] `E0.1` - Freeze repository, benchmark, event-distribution, screenshot, and render-time baseline.
2. [x] `E0.2` - Finalize the structured event envelope and deterministic ID rules.
3. [x] `E0.3` - Add executable narrative contract tests.
4. [x] `E1.1` - Implement the backward-compatible structured event core.
5. [x] `E1.2 / lifecycle` - Migrate founding, birth, natural-death, and partnership events and
   validate short-run end-state parity.
6. [x] `E1.2 / social drama` - Migrate mentorship, rivalry, grudge, and reconciliation events after
   the lifecycle full-profile gate is closed.
7. [x] `E1.2 / combat` - Migrate surface raids, ruins expeditions, Underrealm fights, and champion
   changes.
8. [x] `E1.2 / Warrior League` - Migrate tournaments, scars, vows, retirements, and Hall of Fame
   changes.
9. [x] `E1.2 / political` - Migrate schism phases, rituals, decrees, and climax resolution.
10. [x] `E1.2 / endgame` - Migrate artifact completion, cycle closure, transition, and carry-over.
11. [x] `E1.3 / secondary producers` - Migrate world events, camps, caravans, merchants, contracts,
    myths, alchemy, festivals, weather, wildlife, construction, villages, roads, temple stages, and
    resource milestones; add the remaining-legacy producer audit.
12. [x] `E1.4 / Event Log integration` - Render importance, actors, location, and saga membership while
    preserving filters, scrolling, bounded storage, and narrow-terminal readability.
13. [x] `E2.1 / shared identity resolver` - Resolve stable dwarf names, houses, role titles, and
    fallbacks for living, dead, retired, carried-over, and missing actors.
14. [x] `E2.2 / named event messages` - Replace raw dwarf IDs in priority lifecycle, social, and
    combat messages while retaining stable IDs in structured actor references.
15. [x] `E2.3 / stable place identity` - Generate authoritative deterministic names for villages,
    roads, gates, lifts, ruins, and Temple sites, with compact render fallbacks.
16. [x] `E2.4 / priority visibility` - Guarantee current critical/legendary actors remain visible under
    the bounded render population cap, with stable priority selection.
17. [x] `E3.1 / Director state and configuration` - Add bounded deterministic Story Director runtime
    state and config without exposing it to PPO observations.
18. [x] `E3.2 / event scoring and focus selection` - Score canonical facts, enforce cooldown and
    escalation rules, and retain an explicit deterministic selection/suppression reason trace.
19. [x] `E3.3 / saga aggregation` - Group causal facts into bounded deterministic saga lifecycles and
    generate fact-backed chapter summaries.
20. [x] `E3.4 / explainability and telemetry` - Expose current saga/focus, cooldown state, selection
    reason, and bounded headless counters.
21. [ ] `E4.1 / Story ribbon` - Add compact in-map current-story presentation for the active major
    event or saga beat. **Next.**

The next implementation slice should remain deliberately narrow: present the already selected
Director focus/saga in the terminal view through a compact story ribbon. It should not include camera
work, persistent legacy, new combat systems, or AI shape changes.
