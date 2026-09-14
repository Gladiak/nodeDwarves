# NodeDwarves 🛠️

NodeDwarves is an autonomous ASCII dwarf-colony simulator that runs entirely in your terminal.
Start a run, watch the settlement react to shortages and crises, and tune the system like a tiny living lab. 🍺⛏️
Chaos, strategy, and tiny bearded logistics experts included. 🧔🧱

## Screenshots 📸

![NodeDwarves simulation 1](assets/NodeDwarves_1.png)
![NodeDwarves simulation 2](assets/NodeDwarves_2.png)
![NodeDwarves simulation 3](assets/NodeDwarves_3.png)

## Highlights ✨

- 🧠 Fully autonomous colony sim: no micromanagement after launch.
- ⛏️ Multi-layer economy with gathering, structures, shortages, and recovery loops.
- 🌦️ Seasons, weather, festivals, raids, and world events that shift priorities.
- 🤝 External camps, diplomacy pressure, contracts, and faction trade opportunities.
- 🎭 Social drama + schism systems for long-horizon political and morale instability.
- 🕳️ Underrealm exploration with depth progression, combat pressure, and endgame cadence.
- 🏅 Warrior League with hero progression, tournaments, injuries, and lineage memory.
- 📜 Deterministic structured events preserve who/where/why facts behind the compact terminal log,
  including lifecycle milestones, social incidents, battles, tournament legacies, council decrees,
  ritual transitions, diplomacy, world/culture shifts, construction milestones, relic recovery, and
  cycle passages. The Event Log exposes importance, named actors, place, and saga context without
  abandoning its compact all/drama views; a source audit guards against legacy-only producers.
- 🪪 One shared dwarf identity resolver keeps names, houses, role titles, stable IDs, and historical
  champion snapshots coherent across Inspect, Event Log, Warrior League, and telemetry. Priority
  story messages use names instead of raw dwarf IDs, adding house context only for collisions.
- 🗿 Villages, roads, the Deep Gate, lifts, ruins, and the Ancestor Temple receive deterministic
  names stored with the world. Events, Inspect, and telemetry share those names, with short labels
  ready for cramped terminals.
- 👁️ When population exceeds the map cap, urgent story actors, endangered dwarves, champions, saga
  protagonists, and recent incident actors keep their place on-screen through a stable RNG-free
  priority selector.
- 🎬 A bounded, deterministic Story Director scores canonical facts by severity, rarity, named cast,
  consequences, saga continuity, and visible map layer. Cooldowns and interruption budgets keep the
  spotlight readable while critical events can preempt weaker focus—with every decision explained.
  Related facts become stable sagas with explicit lifecycles and compact chapters derived only from
  events that actually happened. The Data Center and headless reports expose the current focus,
  current saga, cooldowns, selection reasons, priority coverage, suppression counts, and saga
  outcomes.
- 🎞️ A compact in-map Story Ribbon turns the Director's active focus into an immediate
  actor → action → place → consequence beat, with deterministic narrow-terminal fallbacks and clean
  modal/Operations Snapshot collision rules. A restrained focus overlay recolors at most two
  involved dwarves and marks locations only for critical or legendary beats; off-layer action is
  reported in the ribbon instead of cluttering the current map.
- ⏱️ Explicit controls from `0.5x` through batched `100x`, plus exact single-step, support both close
  observation and rapid endgame trials. Critical beats temporarily slow the visible loop, legendary
  beats briefly hold it, and every accelerated tick still runs the full simulation, AI cadence, and
  endgame checks without changing PPO inputs.
- 🗝️ Late-game relic expeditions remain dangerous but feasible: the maximum D10 loadout can enter the
  warning band, while repeat artifact hunts use a D9 readiness ceiling after the ruins are cleared.
- 📖 Major lived deeds now follow each dwarf as a bounded, source-backed biography. Inspect separates
  witnessed history from inherited lore, while cycle transitions distill seven factual Chronicle
  chapters. Press `c` to export deterministic Markdown and JSON records with source-event trails.
- 🌤️ In-map Ops Snapshot shows a live weather token (`Wx:*`, e.g. `Clear`, `Rain`, `Storm`) for at-a-glance climate context.
- 📊 In-game Data Center (`h`) with dashboard, deep economy views, Story Director visibility, and AI explainability.
- 🤖 PPO training pipeline in Python with JS runtime inference (`models/*.json`).
- 🧪 Deterministic benchmark/regression tooling with cached baseline comparison.

## Quick Start 🚀

```bash
npm install
npm start
```

Run with the best trained policy (if available):

```bash
npm run ai:play
```

## Controls 🎮

- ⏯️ `Space`: pause/resume
- 🐢 `[` / `]` 🐇: decrease/increase visible simulation speed (`0.5x`, `1x`, `2x`, `4x`, `5x`, `25x`, `100x`; default `100x` for fast endgame trials)
- 👣 `.`: advance exactly one tick and remain paused
- 🗺️ `l`: legend
- 🔍 `i`: dwarf inspect panel
- ⚔️ `w`: Warrior League modal
- 📡 `h`: telemetry Data Center
- 🧾 `e`: Event Log modal
- 🔁 `f`: switch Event Log filter
- 📖 `c`: export the latest completed (or current) Chronicle as Markdown + JSON
- ↔️ `←` / `→`: switch telemetry pages (or browse context-specific panels)
- ↕️ `↑` / `↓`: change map depth view (or scroll Event Log)
- 🖼️ `m`: export unlocked layers (PNG + SVG)
- 🏗️ `Shift+M`: export unlocked layers with structures/roads

## AI Training (Optional) 🤖

Bootstrap once, then train/play:

```bash
npm run ai:bootstrap
npm run ai:train
npm run ai:play
```

Quality-oriented loop and acceptance gate:

```bash
npm run ai:train:m4
npm run ai:train -- quality
npm run ai:validate
npm run audit:narrative-producers
npm run test:narrative
npm test
```

`audit:narrative-producers` reports direct legacy-only event writers. `test:narrative` runs the fast
structured-event contract gate in isolation. `npm test` runs the audit plus narrative and
training/validation contract suites.

`ai:train:m4` is the direct shortcut for the `m4-balanced` profile. The generic
`ai:train` command accepts the wrapper profile after `--`: `fast` (default), `quality`,
`quality-mixed`, `m4-balanced`, `full`, `endgame`, or `benchmark`. The
`m4-balanced` profile is the sustainable speed/quality preset for a 10-core,
16 GB Apple M4: quality-mixed foundation/finetune, a dedicated 20,000-tick
endgame specialization phase, `5→4→3` workers, sparse intermediate evaluation,
and one guarded final canonical check. Add `--fresh` after the profile when
observation or action contracts change.

For full profiles, continuous training cadence, and override strategy, use:
- 📘 `MANUAL.md`
- 🧩 `docs/TRAINING_OVERRIDES.md`
- ✅ `docs/TRAINING_STATUS.md`

## Balance & Benchmark Workflow ⚖️

Keep tuning deterministic and comparable:

```bash
npm run bench:ensure-baseline
npm run bench:candidate -- --set path=value
npm run bench:diff
```

Long-running and weekly checks:

```bash
npm run ai:train:continuous
npm run ai:validate
npm run ai:validate:weekly
npm run debug:clean
```

## Documentation 📚

- 📘 `MANUAL.md`: technical runbook (systems, runtime flow, operations).
- ⚙️ `docs/PARAMETERS.md`: complete config parameter reference.
- 🧩 `docs/TRAINING_OVERRIDES.md`: training override guide.
- ✅ `docs/TRAINING_STATUS.md`: current quality status and validation cadence.
- 🧪 `docs/TRAINING_OPTIMIZATION_WORKBOOK.md`: optimization timeline and decisions.
- 📜 `docs/EPIC_EVOLUTION_WORKBOOK.md`: step-by-step roadmap and progress tracker for the living-chronicle evolution.
- 🧬 `docs/NARRATIVE_EVENT_CONTRACT.md`: versioned facts, deterministic event identity, and bounded-history rules for the living chronicle.
- 📡 `docs/TELEMETRY.md`: telemetry operator guide.
- 🤖 `AGENTS.md`: contributor implementation guidelines.

## Project Layout (High Level) 🧱

- 🚀 `app.js`: simulation entrypoint and loop.
- 🎛️ `config.json`: single source of truth for tuning knobs.
- 🌉 `ai_server.js`: JS inference bridge used by training/eval tooling.
- 🧭 `src/config.js`: config loader.
- ⚙️ `src/simulation/`: core simulation systems (economy, events, underrealm, schism, social drama, warriors, temple).
- 🧬 `src/simulation/narrative_contract.js`: strict narrative-event validation and deterministic identity helpers.
- 🧹 `src/simulation/narrative_normalizer.js`: bounded event normalization and deterministic payload compaction.
- 🧭 `src/simulation/secondary_events.js`: shared structured facts for world, culture, environment, economy, and development events.
- 👥 `src/simulation/lifecycle_events.js`: structured founding, birth, death, and partnership story facts.
- 🎭 `src/simulation/social_events.js`: structured mentorship, rivalry, grudge, and reconciliation facts.
- ⚔️ `src/simulation/combat_events.js`: structured raid, expedition, Underrealm battle, and champion facts.
- 🏅 `src/simulation/warrior_events.js`: structured Warrior League progression, tournament, Hall of Fame, and command facts.
- 🔥 `src/simulation/political_events.js`: structured doctrine, phase, ritual, decree, and schism-climax facts.
- 🔁 `src/simulation/endgame_events.js`: structured relic, cycle passage, and legacy carry-over facts.
- 🎬 `src/simulation/story_director.js`: bounded deterministic story scoring, focus selection, and explainability state.
- 📚 `src/simulation/story_sagas.js`: deterministic saga grouping, lifecycle, evidence, and fact-backed chapters.
- 🧾 `src/simulation/experience_ledger.js`: bounded per-dwarf lived deeds, merge rules, and biography views.
- 📖 `src/simulation/chronicle.js`: fact-backed cycle chapters, integrity checks, and bounded archives.
- 💾 `src/chronicle_export.js`: deterministic safe-path Markdown/JSON Chronicle export.
- 🌍 `src/state/`: world/terrain and initial state generation.
- 🎨 `src/render/`: map, overlays, panels, and layout helpers.
- 👁️ `src/render/dwarf_visibility.js`: stable story-priority selection for capped dwarf rendering.
- 🎞️ `src/render/story_ribbon.js`: responsive read-only presentation of the active story focus.
- ✨ `src/render/story_focus_overlay.js`: bounded actor/location emphasis and cross-layer focus cues.
- ⏱️ `src/runtime/time_controls.js`: presentation-only speed, pause, step, and major-event protection controller.
- 📊 `src/telemetry/`: Data Center sections and metric builders.
  - `src/telemetry/story_director.js`: Story Director telemetry rows and headless report counters.
- 🧠 `src/ai/`: observation and policy helpers.
- 🪪 `src/dwarf_identity.js`: shared cached identity and historical-fallback resolver.
- 🗿 `src/place_identity.js`: bounded authoritative registry for deterministic world-place names.
- 🛠️ `scripts/`: benchmarking, regression, validation orchestration, narrative contracts, export, cleanup.
- 🧪 `scripts/test_narrative_contracts.js`: fast executable gate for the living-chronicle event contract.
- ⏱️ `scripts/test_time_controls.js`: deterministic E4.3 timing, input precedence, rendering, and isolation gate.
- 📖 `scripts/test_chronicle_contracts.js`: E5 ledger, biography, Chronicle, reset, export, bounds, and AI-isolation gate.
- 🔎 `scripts/audit_narrative_producers.js`: zero-legacy producer audit used by `npm test`.
- 🐍 `python/`: PPO training and rollout tooling.
- 🗂️ `benchmark_cache/`: cached deterministic benchmark baseline.
- 📸 `debug/epic_e4_time_controls_{120,72}.png`: retained full/narrow E4 presentation evidence.
- 🧪 `debug/headless_benchmark_{candidate,diff}.{json,md}`: latest canonical E5 balance evidence.
- 📦 `regression/baselines/`: durable regression reference profiles.
- 📜 `chronicles/`: generated Chronicle exports (git-ignored).
- 📚 `docs/`: manuals, tuning references, the Epic Evolution workbook, and the narrative event contract.

## Contributing 🤝

PRs are welcome for simulation design, AI quality, and terminal UX.
Start with `AGENTS.md` + `MANUAL.md` for implementation standards and workflows.

## License 📄

MIT
