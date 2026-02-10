# Underrealm V2 Blueprint and Implementation Workbook

Status: Active (M0 completed, M1 completed, M2 completed, M3 completed, M4 completed, M5 completed, M6 completed, M7 completed)  
Owner: Codex + Project Maintainer  
Created: 2026-02-10  
Last updated: 2026-02-10  
Scope: Underrealm V2 (combat-centric progression, armory/equipment depth, readiness gates)

## 1. Purpose

This document is the single workbook for Underrealm V2.
It defines:
- requirements,
- architecture blueprint,
- implementation milestones,
- definition of done,
- decision log,
- execution log.

Rule: every implementation step must be logged here before and after execution.

## 2. Current Baseline (As-Is Snapshot)

Underrealm currently behaves as:
- economy/logistics progression with depth pressure,
- abstract deep hostile raids (no champion lifecycle),
- armory centered on expedition kits, not full combat gear progression,
- no strict floor readiness gate based on equipment score,
- limited combat depth observability for AI/regression.

This baseline is informational and will be refined when implementation begins.

## 3. Objectives (V2)

Primary objective:
- Make Underrealm materially impact gameplay through consistent combat progression.

Secondary objectives:
- Introduce armory progression and meaningful equipment stockpile loops.
- Gate floor progression with readiness checks to avoid guaranteed-failure runs.
- Keep systems deterministic enough for training and benchmark comparison.
- Preserve config-first tuning and telemetry clarity.

## 4. Non-Goals (for V2 initial delivery)

- No full tactical per-unit battlefield simulation.
- No real-time action combat controls.
- No major rewrite of unrelated surface systems.
- No broad UI redesign outside Underrealm/telemetry needs.

## 5. Requirements

### 5.1 Functional Requirements (FR)

- FR-01: Floors must support combat-based progression states (`locked`, `accessible`, `contested`, `cleared`).
- FR-02: Each floor must define a champion encounter required to unlock next floor progression.
- FR-03: Armory must support level progression with tier-gated craftables.
- FR-04: Equipment classes must include at least offensive gear, defensive gear, and expedition support loadout.
- FR-05: Underrealm expeditions must evaluate readiness against floor minimum threshold.
- FR-06: Expedition dispatch below hard minimum readiness must be blocked.
- FR-07: Dispatch in warning zone (above minimum, below recommended) must apply explicit risk penalties.
- FR-08: Champion outcomes must produce deterministic rewards/penalties (unlock, losses, loot, cooldown effects).
- FR-09: Telemetry must expose readiness, champion status, and floor progression state.
- FR-10: Existing Underrealm economy loop must remain compatible and stable after integration.
- FR-11: AI-observation payload must expose key new Underrealm combat signals.
- FR-12: Regression and benchmark tools must include Underrealm V2 metrics.

### 5.2 Non-Functional Requirements (NFR)

- NFR-01: Per-tick complexity must avoid new O(n^2) scans.
- NFR-02: Combat resolution must be deterministic given seed and config.
- NFR-03: Config remains single source of truth for tunables.
- NFR-04: Telemetry remains readable within configured terminal widths.
- NFR-05: No negative stockpiles introduced by new equipment loops.
- NFR-06: Logging remains compact and parse-friendly (`diag` compatibility).

### 5.3 Documentation Requirements (DOC)

- DOC-01: Update `docs/PARAMETERS.md` for all new config fields.
- DOC-02: Update `docs/TRAINING_OVERRIDES.md` for training-related knobs.
- DOC-03: Update `MANUAL.md` with operational formulas and tick behavior.
- DOC-04: Update `README.md` with high-level feature impact only.
- DOC-05: Update project layout references if files/folders change.

## 6. Proposed Domain Model (Blueprint)

### 6.1 Floor Progression Model

For each floor:
- `state`: `locked | accessible | contested | cleared`
- `readiness`: `minScore`, `recommendedScore`
- `champion`: stats profile + reward profile
- `encounter`: optional cooldown and retry metadata

### 6.2 Armory and Equipment Model

Armory:
- has level (`1..N`),
- each level unlocks recipes/tier ceilings,
- upgrade path uses time + resource costs.

Equipment outputs (initial abstraction):
- `weapon_tier_*` (offense contribution),
- `armor_tier_*` (defense contribution),
- `expedition_kit_tier_*` (support/survivability contribution).

### 6.3 Readiness Model

Reference formula (subject to balancing):
- `readinessScore = offense * W1 + defense * W2 + support * W3`

Dispatch policy:
- `readinessScore < minScore`: blocked.
- `minScore <= readinessScore < recommendedScore`: allowed with warning risk modifiers.
- `readinessScore >= recommendedScore`: normal/optimal encounter profile.

### 6.4 Champion Resolution Model

Champion encounter uses deterministic aggregated combat rounds:
- party effective power from readiness + context modifiers,
- champion effective power from floor profile + difficulty modifiers,
- outcome yields victory/retreat/defeat and deterministic losses/rewards.

## 7. Configuration Blueprint (to be implemented later)

Planned config areas:
- `underrealm.floors[].combat.*`
- `underrealm.floors[].readiness.*`
- `underrealm.floors[].champion.*`
- `structures.armory.levels[]`
- `resources.*` additions for gear/equipment outputs
- optional `underrealm.combat.global.*` safety caps

All new fields must be documented in `docs/PARAMETERS.md`.

## 8. Implementation Milestones

### M0 - Planning and Baseline Lock

Status:
- Completed (2026-02-10)

Deliverables:
- finalize blueprint choices,
- confirm formulas and constraints,
- lock success metrics and risk acceptance.

Validation:
- document review approval.

### M1 - Data Model and Config Scaffolding

Status:
- Completed (2026-02-10)

Deliverables:
- add config schema fields for floor combat/readiness/champions and armory levels,
- wire state initialization defaults.

Validation:
- app boot success,
- no runtime crashes from missing config fields.

### M2 - Armory Progression and Gear Production

Status:
- Completed (2026-02-10)

Deliverables:
- armory level upgrades,
- tier-gated gear crafting outputs,
- stockpile integration.

Validation:
- no negative stockpiles,
- deterministic craft outcomes.
- syntax/config checks passed (`node --check`, config JSON parse).
- headless benchmark short-run passed:
  - `node scripts/headless_benchmark.js --ticks 1600 --seeds 101,202,303,404 --resources expedition_kit,weapon_tier_1,armor_tier_1,weapon_tier_10,armor_tier_10 --set structures.armory.count=1 --set structures.armory.maxCount=1`
- targeted headless smoke runs passed:
  - 5200 ticks: armory reached level 9 and produced tiered equipment up to T8 in stock.
  - 9600 ticks: armory reached level 10 and produced T10 gear (`weapon_tier_10=3`, `armor_tier_10=3`).
  - level-10 gate check with capped lower tiers: deterministic T10 crafting confirmed.

### M3 - Readiness Gate and Dispatch Policy

Status:
- Completed (2026-02-10)

Deliverables:
- readiness score computation,
- hard block under min threshold,
- warning-zone risk behavior.

Validation:
- blocked dispatch works consistently,
- telemetry clearly reports readiness and gate state.
- syntax/config checks passed (`node --check`, config JSON parse).
- targeted readiness smoke scenarios passed:
  - blocked scenario (`min_score`) blocks dispatch and increments `underrealm.combat.stats.blockedDispatches`.
  - warning-zone scenario allows dispatch with warning metadata and risk multiplier.
  - recommended-ready scenario allows dispatch without extra risk.
- warning risk behavior check passed (A/B micro-rollout):
  - warning-zone dispatches produce higher failure rate than ready dispatches under equivalent room setup.
- deterministic benchmark short-run passed:
  - `node scripts/headless_benchmark.js --ticks 1200 --seeds 101,202,303,404 --resources expedition_kit,weapon_tier_1,armor_tier_1 --set structures.armory.count=1 --set structures.armory.maxCount=1`
- deterministic benchmark long-run passed:
  - `node scripts/headless_benchmark.js --ticks 8000 --seeds 101,202,303,404`
  - average snapshot: `pop=728.3`, `morale=0.8843`, `hunger=0.1541`, `thirst=0.1116`.
- AI non-regression suite passed:
  - `node scripts/regression.js`
  - all tracked thresholds `ok` (eval + randomized profiles).
- telemetry check passed:
  - Underrealm section now shows `Readiness gate: ...` with blocked/warning/ready state and floor depth context.

### M4 - Champion Encounters and Floor Unlock

Status:
- Completed (2026-02-10)

Deliverables:
- encounter lifecycle,
- deterministic combat resolution,
- floor clear unlock chain.

Validation:
- floor progression requires champion victory,
- failure/retreat paths stable and logged.
- syntax/config checks passed (`node --check`, config JSON parse).
- targeted champion-gate smoke scenarios passed:
  - victory scenario: contested floor champion defeated, floor marked `cleared`, and next depth unlocked.
  - defeat scenario: contested floor remains blocked, retry cooldown applied, and readiness gate records `champion_cooldown` blocked transitions.
- deterministic benchmark long-run passed:
  - `node scripts/headless_benchmark.js --ticks 8000 --seeds 101,202,303,404 --progress --progress-every 2000`
  - average snapshot: `pop=668.0`, `morale=0.8856`, `hunger=0.1546`, `thirst=0.1087`.
- AI non-regression suite passed:
  - `node scripts/regression.js`
  - all tracked thresholds `ok` (eval + randomized profiles).
- runtime smoke passed:
  - `npm start` (interactive render boot, manual interrupt after successful run).

### M5 - Telemetry and Rendering Integration

Status:
- Completed (2026-02-10)

Deliverables:
- Underrealm status lines for champion/readiness/progression,
- legend/panel coherence updates.

Validation:
- telemetry width compliance,
- no stale labels/inconsistent panel descriptions.
- syntax checks passed:
  - `node --check src/render/telemetry.js`
  - `node --check src/render/map_inset_panel.js`
  - `node --check src/render/telemetry_panel.js`
- telemetry width compliance checks passed (Underrealm stable rows):
  - baseline and contested champion scenarios validated at `columnWidth=42` with `over=0`.
- targeted telemetry smoke passed:
  - Underrealm section exposes stable compact rows for `Depth progression`, `Champion gate`, `Readiness gate`, and `Underrealm pressure`.
  - map inset shows deep combat cue tokens (`P:* C:* R:*`) without layout breakage.
- runtime smoke passed:
  - `npm start` (interactive render boot, manual interrupt after successful run).
- deterministic benchmark long-run passed:
  - `node scripts/headless_benchmark.js --ticks 8000 --seeds 101,202,303,404 --progress --progress-every 2000`
  - average snapshot: `pop=668.0`, `morale=0.8856`, `hunger=0.1546`, `thirst=0.1087`.
- AI non-regression suite passed:
  - `node scripts/regression.js`
  - all tracked thresholds `ok` (eval + randomized profiles).

### M6 - AI/Training/Regression Integration

Status:
- Completed (2026-02-10)

Deliverables:
- new observation features,
- training compatibility updates,
- regression/benchmark metric extensions.

Validation:
- shape compatibility checks,
- deterministic benchmark deltas reviewed seed-by-seed.
- syntax checks passed:
  - `node --check src/ai/observation.js`
  - `node --check ai_server.js`
  - `node --check scripts/headless_benchmark.js`
  - `node --check scripts/regression.js`
  - python AST parse smoke for `python/train.py` and `python/regression_rollout.py`
- observation/features alignment smoke passed:
  - underrealm payload keys present (`9`) and normalized in `[0,1]`,
  - feature vector shape aligned with config (`feature_count=36`, `vector_count=36`).
- training feature registry smoke passed:
  - resolved features `36`, invalid `0`, underrealm features exposed.
- model-shape compatibility check executed:
  - current `config` feature count `36` vs `models/policy_best.json` feature count `27`,
  - resume-incompatible change identified; `--fresh` retraining required for updated observation shape.
- deterministic benchmark comparison passed (seed-by-seed deltas reviewed):
  - `node scripts/headless_benchmark.js --ticks 8000 --seeds 101,202,303,404 --variant baseline --variant candidate --output table --progress --progress-every 2000`
  - baseline/candidate parity observed (delta `0` expected with identical config), with new underrealm KPI columns rendered.
- AI non-regression suite passed:
  - `node scripts/regression.js`
  - deterministic eval and randomized checks `ok`; report artifacts emitted under `debug/`.
- runtime smoke passed:
  - `npm start` (interactive render boot, manual interrupt after successful run).

### M7 - Documentation and Hardening

Status:
- Completed (2026-02-10)

Deliverables:
- README/MANUAL/docs updates,
- final balancing pass,
- final non-regression report.

Validation:
- checklist completion and sign-off.
- syntax/config sanity checks passed:
  - `node --check src/simulation/underrealm.js`
  - `node --check src/simulation/ruins.js`
  - `node --check src/render/telemetry.js`
  - `node --check scripts/headless_benchmark.js`
  - `node --check scripts/regression.js`
  - python AST parse smoke for `python/train.py` and `python/regression_rollout.py`
  - config JSON parse smoke
- deterministic benchmark long-run passed:
  - `node scripts/headless_benchmark.js --ticks 8000 --seeds 101,202,303,404 --progress --progress-every 2000`
  - average snapshot: `pop=668.0`, `morale=0.8856`, `hunger=0.1546`, `thirst=0.1087`, `underDepth=1.00`, `underChamp=0.00`, `underFail=0.50`, `underBlocked=2.00`, `underContested=1.00`, `underReady=0.749`.
- deterministic A/B comparison passed (seed-by-seed parity):
  - `node scripts/headless_benchmark.js --ticks 8000 --seeds 101,202,303,404 --variant baseline --variant candidate --output table --progress --progress-every 2000`
  - baseline/candidate deltas: all `0` (score, population, morale, hunger, thirst, resources, underrealm KPIs).
- AI non-regression suite passed:
  - `node scripts/regression.js`
  - eval summary: `avg_reward=9471.697`, `avg_steps=1200.000`, `avg_births=52.250`, `avg_deaths=2.300`, `score=3.947`.
  - randomized summary: `avg_reward=3945.070`, `avg_steps=520.000`, `avg_births=13.170`, `avg_deaths=0.540`, `stock_min=0.970`, `stock_avg=0.995`, `extinction=0.000`.
  - report artifacts:
    - `debug/regression_report_1770737512253.txt`
    - `debug/regression_report_1770737512253.json`
    - `debug/regression_report_1770737512253.md`
- runtime smoke passed:
  - `npm start` (interactive render boot, manual interrupt after successful run).
- balancing pass decision:
  - no default rebalance applied in M7 because benchmark/regression gates remained stable and deterministic.

## 9. Definition of Done (DoD)

### 9.1 Feature DoD

- All FR-01..FR-12 satisfied.
- No NFR violations in validation runs.
- No critical regressions in baseline benchmark seeds.
- Underrealm progression is materially combat-driven in practice.

### 9.2 Quality DoD

- `npm start` runs and renders telemetry/legend correctly.
- Deterministic benchmark executed:
  - `node scripts/headless_benchmark.js --ticks 8000 --seeds 101,202,303,404`
- A/B comparison executed for tuning deltas:
  - `node scripts/headless_benchmark.js --ticks 8000 --variant baseline --set path=value --variant candidate`
- Regression suite updated and executed with new Underrealm metrics.

### 9.3 Documentation DoD

- `README.md`, `MANUAL.md`, `docs/PARAMETERS.md`, `docs/TRAINING_OVERRIDES.md` updated.
- Project layout sections updated if files changed.
- This workbook log completed for each milestone.

## 10. Decision Log (ADR-lite)

Use one entry per decision.

Template:
- ID:
- Date:
- Status: proposed | accepted | superseded
- Context:
- Decision:
- Alternatives considered:
- Consequences:

Initial entries:

- ID: D-001
  Date: 2026-02-10
  Status: proposed
  Context: Underrealm progression currently economy-first.
  Decision: Make champion victory the primary floor progression gate, while keeping logistics gates as prerequisites.
  Alternatives considered: replace lift gates entirely; keep current model with stronger raid tuning only.
  Consequences: stronger gameplay identity, moderate integration cost.

- ID: D-002
  Date: 2026-02-10
  Status: proposed
  Context: Need impactful but stable combat model.
  Decision: deterministic aggregated combat rounds, not per-unit tactical simulation.
  Alternatives considered: stochastic encounter simulation with per-actor actions.
  Consequences: better determinism/performance, lower tactical granularity.

- ID: D-003
  Date: 2026-02-10
  Status: proposed
  Context: Exploration kits are currently low-impact constraints.
  Decision: evolve kits into part of a broader equipment readiness model with armory level gating.
  Alternatives considered: remove kits entirely; keep kits as binary requirement.
  Consequences: deeper prep gameplay, added balancing complexity.

- ID: D-004
  Date: 2026-02-10
  Status: accepted
  Context: M1 needs low-risk rollout with deterministic compatibility.
  Decision: introduce config/state scaffolding now (`underrealm.combat`, per-floor snapshots, armory level schema) without enabling new combat gating logic yet.
  Alternatives considered: implement combat gating in the same milestone; postpone all schema work until full combat implementation.
  Consequences: safer incremental delivery, docs/config/state forward-compatibility, no immediate gameplay behavior change.

- ID: D-005
  Date: 2026-02-10
  Status: accepted
  Context: M2 must make armory progression materially relevant and satisfy 10-level + all-minerals requirements.
  Decision: extend armory to 10 upgrade levels and gate recipe craftability using per-level mineral allow-lists; add tiered weapon/armor recipes (T1..T10) that collectively use all advanced minerals (`iron`, `mithril`, `mana_crystal`, `adamantio`, `embersteel`, `ironshade`) while preserving expedition-kit production as a legacy armory recipe.
  Alternatives considered: keep 4-level armory and only tune costs; tie tiers only to level without mineral gating; split kits into a separate structure.
  Consequences: deeper pre-combat logistics loop, stronger deterministic progression pacing, and higher balancing complexity for long-run economies.

- ID: D-006
  Date: 2026-02-10
  Status: superseded (by D-007)
  Context: M3 needs an actionable dispatch gate before champion encounters (M4), while preserving current ruins expedition loop.
  Decision: couple ruins expedition dispatch to Underrealm floor readiness (`roomIndex + 1` depth mapping), using hard block (`armory level` / `min_score`) and warning-zone risk multipliers for hazard/guardian/loss resolution.
  Alternatives considered: introduce a separate dedicated underrealm expedition loop first; postpone all dispatch gating until full champion system.
  Consequences: immediate gameplay impact with limited architectural churn, clearer telemetry gating, and higher short-run expedition volatility in warning zone.

- ID: D-007
  Date: 2026-02-10
  Status: accepted
  Context: M4 requires champion-gated floor progression without introducing a brand-new expedition subsystem.
  Decision: keep ruins expedition loop as the combat carrier, but map expedition depth to `max(roomDepth, currentFrontierDepth)` so repeated expeditions can contest frontier champions; enforce per-floor encounter cooldown via readiness gate blocking (`champion_cooldown`) and unlock next floor only on champion victory.
  Alternatives considered: keep strict `roomIndex + 1` mapping; add a dedicated underrealm expedition queue separate from ruins.
  Consequences: strong gameplay impact with contained integration cost, deterministic unlock chain behavior, and clearer failure/cooldown telemetry for tuning.

- ID: D-008
  Date: 2026-02-10
  Status: accepted
  Context: M5 must expose champion/readiness/progression clearly without destabilizing telemetry layout widths.
  Decision: keep Underrealm section fixed to 9 stable rows, prioritize compact combat-centric lines (`Depth progression`, `Champion gate`, `Readiness gate`, `Underrealm pressure`), and add short deep-combat tokens (`P:* C:* R:*`) in map inset instead of long verbose text.
  Alternatives considered: increase Underrealm row count with full verbose metrics; add a separate large Underrealm-only panel.
  Consequences: better scanability and width safety on narrow columns, with reduced verbosity in base telemetry rows.

- ID: D-009
  Date: 2026-02-10
  Status: accepted
  Context: M6 must expose Underrealm V2 combat progression to PPO/regression while preserving deterministic comparability and parser stability.
  Decision: add a compact normalized Underrealm observation pack (9 signals) into JS/Python observation pipelines, extend benchmark/regression outputs with explicit underrealm KPIs, and keep summary log format backward-compatible by appending an `under=` section rather than replacing existing fields.
  Alternatives considered: keep Underrealm signals telemetry-only (no training feed); introduce a larger/raw combat state vector; fork regression output format for Underrealm-specific runs.
  Consequences: improved policy visibility and tunability with controlled shape change; existing checkpoints become resume-incompatible and require `--fresh` retraining when new features are enabled.

- ID: D-010
  Date: 2026-02-10
  Status: accepted
  Context: M7 requires a final balancing pass after M1..M6 integration, without introducing avoidable late-stage drift before retraining.
  Decision: freeze current gameplay defaults (no additional balance edits) because deterministic benchmark and regression gates remained stable across standard seeds and A/B parity checks.
  Alternatives considered: force a final tuning tweak despite stable metrics; defer hardening sign-off pending additional exploratory retuning.
  Consequences: V2 closes on a reproducible, non-regressed baseline; further balancing work can be scheduled as explicit post-M7 scope.

## 11. Risks and Mitigations

- R-01: Over-gating can stall progression.
  - Mitigation: keep hybrid gating, tune min/recommended thresholds, add recovery loops.
- R-02: Snowball rewards make late game trivial.
  - Mitigation: diminishing returns and capped reward multipliers.
- R-03: AI policy degradation from observation changes.
  - Mitigation: explicit shape/version checks, fresh training when needed.
- R-04: Telemetry bloat.
  - Mitigation: compact labels, prioritize actionable metrics.
- R-05: Regression blind spots.
  - Mitigation: add Underrealm-specific KPIs to regression and benchmark outputs.

## 12. Validation Plan

Short-run checks:
- startup/render sanity,
- no crashes on resize,
- no negative stockpile values.

Mid-run checks:
- readiness gates trigger as designed,
- champion outcomes consistent with expected power deltas.

Long-run checks:
- deterministic benchmark stability,
- no sustained collapse across standard seeds unless intended.

## 13. Implementation Workbook Log

Usage rule:
- Before a step: add plan intent.
- After a step: add outcome, touched files, validation commands, result.

Entry template:
- Step ID:
- Date:
- Milestone:
- Intent:
- Changes made:
- Files touched:
- Validation commands:
- Outcome:
- Follow-ups:

Execution log:

- Step ID: S-000
  Date: 2026-02-10
  Milestone: M0
  Intent: Create blueprint workbook only.
  Changes made: Added `underrealm_v2.md` with requirements, milestones, DoD, decision log, risk/validation framework.
  Files touched: `underrealm_v2.md`
  Validation commands: none
  Outcome: completed (planning artifact ready).
  Follow-ups: wait for explicit implementation confirmation.

- Step ID: S-001
  Date: 2026-02-10
  Milestone: M1
  Intent: Start M1 scaffolding pass (config schema + runtime state defaults only, no gameplay-combat behavior change).
  Changes made: Planning intent logged before code updates.
  Files touched: `underrealm_v2.md`
  Validation commands: none
  Outcome: completed.
  Follow-ups: execute implementation and validation for M1.

- Step ID: S-002
  Date: 2026-02-10
  Milestone: M1
  Intent: Complete M1 deliverables end-to-end with docs/workbook sync.
  Changes made:
  - Added `underrealm.combat` config scaffold (readiness/encounter/floor champion templates and overrides).
  - Added armory multi-level schema scaffold in `structures.armory` (`levelMax`, upgrade fields, per-level unlock metadata).
  - Wired state initialization defaults for underrealm combat floors and mirrored floor snapshots into `underrealm.layers[].combat`.
  - Added runtime repair scaffolding for underrealm combat state to preserve compatibility.
  - Initialized `armory.level` metadata on structure creation paths.
  - Updated technical docs and project layout references (`AGENTS.md`, `README.md`, `MANUAL.md`, `docs/PARAMETERS.md`).
  Files touched:
  - `config.json`
  - `src/state/index.js`
  - `src/simulation/underrealm.js`
  - `src/simulation/structures.js`
  - `docs/PARAMETERS.md`
  - `README.md`
  - `MANUAL.md`
  - `AGENTS.md`
  - `underrealm_v2.md`
  Validation commands:
  - `node --check src/state/index.js`
  - `node --check src/simulation/underrealm.js`
  - `node --check src/simulation/structures.js`
  - `node -e "JSON.parse(require('fs').readFileSync('config.json','utf8')); console.log('config ok')"`
  - `node -e "const { loadConfig } = require('./src/config'); const { createInitialState } = require('./src/state'); const cfg = loadConfig(); const runtime = { gridWidth: 120, gridHeight: 40, playableArea: 120*40, mapInset: null }; const state = createInitialState(cfg, runtime); const floors = state.underrealm && state.underrealm.combat && state.underrealm.combat.floorsByDepth ? Object.keys(state.underrealm.combat.floorsByDepth).length : 0; console.log('boot ok floors=', floors);"`
  - `npm start` (interactive smoke, manual interrupt after successful render boot)
  Outcome: completed (code + docs + runtime smoke).
  Follow-ups: run `npm start` smoke and state boot check, then proceed to M2 only with explicit confirmation.

- Step ID: S-003
  Date: 2026-02-10
  Milestone: M2
  Intent: Start M2 implementation (10-level armory progression + tiered weapon/armor crafting with mineral-gated recipes and stockpile integration).
  Changes made: planning intent logged before code updates.
  Files touched: `underrealm_v2.md`
  Validation commands: none
  Outcome: completed.
  Follow-ups: implement code + docs and run validation.

- Step ID: S-004
  Date: 2026-02-10
  Milestone: M2
  Intent: Complete M2 deliverables end-to-end (10-level armory progression, tiered gear production, stockpile + docs/workbook sync).
  Changes made:
  - Expanded armory upgrade schema to 10 levels with explicit per-level costs/ticks and mineral allow-lists.
  - Added tiered armory outputs and labels in stockpile (`weapon_tier_1..10`, `armor_tier_1..10`).
  - Added deterministic armory equipment catalog (`structures.armory.equipment`) with craft order and recipe metadata.
  - Refactored armory job assignment to schedule craftable recipes by priority with level/mineral gates and stock caps.
  - Included armory in structure-upgrade scheduling and generalized armory job payload metadata.
  - Updated docs (`docs/PARAMETERS.md`, `MANUAL.md`, `README.md`) for M2 behavior and layout references.
  Files touched:
  - `config.json`
  - `src/simulation/jobs.js`
  - `docs/PARAMETERS.md`
  - `MANUAL.md`
  - `README.md`
  - `underrealm_v2.md`
  Validation commands:
  - `node --check src/simulation/jobs.js`
  - `node --check src/simulation/underrealm.js`
  - `node --check src/state/index.js`
  - `node -e "JSON.parse(require('fs').readFileSync('config.json','utf8')); console.log('config ok')"`
  - `node scripts/headless_benchmark.js --ticks 1600 --seeds 101,202,303,404 --resources expedition_kit,weapon_tier_1,armor_tier_1,weapon_tier_10,armor_tier_10 --set structures.armory.count=1 --set structures.armory.maxCount=1`
  - targeted headless smoke (5200 ticks) -> `armory_level=9`, mid/high tiers produced
  - targeted headless smoke (9600 ticks) -> `armory_level=10`, `weapon_tier_10=3`, `armor_tier_10=3`
  - targeted headless negative-stockpile check (3000 ticks) -> `negative_stockpile_count=0`
  - level-10 gate verification smoke with lower tiers capped -> deterministic T10 production confirmed
  - `npm start` (interactive smoke, manual interrupt after successful render boot)
  Outcome: completed (M2 delivered and validated).
  Follow-ups: M3 requires explicit confirmation.

- Step ID: S-005
  Date: 2026-02-10
  Milestone: M3
  Intent: Start M3 implementation (readiness score + dispatch gate + warning-risk behavior) and wire telemetry observability.
  Changes made: planning intent logged before M3 code/doc updates.
  Files touched: `underrealm_v2.md`
  Validation commands: none
  Outcome: completed.
  Follow-ups: execute M3 implementation + validations + docs.

- Step ID: S-006
  Date: 2026-02-10
  Milestone: M3
  Intent: Complete M3 end-to-end (runtime gate logic, risk behavior, telemetry, docs, workbook sync).
  Changes made:
  - Added readiness formula tunables in config (`underrealm.combat.readiness.formula.*`).
  - Implemented readiness-gated dispatch in ruins loop:
    - floor-depth mapping (`roomIndex + 1`),
    - readiness score computation (offense/defense/support weighted mix),
    - hard blocking (`min_score` / `min_armory_level`),
    - warning-zone dispatch with explicit risk multiplier.
  - Added runtime readiness snapshots (`state.ruins.readinessGate`) and blocked-dispatch accounting (`underrealm.combat.stats.blockedDispatches` transitions).
  - Applied warning risk multiplier to expedition hazard chance, guardian effective power, and failure-loss severity.
  - Updated Underrealm telemetry to expose gate state (`Readiness gate: ...`) in stable rows.
  - Synced docs (`docs/PARAMETERS.md`, `docs/TRAINING_OVERRIDES.md`, `MANUAL.md`, `README.md`).
  Files touched:
  - `config.json`
  - `src/state/index.js`
  - `src/simulation/underrealm.js`
  - `src/simulation/ruins.js`
  - `src/render/telemetry.js`
  - `docs/PARAMETERS.md`
  - `docs/TRAINING_OVERRIDES.md`
  - `MANUAL.md`
  - `README.md`
  - `underrealm_v2.md`
  Validation commands:
  - `node --check src/simulation/ruins.js`
  - `node --check src/render/telemetry.js`
  - `node --check src/state/index.js`
  - `node --check src/simulation/underrealm.js`
  - `node -e "JSON.parse(require('fs').readFileSync('config.json','utf8')); console.log('config ok')"`
  - targeted readiness gate smoke scenarios (blocked / warning / ready) via headless tick script
  - warning-risk behavior A/B micro-run (`warning_t1` vs `ready_t3`) with elevated hazard setup
  - `node scripts/headless_benchmark.js --ticks 1200 --seeds 101,202,303,404 --resources expedition_kit,weapon_tier_1,armor_tier_1 --set structures.armory.count=1 --set structures.armory.maxCount=1`
  - telemetry section smoke (`buildTelemetrySections`) confirming `Readiness gate:` line rendering
  - `npm start` (interactive smoke, manual interrupt after successful render boot)
  Outcome: completed (M3 delivered and validated).
  Follow-ups: execute full-length benchmark + AI non-regression suite and append results to workbook log.

- Step ID: S-007
  Date: 2026-02-10
  Milestone: M3
  Intent: Complete post-M3 hardening checks required by quality checklist (interactive smoke, long-run deterministic benchmark, AI non-regression).
  Changes made:
  - Executed `npm start` interactive smoke and confirmed map/telemetry/legend render without startup crashes.
  - Executed long-run deterministic benchmark (`8000` ticks, seeds `101,202,303,404`) and collected stable averages.
  - Executed regression harness (`scripts/regression.js`) and verified all configured tolerance checks returned `ok`.
  - Synced workbook validation notes for M3 with long-run and non-regression results.
  Files touched:
  - `underrealm_v2.md`
  Validation commands:
  - `npm start` (interactive smoke, manual interrupt after successful render boot)
  - `node scripts/headless_benchmark.js --ticks 8000 --seeds 101,202,303,404`
  - `node scripts/regression.js`
  Outcome:
  - completed.
  - benchmark avg snapshot: `pop 728.3`, `morale 0.8843`, `beerBoost 0.0188`, `hunger 0.1541`, `thirst 0.1116`, `beer 35342.5`, `food 816.1`, `water 891.5`.
  - regression summary:
    - eval: `avg_reward 9493.039`, `avg_steps 1200.000`, `avg_births 51.375`, `avg_deaths 2.425`, `score 3.955` (`ok` on all eval gates).
  - randomized: `avg_reward 3944.685`, `avg_steps 520.000`, `stock_min 0.970`, `stock_avg 0.995`, `extinction 0.000` (`ok` on all random gates).
  Follow-ups: M4 requires explicit confirmation.

- Step ID: S-008
  Date: 2026-02-10
  Milestone: M4
  Intent: Start M4 implementation (champion encounter lifecycle, combat resolution, and unlock chain integration with existing ruins dispatch).
  Changes made: planning intent logged before M4 code/doc updates.
  Files touched:
  - `underrealm_v2.md`
  Validation commands: none
  Outcome: completed.
  Follow-ups: execute M4 implementation + validations + docs.

- Step ID: S-009
  Date: 2026-02-10
  Milestone: M4
  Intent: Complete M4 end-to-end (champion encounter lifecycle, deterministic combat outcomes, and floor unlock chain).
  Changes made:
  - Added Underrealm combat runtime normalization and floor-state lifecycle support (`locked|accessible|contested|cleared`) with fallback repair for missing per-depth combat nodes.
  - Updated deep-lift progression to stop at contested champion floors and only unlock next depth after champion clear.
  - Integrated champion dispatch constraints in ruins expedition start path:
    - readiness-gate extension with `champion_cooldown` blocked reason,
    - frontier-depth mapping for repeated champion attempts,
    - floor readiness snapshot/runtime gate persistence.
  - Implemented deterministic champion encounter resolution:
    - readiness-derived party attack/defense/support contribution,
    - champion round loop and outcome (`victory|retreat|defeat|cooldown`),
    - deterministic retry cooldown and casualty hinting,
    - champion victory unlock chain update + stats/event accounting.
  - Synced telemetry formatting for champion cooldown gate visibility (`Readiness gate: ... BLOCKED champion cd ...`).
  - Synced docs/workbook for active M4 behavior (`README.md`, `MANUAL.md`, `docs/PARAMETERS.md`, `docs/TRAINING_OVERRIDES.md`, `underrealm_v2.md`).
  Files touched:
  - `src/simulation/underrealm.js`
  - `src/simulation/ruins.js`
  - `src/state/index.js`
  - `src/render/telemetry.js`
  - `README.md`
  - `MANUAL.md`
  - `docs/PARAMETERS.md`
  - `docs/TRAINING_OVERRIDES.md`
  - `underrealm_v2.md`
  Validation commands:
  - `node --check src/simulation/underrealm.js`
  - `node --check src/simulation/ruins.js`
  - `node --check src/state/index.js`
  - `node --check src/render/telemetry.js`
  - `node -e "JSON.parse(require('fs').readFileSync('config.json','utf8')); console.log('config ok')"`
  - targeted champion victory smoke (contested floor clear unlocks next depth)
  - targeted champion defeat/cooldown smoke (cooldown gate blocks dispatch and increments blocked stats)
  - `node scripts/headless_benchmark.js --ticks 8000 --seeds 101,202,303,404 --progress --progress-every 2000`
  - `node scripts/regression.js`
  - `npm start` (interactive smoke, manual interrupt after successful render boot)
  Outcome:
  - completed.
  - champion chain behavior validated:
    - victory scenario: `maxUnlockedDepth` advanced from 1 to 2, `championsDefeated=1`, floor marked `cleared`.
    - defeat scenario: floor remained `contested`, retry cooldown persisted, `blockedDispatches` increased, `lastBlockedReason=champion_cooldown`.
  - benchmark avg snapshot:
    - `pop 668.0`, `morale 0.8856`, `beerBoost 0.0203`, `hunger 0.1546`, `thirst 0.1087`, `beer 41214.9`, `food 709.0`, `water 861.8`.
  - regression summary:
    - eval: `avg_reward 9471.697`, `avg_steps 1200.000`, `avg_births 52.250`, `avg_deaths 2.300`, `score 3.947` (`ok` on all eval gates).
    - randomized: `avg_reward 3945.070`, `avg_steps 520.000`, `stock_min 0.970`, `stock_avg 0.995`, `extinction 0.000` (`ok` on all random gates).
  Follow-ups: M5 requires explicit confirmation.

- Step ID: S-010
  Date: 2026-02-10
  Milestone: M5
  Intent: Start M5 implementation (telemetry/render integration for champion/readiness/progression with panel coherence).
  Changes made: planning intent logged before M5 code/doc updates.
  Files touched:
  - `underrealm_v2.md`
  Validation commands: none
  Outcome: completed.
  Follow-ups: execute M5 implementation + validations + docs.

- Step ID: S-011
  Date: 2026-02-10
  Milestone: M5
  Intent: Complete M5 end-to-end (Underrealm status lines, panel coherence, width-safe rendering).
  Changes made:
  - Refactored stable Underrealm telemetry rows to combat-centric fixed layout:
    - `Depth progression`, `Champion gate`, `Readiness gate`, `Underrealm pressure`.
  - Added compact Underrealm telemetry helpers:
    - frontier progression status,
    - frontier champion gate lifecycle/cooldown summary,
    - readiness fallback when ruins gate snapshot is unavailable,
    - compact pressure aggregation (ward/oath/threats).
  - Shortened role-ratio telemetry wording to maintain narrow-column width safety.
  - Added map inset deep-combat cue line with compact tokens:
    - progression `P:*`, champion `C:*`, readiness `R:*`.
  - Updated telemetry panel subtitle for coherence with new combat-gate emphasis.
  - Synced docs/workbook for active M5 behavior (`README.md`, `MANUAL.md`, `underrealm_v2.md`).
  Files touched:
  - `src/render/telemetry.js`
  - `src/render/map_inset_panel.js`
  - `src/render/telemetry_panel.js`
  - `README.md`
  - `MANUAL.md`
  - `underrealm_v2.md`
  Validation commands:
  - `node --check src/render/telemetry.js`
  - `node --check src/render/map_inset_panel.js`
  - `node --check src/render/telemetry_panel.js`
  - telemetry width checks (baseline + contested champion scenarios at `columnWidth=42`)
  - targeted telemetry smoke (`buildTelemetrySections`) for Underrealm rows
  - `npm start` (interactive smoke, manual interrupt after successful render boot)
  - `node scripts/headless_benchmark.js --ticks 8000 --seeds 101,202,303,404 --progress --progress-every 2000`
  - `node scripts/regression.js`
  Outcome:
  - completed.
  - telemetry rows now consistently expose champion/readiness/progression in fixed positions.
  - width compliance validated for Underrealm rows in baseline and contested champion scenarios (`over=0`).
  - benchmark avg snapshot:
    - `pop 668.0`, `morale 0.8856`, `beerBoost 0.0203`, `hunger 0.1546`, `thirst 0.1087`, `beer 41214.9`, `food 709.0`, `water 861.8`.
  - regression summary:
    - eval: `avg_reward 9471.697`, `avg_steps 1200.000`, `avg_births 52.250`, `avg_deaths 2.300`, `score 3.947` (`ok` on all eval gates).
  - randomized: `avg_reward 3945.070`, `avg_steps 520.000`, `stock_min 0.970`, `stock_avg 0.995`, `extinction 0.000` (`ok` on all random gates).
  Follow-ups: M6 requires explicit confirmation.

- Step ID: S-012
  Date: 2026-02-10
  Milestone: M6
  Intent: Start M6 implementation (AI observation/training integration + benchmark/regression extensions for Underrealm V2 signals).
  Changes made: planning intent logged before M6 code/doc updates.
  Files touched:
  - `underrealm_v2.md`
  Validation commands: none
  Outcome: completed.
  Follow-ups: execute M6 implementation + validations + docs.

- Step ID: S-013
  Date: 2026-02-10
  Milestone: M6
  Intent: Complete M6 end-to-end (observation expansion, training compatibility wiring, regression/benchmark KPI integration, docs/workbook sync).
  Changes made:
  - Added normalized Underrealm observation pack to JS AI observation (`depth/champion progression`, `frontier contested`, `cooldown`, `readiness score/gap`, `blocked/warning`, `combat pressure`).
  - Extended AI server payload/debug bridges to expose Underrealm observation metrics consistently.
  - Extended Python trainer feature registry/mapping and compact summary diagnostics with Underrealm metrics (`under=` section).
  - Added Underrealm KPI families to regression parsing/output and headless benchmark summaries/deltas (including per-seed comparisons).
  - Updated config trainer feature list to include new Underrealm features.
  - Synced docs (`docs/PARAMETERS.md`, `docs/TRAINING_OVERRIDES.md`, `MANUAL.md`, `README.md`) and workbook entries for M6 behavior.
  Files touched:
  - `src/ai/observation.js`
  - `ai_server.js`
  - `python/train.py`
  - `config.json`
  - `scripts/regression.js`
  - `scripts/headless_benchmark.js`
  - `docs/PARAMETERS.md`
  - `docs/TRAINING_OVERRIDES.md`
  - `MANUAL.md`
  - `README.md`
  - `underrealm_v2.md`
  Validation commands:
  - `node --check src/ai/observation.js`
  - `node --check ai_server.js`
  - `node --check scripts/headless_benchmark.js`
  - `node --check scripts/regression.js`
  - python AST parse smoke for `python/train.py` and `python/regression_rollout.py`
  - observation/features shape smoke (`feature_count=36`, `vector_count=36`, no missing underrealm keys)
  - model shape compatibility check (`config=36` vs `policy_best=27` -> resume mismatch flagged)
  - `node scripts/headless_benchmark.js --ticks 8000 --seeds 101,202,303,404 --variant baseline --variant candidate --output table --progress --progress-every 2000`
  - `node scripts/regression.js`
  - `npm start` (interactive smoke, manual interrupt after successful render boot)
  Outcome:
  - completed.
  - new Underrealm AI features are active in JS/Python pipelines and benchmark/regression surfaces.
  - deterministic baseline/candidate benchmark parity confirmed (zero deltas on identical config) with explicit underrealm KPI visibility.
  - regression checks remained `ok` after M6 integration.
  - training resume compatibility requires `--fresh` when using pre-M6 checkpoints with the new feature shape.
  Follow-ups: M7 requires explicit confirmation.

- Step ID: S-014
  Date: 2026-02-10
  Milestone: M7
  Intent: Start M7 implementation (hardening, final validation sweep, final workbook sign-off).
  Changes made: planning intent logged before M7 validation pass.
  Files touched:
  - `underrealm_v2.md`
  Validation commands: none
  Outcome: completed.
  Follow-ups: execute M7 validation suite and finalize workbook.

- Step ID: S-015
  Date: 2026-02-10
  Milestone: M7
  Intent: Complete M7 end-to-end (documentation/hardening sign-off with deterministic stability evidence).
  Changes made:
  - Executed full M7 validation checklist (syntax/config sanity, deterministic long-run benchmark, deterministic A/B comparison, AI regression suite, runtime smoke).
  - Confirmed stable deterministic outcomes with no benchmark/regression regressions and no crashes in interactive render boot.
  - Finalized workbook milestone status, decision log, and approval gate for V2 completion.
  Files touched:
  - `underrealm_v2.md`
  Validation commands:
  - `node --check src/simulation/underrealm.js`
  - `node --check src/simulation/ruins.js`
  - `node --check src/render/telemetry.js`
  - `node --check scripts/headless_benchmark.js`
  - `node --check scripts/regression.js`
  - `python3 -c "import ast,pathlib; ast.parse(pathlib.Path('python/train.py').read_text()); ast.parse(pathlib.Path('python/regression_rollout.py').read_text()); print('python-ast-ok')"`
  - `node -e "JSON.parse(require('fs').readFileSync('config.json','utf8')); console.log('config-ok')"`
  - `node scripts/headless_benchmark.js --ticks 8000 --seeds 101,202,303,404 --progress --progress-every 2000`
  - `node scripts/headless_benchmark.js --ticks 8000 --seeds 101,202,303,404 --variant baseline --variant candidate --output table --progress --progress-every 2000`
  - `node scripts/regression.js`
  - `npm start` (interactive smoke, manual interrupt after successful render boot)
  Outcome:
  - completed.
  - long-run deterministic benchmark remained stable (`avg pop 668.0`, `morale 0.8856`, `hunger 0.1546`, `thirst 0.1087`).
  - A/B baseline vs candidate parity confirmed (`score +0.00`; all relative deltas `0.00%` on tracked metrics, including underrealm KPIs).
  - regression gates all `ok` with report artifacts written under `debug/regression_report_1770737512253.*`.
  - final balancing pass result: no default tuning changes required for M7 sign-off.
  Follow-ups: Underrealm V2 workbook closed; further feature work requires new scope confirmation.

## 14. Open Questions

- OQ-01: Keep Deep Lift as mandatory prerequisite for each champion floor, or only for selected floors?
- OQ-02: Should equipment be fully stockpile-based or partially assigned to persistent squads?
- OQ-03: Should champion retry cooldown/loss penalties scale by encounter history (attempt count) or remain depth-based only?
- OQ-04: Which Underrealm metrics are mandatory in `diag` vs optional in extended telemetry?

## 15. Approval Gate

Underrealm V2 milestones are complete (M0..M7). Further implementation requires explicit maintainer confirmation for new scope.

Current state:
- Planning document: ready
- M0: completed
- M1: completed
- M2: completed
- M3: completed
- M4: completed
- M5: completed
- M6: completed
- M7: completed
- Workbook state: closed for Underrealm V2 baseline delivery
