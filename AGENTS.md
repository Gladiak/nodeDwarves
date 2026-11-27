# Agent Guidelines (NodeDwarves)

This file defines how to implement new features in a consistent, stable way.

## Core principles

- Prefer stability and long-term equilibrium over short-term spikes.
- Keep logic explicit and readable; avoid hidden behavior.
- Use config-driven tuning for all gameplay parameters.
- Favor gather-first economy; build structures only when shortages justify them.
- Keep the simulation deterministic enough for training comparison.
- Use one cached headless benchmark baseline in `benchmark_cache/` for all report-to-report comparisons.
- Refresh the cached baseline automatically whenever benchmark profile metadata changes (config hash, ticks, seeds, resources, width, or height).
- Avoid rerunning a baseline inside every candidate benchmark run when a cached baseline can be reused.
- Continuously improve model intelligence and learning capability in measured, stable steps.
- Validate every substantial change with dedicated short-run and long-run checks, and include explicit model non-regression tests before considering the change complete.
- Prefer reliability over speed: there is no rush to finish runs quickly when quality evidence is still missing.
- When implementation details are unclear, ask for clarifications before coding changes.
- The repository keeps exactly three Markdown files: `README.md` (product overview, quick start,
  controls, essential commands; technical but playful, with emojis), `AGENTS.md` (these rules) and
  `STRATEGY.md` (state of the art, evidence, measurement protocol, step plan and decision log).
  Do not add other Markdown files, manuals, workbooks or completion reports; scripts write JSON reports.
- Every simulation, reward, action/observation or training-recipe change is measured with the
  `STRATEGY.md` protocol and recorded there (evidence row + decision log) in the same change set.
- Update `README.md` only for player-facing or command changes; keep formulas and numbers in `STRATEGY.md`.
- Keep the project structure below, README's Project layout and the files on disk aligned whenever
  files or folders are added, renamed, moved or removed.
- Always write documentation in English.

## Project structure

- Keep this section always aligned with the real repository layout.
- `app.js`: entrypoint and main loop.
- `config.json`: single source of truth for tunables.
- `README.md`: product overview, quick start, controls and essential commands.
- `AGENTS.md`: contributor and agent guidelines.
- `STRATEGY.md`: state of the art, evidence, measurement protocol, step plan and decision log.
- `scripts/review_chronicle_retention.js`: read-only snapshot/replay study of Chronicle density, source integrity, saga-status coverage, bounds and deterministic export hashes.
- `scripts/test_chronicle_retention_contracts.js`: Chronicle retention study contracts: retained claims, source integrity, bounds, replay and RNG purity (included in `npm test`).
- `scripts/test_legend_panel.js`: complete surface/deep symbol visibility, responsive pagination, color bounds and real arrow-dispatch contracts (included in `npm test`).
- `scripts/test_telemetry_report_contracts.js`: Colony Report bounded pages, read-only/no-RNG rendering, verdict rules, config thresholds, history bounds and lossless wrapping (included in `npm test`).
- `src/config.js`: config loader.
- `src/game_session.js`: scenario resolution, interactive session creation and resumable AI/tick cadence.
- `src/session_random.js`: serializable scoped gameplay PRNG, isolated from exports, training and benchmarks.
- `src/persistence.js`: versioned integrity-checked session graph saves, atomic replacement and backup recovery.
- `src/runtime/start_menu.js`: responsive ASCII welcome screen, scenario selection and saved-colony browser.
- `src/render/start_menu.js`: cached decorative terrain atlas sharing the first playable frame's seasonal palette and active theme, with responsive masonry, gold frame accents, pillars and uniform text backgrounds.
- `scripts/test_save_contracts.js`: lossless graph, resume, recovery, presentation, menu and AI isolation contracts.
- `scripts/validate_save_continuity.js`: milestone-only short/long deterministic uninterrupted-versus-resumed validation.
- `scripts/test_scenario_contracts.js`: curated scenario, filtered test-template reuse, precedence, save pinning and standard-game/PPO isolation contracts.
- `scripts/validate_scenarios.js`: milestone-only two-seed catalog validation, long pressure runs, checkpoint restoration and policy compatibility (promoted policy, or the test fixture while none is promoted).
- `debug/scenario_validation_latest.json` (written by `scripts/validate_scenarios.js`): latest scenario-catalog validation.
- `saves/`: git-ignored per-colony checkpoints and previous valid backups.
- `models/`: the promoted v2 policy (`policy_best.json`, `.state.pt`, `.meta.json`), written only by `npm run ai:promote` (first v2 policy: E48 r3, 2026-11-27).
- `.cache/snapshot_bank/`: git-ignored snapshot banks keyed by game config, bank shape and start policy (built by `scripts/train_recipe.js`).
- `.cache/scorecard/`: git-ignored scorecard results per (simulation sources, config, horizon, player content), written by `scripts/scorecard.js`.
- `src/simulation/`: simulation systems split by theme.
- `src/simulation/index.js`: simulation orchestrator.
- `src/simulation/tick_config_cache.js`: per-tick, deep-frozen memo for pure config normalizers (warriors, landmarks, temple stages) and the tick-scope flag that lets the Story Director skip re-repairing an already normalized story; active only inside `stepState`.
- `src/simulation/narrative_contract.js`: strict schema-v1 validator and deterministic event identity helpers used by narrative contract gates and the runtime event core.
- `src/simulation/narrative_normalizer.js`: bounded structured-event draft normalization, config-driven importance resolution, and deterministic optional-payload reduction.
- `src/simulation/story_director.js`: bounded per-cycle Story Director state, deterministic event scoring/focus selection, cooldown/escalation budgets, reason traces, serialization repair, and hard-cap enforcement.
- `src/simulation/story_sagas.js`: deterministic saga grouping, lifecycle transitions, bounded evidence indexes, fact-backed chapter summaries, and capacity eviction.
- `src/simulation/experience_ledger.js`: bounded source-backed per-dwarf deed ledger, deterministic merge/retention rules, and read-only biography views.
- `src/simulation/chronicle.js`: fixed cycle chapters, compact evidence, factual-integrity verification, summaries, and bounded cross-cycle Chronicle archives.
- `src/simulation/world_legacy.js`: versioned bounded cross-cycle summaries, archived identities/places, memorials, inherited institutions, deterministic geographic remapping, and saga hooks.
- `src/simulation/legacy_effects.js`: typed, source-verified, capped and decaying Builders' Guild construction effects.
- `src/simulation/road_routing.js`: pure destination-progress, terrain, crowd and ordinary-cost guards for road-step substitution.
- `src/simulation/epic_conflicts.js`: bounded deterministic nemesis registry, staged surface sieges, hero rivalry branches, recovery, and legacy restoration.
- `src/simulation/nemesis_events.js`: canonical structured nemesis promotion, reappearance, siege-stage, battle, and aftermath event boundary.
- `src/simulation/landmarks.js`: bounded multi-stage monumental landmarks, deterministic final-footprint reservation, district conditions, and render-tile projection.
- `src/simulation/landmark_events.js`: canonical structured landmark construction and condition-transition boundary.
- `src/simulation/secondary_events.js`: shared structured boundary and actor/location/resource-fact helpers for secondary world, culture, environment, economy, and development producers.
- `src/simulation/lifecycle_events.js`: structured founding, birth, natural-death, and partnership event builders with deterministic actor snapshots and causal facts.
- `src/simulation/social_events.js`: structured mentorship, rivalry, grudge, and reconciliation incident builders with pair evidence and typed outcomes.
- `src/simulation/combat_events.js`: structured surface-raid, ruins-expedition, Underrealm battle, deep-raid, and Dwarf Champion event builders.
- `src/simulation/warrior_events.js`: structured Warrior League marks, vows, injuries, retirements, deaths, tournament crowns, Hall of Fame, and command-transition event builders.
- `src/simulation/political_events.js`: structured schism doctrine, phase, ritual, decree, and climax event builders with committed state evidence.
- `src/simulation/endgame_events.js`: structured artifact, cycle-transition, cycle-closure, and Warrior Company carry-over event builders.
- `src/simulation/underrealm.js`: underrealm crew assignment, deep economy, exploration unlocks, and hostile deep raids.
- `src/simulation/world_events.js`: world event lifecycle, timed opportunities, and temporary world modifiers.
- `src/simulation/external_camps.js`: long-lived external faction camps with trade, militia support, and raider pressure.
- `src/simulation/modifier_ledger.js`: named, bounded multiplier stacks for gather yield, need decay, birth chance and raid chance (STRATEGY.md R3), with the latest breakdown in `state.modifierLedger` for the Colony Report.
- `src/simulation/levers.js`: strategic levers of action space v2 (STRATEGY.md S4b): `lever_<name>` heads map u in [0, 1] to low/default/high settings read at their config paths, or open council-restrained groups.
- `src/simulation/world_profile.js`: per-game world character (STRATEGY.md S3d) drawn from `variety.ranges` with a private PRNG seeded by the map seed; enters the ledger as the `world` factor.
- `src/simulation/steward.js`: Colony Council posture (STRATEGY.md S2): fills the action groups no policy provides, restrained/cautious governor groups from `ai.steward`, RNG-free, `council.posture_changed` decrees.
- `src/simulation/schism.js`: run-scale social schism arc (pressure/legitimacy, doctrine shifts, ritual windows, decrees, climax lifecycle, and committed structured-event integration).
- `src/simulation/social_drama.js`: social-drama runtime for friendship/rivalry/mentorship/grudge inference and aggregate social pressure/cohesion metrics.
- `src/simulation/temple.js`: Temple of Ancestors stages, site selection, bonuses, and prestige.
- `src/simulation/warriors.js`: Warrior League helpers for deterministic per-dwarf combat profiles, risk-aware expedition dispatch, seasonal tournament runtime/champion sync, and committed structured-event integration.
- `src/simulation.js`: thin wrapper for `src/simulation/index.js`.
- `src/state/`: state creation and terrain generation.
- `src/state/index.js`: state orchestrator.
- `src/state.js`: thin wrapper for `src/state/index.js`.
- `src/render/`: render helpers (grid, header, legend, colors, format, overlays).
- `src/render/index.js`: render orchestrator.
- `src/render/dwarf_visibility.js`: deterministic bounded story-priority selection shared by surface
  and Underrealm dwarf rendering.
- `src/render/story_ribbon.js`: read-only responsive in-map presentation of the active Story Director
  focus with actor/action/place/consequence fallbacks and overlay collision handling.
- `src/render/story_focus_overlay.js`: deterministic bounded actor/location emphasis and off-layer
  direction cues for the active Story Director focus.
- `src/render/epic_conflicts.js`: read-only active nemesis-front and siege-damage map overlays.
- `src/render/landmarks.js`: read-only evolving landmark footprints and compact district-state overlays.
- `src/render/world_legacy.js`: read-only rendering of remapped persistent-world legacy sites.
- `src/render/map_inset_panel.js`: carved top-right in-map operations snapshot panel (tick/year/cycle, population age split, underrealm unlock info, keyboard hints).
- `src/render/warrior_panel.js`: Warrior League analytics modal overlay (champion lineage, top-5 fighters, marks/legacy summary).
- `src/render/event_log_panel.js`: Event Log modal overlay with scrollable real-time events,
  all/drama filters, importance badges, and compact actor/place/saga context.
- `src/telemetry/`: telemetry section and Colony Report panel builders.
- `src/telemetry/telemetry.js`: telemetry section builders and formatting helpers.
- `src/telemetry/refinement.js`: opt-in read-only headless economy/social/saga/movement/legacy counters and bounded travel histograms, isolated from saves, gameplay RNG, and PPO.
- `src/telemetry/story_director.js`: read-only Story Director telemetry rows plus deterministic headless counter tracking and report summaries.
- `src/telemetry/colony_report.js`: read-only plain-language colony report (GOOD/WATCH/BAD rows with explanations, attention list, config-driven thresholds, yearly trends).
- `src/telemetry/telemetry_panel.js`: in-game Colony Report overlay ([h]): Status, Economy, People, Frontier & Defense and Technical pages, render-only trend history.
- `src/render.js`: thin wrapper for `src/render/index.js`.
- `src/runtime.js`: terminal sizing and layout.
- `src/runtime/time_controls.js`: ephemeral interactive speed, pause, single-step, and
  Story Director critical/legendary presentation-protection controller.
- `src/chronicle_export.js`: deterministic safe-path Markdown/JSON Chronicle serialization and export.
- `src/terminal.js`: terminal helpers.
- `src/dwarf_identity.js`: shared deterministic dwarf identity resolver and named-event formatter with
  bounded caches, historical snapshot lookup, collision disambiguation, and explicit fallbacks.
- `src/place_identity.js`: bounded authoritative registry for deterministic place names, compact
  labels, coordinates, and event/UI location lookup.
- `src/ai/`: AI modules (policy and observation).
- `src/ai/observation_layout.js`: shared legacy/factored observation layout plans used by the training server and in-game policy inference.
- `src/ai/outcome_reward.js`: compact outcome-tied training reward (population, avoidable deaths, distress, reserves, progress, drawdown below the cycle population peak, extinction) used by `ai_server.js` and the evaluators.
- `src/ai_policy.js`: thin wrapper for `src/ai/policy.js`.
- `src/clans.js`: clan helpers and weighted clan distribution.
- `src/dwarf_lore.js`: deterministic lore seed and generation for identity, inspect, and narrative consumers.
- `src/utils.js`: shared helpers.
- `ai_server.js`: JS inference bridge for training.
- `scripts/config_trace.js`: preload (`NODE_OPTIONS=-r`) that records which config paths a run reads, for the config audit.
- `scripts/audit_config.js`: config audit (trace-based never-read keys, section classes) the `CORE_KEYS` tuning surface and the screened `FROZEN_KEYS`.
- `scripts/export_map.js`: CLI map export pipeline (PNG + SVG).
- `scripts/build_snapshot_bank.js`: mid-game snapshot bank for training starts (STRATEGY.md S4d): plays training games through `ai_server.js` (council or a policy) and saves gzip states at fixed ticks.
- `scripts/train_recipe.js`: single training entry point (STRATEGY.md T1, `npm run ai:train:recipe`): runs `ai.training.recipe` into a self-contained run folder (frozen phase configs, effective recipe, logs, policy), builds or reuses the cached snapshot bank (`--bank-only` stops after it), never writes `models/`.
- `scripts/test_recipe_contracts.js`: recipe validation, recipe-only train arguments, phase configs, policy-owned cadence, v1-policy refusal, the `ai.training` key surface and scorecard contracts (included in `npm test`).
- `scripts/test_policy_fixture.js`: deterministic small v2 policy (trainer file schema, seeded weights) used by contracts and validators instead of a promoted policy.
- `scripts/scorecard.js`: single evaluator and promotion gate (STRATEGY.md T3, `npm run ai:scorecard`, `npm run ai:promote`): plays a policy at its own cadence and the council on the `ai.evaluation` horizons (8,000-tick eval plan, 20,000-tick standard game) through `experiments/challenge_probe.js`, caches results by simulation sources, config, horizon and player content in `.cache/scorecard/`, and promotes to `models/policy_best.*` only when the gate passes.
- `scripts/headless_benchmark.js`: deterministic headless benchmark CLI for long-run tuning and validation.
- `scripts/sim_fingerprint.js`: full-state canonical fingerprint of seeded no-AI games at fixed checkpoints (`--save` before, `--compare` after) for bit-identical refactors and optimizations (`npm run sim:fingerprint`).
- `scripts/ensure_benchmark_baseline.js`: baseline cache guard that auto-refreshes cached baseline reports when benchmark profile metadata mismatches.
- `scripts/compare_benchmark_reports.js`: report-to-report benchmark diff CLI for cached baseline/candidate economy, Underrealm, legacy, and epic-conflict comparisons.
- `scripts/clean_debug.js`: debug artifact housekeeping utility (transient cleanup + run retention).
- `scripts/audit_narrative_producers.js`: deterministic source audit that reports direct legacy-only `pushEvent` producers outside approved structured boundaries.
- `scripts/test_narrative_contracts.js`: deterministic structured-event, identity, legacy, retention, serialization, renderer, and isolation contract suite (included in `npm test`).
- `scripts/test_time_controls.js`: deterministic E4.3 speed, pause, single-step, auto-protection,
  supported-width rendering, manual precedence, and AI/headless isolation suite (included in `npm test`).
- `scripts/test_chronicle_contracts.js`: deterministic E5 ledger, biography, Chronicle integrity,
  reset, export-hash, density-bound, and AI-observation isolation suite (included in `npm test`).
- `scripts/test_world_legacy_contracts.js`: deterministic E6 schema, migration, retention, remapping,
  rendering, multi-cycle, and AI-observation isolation suite (included in `npm test`).
- `scripts/validate_world_legacy.js`: deterministic two-/five-/ten-cycle E6 state-growth, balance-signal, and stop-rule validator.
- `scripts/validate_road_routing.js`: fixed P3.3 per-seed/aggregate economy, travel, gathering, invalid-value and optional timing gate (`node scripts/validate_road_routing.js`).
- `scripts/test_epic_conflict_contracts.js`: deterministic E7 identity, promotion, siege lifecycle,
  rivalry, legacy, rendering, retention, serialization, and AI-observation isolation suite (included in `npm test`).
- `scripts/validate_epic_conflicts.js`: deterministic full-siege, collapse-guard, and repeated-siege E7 validator.
- `scripts/test_landmark_contracts.js`: deterministic E8 schema, placement, progression, collision, rendering/export, condition, serialization, and AI-observation isolation suite (included in `npm test`).
- `scripts/validate_landmarks.js`: deterministic multi-seed/size E8 organic-construction, population, and bounded-state validator.
- `scripts/test_saga_refinement_contracts.js`: bounded cause diagnostics, actor-family guards, political identity/outcome, dormant grace, terminal retention, serialization, RNG and observation contracts (included in `npm test`).
- `scripts/test_legacy_effect_contracts.js`: inherited-effect evidence, consumer, decay, caps, migration, serialization, RNG and PPO isolation contracts (included in `npm test`).
- `scripts/test_road_routing_contracts.js`: deterministic road dominance, actual-mover, RNG, work-family, cache, reload and PPO contracts (included in `npm test`).
- `scripts/test_social_memory_contracts.js`: focused long-arc support/burden, mood, shock, decay, disabled-mode, and save contracts for M1.
- `scripts/test_core_simulation_contracts.js`: deterministic economy, consumption, population, structure, movement, raid, save, and read-only measurement contracts (included in `npm test`).
- `scripts/test_governor_contracts.js`: game governor action-envelope contracts (external camps, contracts, ruins, Underrealm, warriors, social) and warrior/social observation parity across JS, JSON and compact transports (included in `npm test`).
- `benchmark_cache/headless_benchmark_baseline.json`: versioned cached headless benchmark baseline used for report diffs.
- `debug/headless_benchmark_candidate.json`, `debug/headless_benchmark_diff.json`: latest canonical `4 x 8000` candidate and its cached-baseline comparison.
- `chronicles/`: git-ignored deterministic Markdown/JSON Chronicle exports created on demand.
- `python/bootstrap.py`: venv bootstrap with pinned torch and numpy versions (runs reproduce bit for bit only with the same versions).
- `python/trainer_v2.py`: lean deterministic PPO trainer for action space v2 (STRATEGY.md T2); runs one phase of a `scripts/train_recipe.js` run folder (`--run`, `--phase`, `--rep`).
- `python/v2/`: trainer modules: `env.py` (ai_server compact protocol, action ids, pure per-episode settings), `model.py` (actor-critic, running statistics, PopArt rescaling, policy JSON), `ppo.py` (GAE, PPO update), `rollout.py` (versioned-weight workers, lever noise hold).
- `python/test_trainer_v2.py`: JS/Python inference parity, policy round trip and pure episode settings (run by `scripts/test_recipe_contracts.js`).
- `python/agent.py`: example Python agent for the `ai_server.js` JSON transport.
- `experiments/`: measurement tools used by the `STRATEGY.md` protocol.
  - `challenge_probe.js`: in-process scorecard for synthetic players and trained policies (`policy:<file>`, game JS inference): stock flows, reserve autonomy, labor mix, deaths, outcome-reward score, progress; eval plan or the `npm start` game, with `--set` A/B overrides; optional per-decision signal rows (`recordSignals`) for the reward screen.
  - `reward_screen.js`: offline reward screen (STRATEGY.md T5): records per-decision outcome signals and age structure of several players on the 20,000-tick scorecard horizon (`challenge_probe` `recordSignals`), then replays candidate rewards and reports how well each ranks players and games like final population at 20,000 ticks (undiscounted, discounted from mid-game starts, and at 8,000 ticks).
  - `replicates.js`: one resumable command for replicated recipe runs: trains each replicate with `scripts/train_recipe.js`, scores it with `scripts/scorecard.js` (council cached), reads the policy's lever choices and writes a pooled paired summary with each replicate's gate verdict; `--from`/`--against` chain replicates from an incumbent policy and judge them against it.
  - `pairing_probe.py`: variance of lever-effect estimates from bank snapshots (antithetic lever noise, shared vs different game seeds); tells whether paired branches or a given exploration scale can carry learning signal.
  - `sensitivity_screen.js`: resumable one-at-a-time +/-25% screen of `CORE_KEYS` (`--keys all` adds `FROZEN_KEYS`) with paired effects on population, avoidable deaths and progress.
  - `runs/`: git-ignored session outputs.

## Config-first changes

- Add new parameters to `config.json` with sensible defaults.
- Record difficulty, reward, gate and trainer knobs in the `STRATEGY.md` tuning surface; keep only player-facing impact in `README.md`. The authoritative complete parameter set is `config.json`.
- Avoid comments in JSON.
- Keep ratios in [0, 1] where possible to simplify tuning.
- `ai.training.configOverrides` and `evalOverrides` hold profile keys only (`events`, `ai`, `merchant`, `endgame`); the economy comes from the base config and scenarios (enforced by a core contract).
- `ai.training` holds only what the v2 stack reads: `recipe`, `trainer` (algorithm hyperparameters and feature list), the two profile overrides and `randomization` (enforced by `scripts/test_recipe_contracts.js`). The scenario catalog is the top-level `scenarios` section; the eval-plan scenario names are `ai.evaluation.scenarios`.
- New economic effects from any system enter through `src/simulation/modifier_ledger.js` with a named factor, never as a new inline multiplier.
- Decision chain: policy, then council (steward), then engine defaults; the engine may only add last-resort guards (today: emergency gathering), never adjust a policy's choices.
- Before deleting config keys, trace real reads with `scripts/config_trace.js` and `scripts/audit_config.js`; a key absent from the trace may be content that never triggered.

## Simulation rules

- New resources must update:
  - `config.json` (`resources.*`, `jobs.*`, `symbols.*`, `display.colors.map` when colors are enabled)
  - `src/state/` (initial stockpile, nodes, terrain source constraints)
  - `src/simulation/` (gathering, regen, consumption, shortages/jobs)
  - `src/render/` (legend, telemetry, symbols/colors usage)
  - `STRATEGY.md` (measured effect) + `README.md` (high-level player-facing mention only if relevant)
- New structures must update:
  - `config.json` (`structures.*`, costs, build ticks, guardrails, `symbols.*`, `display.colors.map` when colors are enabled)
  - `src/simulation/` (build jobs, placement, upgrades/effects)
  - `src/render/` (symbols, legend, telemetry counts)
  - `STRATEGY.md` (measured effect) + `README.md` (high-level player-facing mention only if relevant)
- Guardrails should use stockpile ratios, not absolute counts.

## Modularization and refactoring

- Split large files into small, thematic modules (resources, structures, movement, population, raids, rendering, AI).
- Keep wrappers as stable public APIs to avoid import churn and reduce regression risk.
- Prefer explicit data flow between modules over implicit shared state.
- Avoid circular dependencies; use small, single-purpose helpers.

## AI training

- PPO only (2x128 MLP). Keep JSON weights for JS inference. Training is `python/trainer_v2.py` / `python/v2/` driven by `scripts/train_recipe.js`; only v2 policies (factored layout, job-weight and lever heads, own `stepTicks`) load anywhere.
- Training runs must be deterministic: episode settings are pure functions of the run seed and episode number, each episode reseeds its RNG, and each episode plays a weight version fixed by rule (`policyLagBatches`), never whatever a worker happens to hold. Two runs of the same recipe must give identical weights.
- Observations for training come only from the JS server (compact transport); never re-implement observation features in Python.
- Every run-shape knob (cadence, gamma, episodes, episode ticks, snapshot starts, entropy and learning-rate schedules, noise hold) lives in `ai.training.recipe` and reaches the trainer only through `scripts/train_recipe.js`; never pass them as ad-hoc flags in a measured run.
- The decision cadence belongs to the policy: the trainer writes `stepTicks` into the policy file, and every consumer (game, `ai_server`, evaluators, gate) must use it or refuse to run, never override it silently.
- Training must not cut game phases out: there is no early stop for settled colonies, only extinction is terminal, time limits bootstrap, and the snapshot bank covers the long game.
- Chained runs start from a policy file (`scripts/train_recipe.js --from`, e.g. the promoted `models/policy_best.json`).
- If observation/action shapes change, require `--fresh` training.
- Keep the observation layout identical across `ai_server.js`, `src/ai/policy.js` and `python/v2/env.py` (shared plan in `src/ai/observation_layout.js`).
- Training and in-game inference must see the same observation values: share helpers between `ai_server.js` and `src/ai/observation.js` (e.g. `getObservationNodeRatio`) and re-run the `STRATEGY.md` S1 parity check after any observation change.
- The critic predicts normalized returns with output-preserving rescaling; only true terminal states (extinction) cut bootstrap, time limits bootstrap.
- The reward is the compact outcome reward (`src/ai/outcome_reward.js`, weights in `ai.reward`); keep it short and tied to colony outcomes. Check new terms with `experiments/challenge_probe.js` (score vs final population and avoidable deaths) before training.
- Promotion compares policies over 8,000 ticks with `rpp` (reward per planned tick), so an early extinction scores zero for the ticks it did not live, and refuses a 20,000-tick regression in `rpp`, second-half mean population, extinctions or avoidable deaths beyond one SE (20k games are played only after a passing 8k test); v2 policies are scored and promoted only through `scripts/scorecard.js` (one evaluator, settings in `ai.evaluation`).
- Keep logs low-noise: `diag` should be averaged per log window.
- Track model quality over time and prefer steady, incremental improvements over sudden unstable jumps.

## Logging and diagnostics

- Use the `diag` line for compact, comparable summaries.
- Avoid per-episode debug spam; log on `logEvery`.
- Keep log formatting stable so it can be parsed later.

## Debug housekeeping

- Keep `debug/` clean and ordered after every development/optimization cycle.
- Retain only current JSON reports (benchmark, scenario validation) and at
  most the latest 2-3 `debug/run_*` folders; delete reports that describe a superseded game or policy.
- Remove transient artifacts once their numbers are in `STRATEGY.md`: smoke logs, per-seed
  regression folders (`debug/regression_eval_*`, `debug/regression_random_*`), finished
  `experiments/runs/` sessions.
- Cleanup commands: `npm run debug:clean` (keeps 3 runs; `--keep-runs 2`, `--dry-run`),
  `rm -rf debug/regression_eval_* debug/regression_random_*`, `du -sh debug experiments/runs`.

## Performance and UX

- Avoid O(n^2) scans in per-tick logic when possible.
- Performance work must be bit-identical unless it is a measured game change: save `node scripts/sim_fingerprint.js --save <file>` before and require `--compare <file>` to report IDENTICAL after, plus `npm test`; caches must be pure (eviction never changes results) and keyed by the data they depend on.
- Prefer early exits and precomputed counts.
- Keep telemetry lines short enough for the configured width.
- Every time telemetry sections, labels, or metrics are changed, verify the Colony Report (`src/telemetry/colony_report.js`, `src/telemetry/telemetry_panel.js`) is coherent with the current telemetry and update it in the same change set. Keep its rows plain-language: a status, a value and one sentence on what it means.
- Update the ASCII legend when new entities are added.

## Validation checklist

- Run `npm start` and confirm the telemetry/legend renders.
- Run deterministic headless benchmark before finalizing balance defaults:
  `node scripts/headless_benchmark.js --ticks 8000 --seeds 101,202,303,404 --progress --progress-every 2000`.
- The cached baseline is realigned with the active candidate profile automatically by
  `npm run bench:diff` (via `scripts/ensure_benchmark_baseline.js`).
- For A/B tuning, run candidate-only benchmark and diff against cached baseline:
  `npm run bench:candidate -- --set path=value && npm run bench:diff`.
- Always compare against `benchmark_cache/headless_benchmark_baseline.json` instead of writing ad-hoc baseline copies in `debug/`.
- Do not stop long-running validations early just because they take longer than expected; keep them running when they are making progress so results remain statistically reliable over wide horizons.
- Colonies may shrink or die out after bad play by design; judge collapses against the `STRATEGY.md`
  scorecard targets (default, steward and trained play) rather than treating every collapse as a bug.
- Confirm no crashes on resize and no negative stockpile values.
- Check that shortages drive gathering priorities as expected.

## Style guidelines

- Small pure helpers over large monolithic blocks.
- Use consistent naming: `snake_case` only for config keys, `camelCase` in code.
- Use ASCII only unless a file already uses Unicode.
- For terminal map readability, avoid near-black foreground colors for gameplay-critical symbols on dark consoles; prefer medium/high-contrast colors.
- Prefer early returns and guard clauses.
- Add short English comments above top-level functions to aid onboarding.
- Use English for all player-facing in-game strings (telemetry, events, labels, config names).
