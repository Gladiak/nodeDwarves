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
- Always update README.md and MANUAL.md after new implementations or tweaks, if needed.
- README.md is a general product feature overview; avoid deep implementation details, formulas, and low-level file-by-file behavior.
- README.md tone: technical but playful (nerd-friendly). Use emojis.
- MANUAL.md is the technical manual and operational runbook (systems, formulas, workflows, implementation behavior). Tone: technical-nerd and precise. Use emojis.
- Keep MANUAL.md section order stable for discoverability: Scope, Operations, Mental model, Tick flow, Runtime, State generation, Simulation systems, Rendering, AI/training, Configuration, Role guide, Deep dives, Project layout.
- Always keep project structure documentation up to date: update AGENTS.md, README.md (Project layout), and MANUAL.md (Project layout cheatsheet) whenever files or folders are added, renamed, moved, or removed.
- For substantial implementations, update documentation with a clear, high-detail explanation (README, MANUAL, and relevant docs).
- Always write documentation in English.

## Project structure

- Keep this section always aligned with the real repository layout.
- `app.js`: entrypoint and main loop.
- `config.json`: single source of truth for tunables.
- `docs/PARAMETERS.md`: config parameter reference.
- `docs/TRAINING_OVERRIDES.md`: training overrides guide.
- `docs/TRAINING_STATUS.md`: current training quality status, active validation cadence, and pending closure items.
- `docs/TRAINING_OPTIMIZATION_WORKBOOK.md`: step-by-step implementation workbook, decision log, and timeline for training optimization workstreams.
- `docs/EPIC_EVOLUTION_WORKBOOK.md`: staged implementation workbook, progress dashboard, decision log, validation gates, and evidence tracker for narrative, cinematic, legacy, and epic-world workstreams.
- `docs/NARRATIVE_EVENT_CONTRACT.md`: normative versioned event envelope, deterministic identity, compatibility, retention, and serialization contract for narrative systems.
- `docs/TELEMETRY.md`: telemetry operator manual (from zero to hero).
- `.github/workflows/quality_gates.yml`: CI automation for extended/weekly training quality gates and artifact upload.
- `src/config.js`: config loader.
- `src/simulation/`: simulation systems split by theme.
- `src/simulation/index.js`: simulation orchestrator.
- `src/simulation/narrative_contract.js`: strict schema-v1 validator and deterministic event identity helpers used by narrative contract gates and the runtime event core.
- `src/simulation/narrative_normalizer.js`: bounded structured-event draft normalization, config-driven importance resolution, and deterministic optional-payload reduction.
- `src/simulation/story_director.js`: bounded per-cycle Story Director state, deterministic event scoring/focus selection, cooldown/escalation budgets, reason traces, serialization repair, and hard-cap enforcement.
- `src/simulation/story_sagas.js`: deterministic saga grouping, lifecycle transitions, bounded evidence indexes, fact-backed chapter summaries, and capacity eviction.
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
- `src/render/map_inset_panel.js`: carved top-right in-map operations snapshot panel (tick/year/cycle, population age split, underrealm unlock info, keyboard hints).
- `src/render/warrior_panel.js`: Warrior League analytics modal overlay (champion lineage, top-5 fighters, marks/legacy summary).
- `src/render/event_log_panel.js`: Event Log modal overlay with scrollable real-time events,
  all/drama filters, importance badges, and compact actor/place/saga context.
- `src/telemetry/`: telemetry section and Data Center panel builders.
- `src/telemetry/telemetry.js`: telemetry section builders and formatting helpers.
- `src/telemetry/story_director.js`: read-only Story Director telemetry rows plus deterministic headless counter tracking and report summaries.
- `src/telemetry/telemetry_panel.js`: in-game telemetry reference overlay panel (section and metric explanations).
- `src/render.js`: thin wrapper for `src/render/index.js`.
- `src/runtime.js`: terminal sizing and layout.
- `src/terminal.js`: terminal helpers.
- `src/dwarf_identity.js`: shared deterministic dwarf identity resolver and named-event formatter with
  bounded caches, historical snapshot lookup, collision disambiguation, and explicit fallbacks.
- `src/place_identity.js`: bounded authoritative registry for deterministic place names, compact
  labels, coordinates, and event/UI location lookup.
- `src/ai/`: AI modules (policy and observation).
- `src/ai_policy.js`: thin wrapper for `src/ai/policy.js`.
- `src/clans.js`: clan helpers and weighted clan distribution.
- `src/dwarf_lore.js`: deterministic lore seed and generation for identity, inspect, and narrative consumers.
- `src/utils.js`: shared helpers.
- `ai_server.js`: JS inference bridge for training.
- `scripts/export_map.js`: CLI map export pipeline (PNG + SVG).
- `scripts/train_continuous.js`: cycle orchestrator for continuous AI training cadence and periodic validation gates.
- `scripts/regression.js`: AI regression harness and profile recording.
- `scripts/validate_extended_optimized.js`: optimized full-quality validation orchestrator with per-phase runtime reporting (deduplicates benchmark execution across gate+risk).
- `scripts/headless_benchmark.js`: deterministic headless benchmark CLI for long-run tuning and validation.
- `scripts/ensure_benchmark_baseline.js`: baseline cache guard that auto-refreshes cached baseline reports when benchmark profile metadata mismatches.
- `scripts/compare_benchmark_reports.js`: report-to-report benchmark diff CLI for cached baseline/candidate comparisons.
- `scripts/clean_debug.js`: debug artifact housekeeping utility (transient cleanup + run retention).
- `scripts/audit_narrative_producers.js`: deterministic source audit that reports direct legacy-only `pushEvent` producers outside approved structured boundaries.
- `scripts/test_narrative_contracts.js`: deterministic structured-event, identity, legacy, retention, serialization, renderer, and isolation contract suite (`npm run test:narrative`; included in `npm test`).
- `scripts/test_training_contracts.js`: deterministic technical contract suite for training/validation schemas (included in `npm test`).
- `benchmark_cache/headless_benchmark_baseline.json`: versioned cached headless benchmark baseline used for report diffs.
- `benchmark_cache/headless_benchmark_baseline.md`: markdown companion of the cached headless benchmark baseline.
- `regression/baselines/regression_baseline.json`: durable regression baseline profiles used by checks.
- `python/bootstrap.py`: venv bootstrap.
- `python/train.py`: PPO training loop and logging.
- `python/regression_rollout.py`: rollout-only randomized regression runner (no PPO updates, no checkpoint writes).
- `python/agent.py`: example Python agent.

## Config-first changes

- Add new parameters to `config.json` with sensible defaults.
- Document new parameters in `docs/PARAMETERS.md`, then reflect behavior in `MANUAL.md` and only high-level impact in `README.md`.
- Avoid comments in JSON; use docs/MANUAL/README for explanations.
- Keep ratios in [0, 1] where possible to simplify tuning.
- If training overrides or scenario knobs change, update `docs/TRAINING_OVERRIDES.md`.

## Simulation rules

- New resources must update:
  - `config.json` (`resources.*`, `jobs.*`, `symbols.*`, `display.colors.map` when colors are enabled)
  - `src/state/` (initial stockpile, nodes, terrain source constraints)
  - `src/simulation/` (gathering, regen, consumption, shortages/jobs)
  - `src/render/` (legend, telemetry, symbols/colors usage)
  - `docs/PARAMETERS.md` (parameter reference) + `MANUAL.md` (operational behavior) + `README.md` (high-level player-facing mention only if relevant)
- New structures must update:
  - `config.json` (`structures.*`, costs, build ticks, guardrails, `symbols.*`, `display.colors.map` when colors are enabled)
  - `src/simulation/` (build jobs, placement, upgrades/effects)
  - `src/render/` (symbols, legend, telemetry counts)
  - `docs/PARAMETERS.md` (parameters) + `MANUAL.md` (operational behavior) + `README.md` (high-level player-facing mention only if relevant)
- Guardrails should use stockpile ratios, not absolute counts.

## Modularization and refactoring

- Split large files into small, thematic modules (resources, structures, movement, population, raids, rendering, AI).
- Keep wrappers as stable public APIs to avoid import churn and reduce regression risk.
- Prefer explicit data flow between modules over implicit shared state.
- Avoid circular dependencies; use small, single-purpose helpers.

## AI training

- PPO only (2x128 MLP). Keep JSON weights for JS inference.
- Training must be resumable from the best-eval snapshot (default `models/policy_best.json`).
- If observation/action shapes change, require `--fresh` training.
- Keep logs low-noise: `diag` should be averaged per log window.
- Track model quality over time and prefer steady, incremental improvements over sudden unstable jumps.

## Logging and diagnostics

- Use the `diag` line for compact, comparable summaries.
- Avoid per-episode debug spam; log on `logEvery`.
- Keep log formatting stable so it can be parsed later.

## Debug housekeeping

- Keep `debug/` clean and ordered after every development/optimization cycle.
- Retain only artifacts needed for traceability and recent comparisons:
  - latest canonical check reports (`canonical_*`)
  - latest benchmark/regression/risk summary reports (`*.json`, `*.md`, `*.txt`)
  - only the latest `2-3` `debug/run_*` folders for local history (default retention in tooling: `3`)
  - run folders explicitly referenced in `docs/TRAINING_OPTIMIZATION_WORKBOOK.md` or `docs/TRAINING_STATUS.md`
- Remove transient artifacts once summarized:
  - large smoke/runtime logs
  - per-seed regression temp folders (`debug/regression_eval_*`, `debug/regression_random_*`)
  - ad-hoc short smoke run folders not referenced by docs (`debug/run_*` mini-smokes)
- Prefer deterministic cleanup right after validations, before finalizing docs/commits.
- After cleanup, verify workbook/doc links still point to existing artifacts, or update notes accordingly.
- Recommended cleanup commands (adjust to current cycle before running):
  - `npm run debug:clean` (default: keep latest 3 `run_*` folders)
  - `npm run debug:clean -- --keep-runs 2` (stricter retention)
  - `npm run debug:clean -- --dry-run` (preview without deleting)
  - `rm -rf debug/regression_eval_* debug/regression_random_*`
  - `rm -f debug/*smoke*.log debug/*canonical*_smoke*.json debug/*canonical*_smoke*.md`
  - `du -sh debug && find debug -maxdepth 1 -type f | sort`

## Performance and UX

- Avoid O(n^2) scans in per-tick logic when possible.
- Prefer early exits and precomputed counts.
- Keep telemetry lines short enough for the configured width.
- Every time telemetry sections, labels, or metrics are changed, verify `src/telemetry/telemetry_panel.js` is coherent with the current telemetry and update it in the same change set.
- Update the ASCII legend when new entities are added.

## Validation checklist

- Run `npm start` and confirm the telemetry/legend renders.
- Run deterministic headless benchmark before finalizing balance defaults:
  `node scripts/headless_benchmark.js --ticks 8000 --seeds 101,202,303,404 --progress --progress-every 2000`.
- Ensure cached baseline is aligned with the active candidate profile:
  `npm run bench:ensure-baseline`.
- For A/B tuning, run candidate-only benchmark and diff against cached baseline:
  `npm run bench:candidate -- --set path=value && npm run bench:diff`.
- Always compare against `benchmark_cache/headless_benchmark_baseline.json` instead of writing ad-hoc baseline copies in `debug/`.
- Do not stop long-running validations early just because they take longer than expected; keep them running when they are making progress so results remain statistically reliable over wide horizons.
- Treat seed collapses (population crashes) and strong stockpile regressions as tuning blockers unless intentional and documented.
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
