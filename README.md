# NodeDwarves 🛠️

An autonomous, gamey dwarf colony simulation that lives entirely in your terminal.
No player input after launch: the colony gathers, adapts, and tries to keep itself
alive while you watch the chaos unfold in ASCII. Grab popcorn. :)

Think of it as a living systems sandbox: you tune config, press run, and watch
trade-offs emerge from shortages, weather, raids, and long-term growth pressure.

## Screenshots 📸

![NodeDwarves simulation 1](assets/NodeDwarves_1.png)
![NodeDwarves simulation 2](assets/NodeDwarves_2.png)
![NodeDwarves simulation 3](assets/NodeDwarves_3.png)
![NodeDwarves simulation 4](assets/NodeDwarves_4.png)
![NodeDwarves simulation 5](assets/NodeDwarves_5.png)

## Highlights ✨

- 🧠 Fully autonomous ASCII colony sim with real-time rendering.
- ⛏️ Resource economy with production chains and rare minerals (yes, shiny ones).
- 🍺 Brewery + beer morale tuning for long-run saves, so mid/late-game morale fuel stays active.
- 🏘️ Village growth with structures, roads, and organic placement.
- 🌦️ Seasons, weather, festivals, and wildlife that shift priorities (raids optional).
- 📜 Merchant trading, caravan contracts, and faction reputation.
- 🎭 World events now live: traveling bards, rival caravans, and short-deadline opportunities.
- 🗝️ Endgame ruins expeditions with artifacts, set bonuses, and cycle resets.
- 🏛️ Dwarf Temple of Ancestors: biome-aware multi-stage final work with prestige growth.
- 🧭 Economy telemetry now includes an Endgame checklist with live step completion and reset ETA.
- ⚗️ Alchemy Lab rites: burn rare minerals for powerful global buffs, then survive the backlash.
- 🛡️ Clan culture traits that create trade-offs without micromanagement.
- 🕳️ Underrealm Front: 10 depth layers with engineered dwarven halls and dense stone-hewn caverns.
- 🗺️ Map Focus default: no side telemetry column; `h` opens a full-screen paged telemetry Data Center while the map keeps full width.
- 🪟 Terminal-aware layout: with `display.autoSize` the map follows your terminal size (max caps optional), and live resize can keep world geometry locked to avoid infrastructure reflow resets.
- 🪟 In-map Ops Snapshot: a top-right status stack with core runtime signals (time, population, underrealm + view) and a fixed keyboard-command row, without letting roads/buildings/pathing use that carved space.
- 🤖 AI training in Python (PPO) with JS-only inference.
- 🧩 Modular architecture (simulation, state, render, AI) for sane iteration.
- ⚡ Late-game pathing cache optimizations for smoother high-population ticks.
- 🔧 Configurable performance knobs for heavy profiling runs.

## Render charset 🧱

- Core map rendering is ASCII-first, with CP437-friendly symbols for enhanced readability in terminal fonts.
- Underrealm markers follow the same charset logic (`☻` delvers, `☠` deep hostiles), so terminal fallback stays consistent.

## Why it feels good to run 🧪

- You are not micromanaging units: you are validating a system.
- Small config tweaks can produce very different colony behavior.
- Runs are readable in terminal form, so balancing loops is fast.
- You can use it as a game, an AI sandbox, or both.

## Quick start 🚀

```bash
npm install
npm start
```

If you already have a trained model, run:

```bash
npm run ai:play
```

## Controls 🎮

- `Space`: pause/resume
- `l`: legend panel
- `i`: dwarf inspect panel
- `h`: telemetry Data Center overlay (`Overview + Deep`, `Economy`) with expanded plain-language metric labels and an `Endgame` progress checklist on the Economy page
- `←` / `→`: change telemetry pages when telemetry is open, or browse dwarves when inspect is open
- `↑` / `↓`: switch map view between surface and unlocked underrealm depths
- `m`: export all currently unlocked layers (surface + underrealm) as PNG + SVG
- `Shift+M`: export all currently unlocked layers with structures/roads

## AI training (optional) 🤖

```bash
npm run ai:bootstrap
npm run ai:train
npm run ai:play
```

Quality-first full curriculum (early game + endgame + consolidation):

```bash
npm run ai:train:full:fresh
```

For training presets, evaluation, and overrides, see `MANUAL.md` and
`docs/TRAINING_OVERRIDES.md`.

Training now highlights every best-checkpoint save with a colored `[BEST SAVED]`
line and keeps both `models/policy_best.json` and `models/policy_best.meta.json`
in sync. 🧠
Latest-checkpoint writes are now decoupled from log windows (`saveEvery` /
`--save-every`) so long curriculum runs spend less time on disk I/O. ⚡
Promote checks now require a phase-specific minimum score gain (`--min-improve`)
and use more eval episodes in late phases to reduce statistical-noise promotions. 🎯
Training wrappers now auto-tune worker count from CPU capacity (with bounds and
manual `--workers` override) to behave better across different machines. ⚙️
In auto mode, workers are also phase-aware (foundation/finetune/endgame/
consolidation) and you can force flat behavior with `--workers-flat`. 🧭
Regression runs now stream subprocess logs directly to per-run files, improving
stability on long validation passes. 🧪

AI runtime now accepts a backward-compatible governor action envelope, so legacy
policy files still run while jobs/trade/building sub-policies roll out.
Jobs prioritization now reads the governor envelope first, while keeping legacy
AI weight payloads compatible.
Trade governor hooks now support advisory `trade` intents for merchant reserve,
rival caravan contests, and opportunity completion timing.
Building governor hooks now support advisory `building` ranking signals for
housing/economy/defense/special queues, with guardrails still enforced by the
existing structure checks.
Telemetry now exposes compact governor signals directly in `Pressure`,
`Diplomacy`, and `Operations` so policy intent can be inspected live.
Training action heads now include governor pseudo-action IDs when enabled; if
feature/action shapes change, restart training with `--fresh`.

## Four runs to try ⚡

1. `Vanilla sim`: `npm start`
2. `Train then watch`: `npm run ai:train` then `npm run ai:play`
3. `Capture the world`: during runtime press `m` (or `Shift+M`) to export all unlocked layers
4. `CLI map export`: `npm run map:export -- --width=120 --height=40 --season=spring --layers=surface,d1,d2 --underrealmUnlockedDepth=2`

## Documentation 📚

- `MANUAL.md`: technical and gameplay manual (systems, formulas, workflows).
- `docs/PARAMETERS.md`: full config reference.
- `docs/TRAINING_OVERRIDES.md`: training override guide.
- `AGENTS.md`: contribution and implementation guidelines.

## Roadmap ideas 🧭

- 🧬 Lineages and legacy perks: clan bloodlines evolve traits across cycles.
- ⚖️ Dynamic laws: policy toggles that trade safety, productivity, and morale.
- 🔥 Disaster arcs: drought → fire → recovery chain with emergent priorities.
- 🧭 Multi-village specialization: assign production roles per settlement.
- 🗺️ Expedition map: alternate tactical layer for ruins parties and outcomes.
- 🧠 AI governors: trainable sub-policies for jobs, trade, and building.

## Project layout (high level) 🧱

- `app.js`: entrypoint and main loop.
- `config.json`: single source of truth for tunables.
- `src/`: simulation, state, rendering, AI.
- `src/simulation/underrealm.js`: Underrealm crew, shrine doctrine, deep economy, exploration unlocks, and hostile faction pressure.
- `src/simulation/world_events.js`: world event lifecycle for bards, rival caravans, and time-limited opportunities.
- `src/simulation/alchemy.js`: alchemy rites, pact lifecycle, and backlash logic.
- `src/simulation/temple.js`: Temple of Ancestors stages, map footprint, and prestige system.
- `src/render/map_inset_panel.js`: carved in-map Ops Snapshot component with compact, width-aware runtime lines.
- `src/render/telemetry.js`: telemetry section builders and formatting helpers.
- `src/render/telemetry_panel.js`: in-game paged telemetry Data Center with section pages and full-height telemetry content area.
- `scripts/train_wrapper.js`: safe unified wrapper for all `ai:train:*` profiles.
- `scripts/regression.js`: baseline-vs-current AI regression checks (deterministic eval + randomized stability pass).
- `scripts/headless_benchmark.js`: deterministic headless benchmark for long-run balance tuning and validation.
- `python/regression_rollout.py`: rollout-only randomized regression runner used by `scripts/regression.js`.
- `python/`: PPO training + agent example.
- `docs/`: parameter reference and training overrides.
- `models/`: policy checkpoints.
- `scripts/`: utilities and regression tooling.

## Collaborate with us 🤝

Open a PR or start a discussion if you want to help with simulation design, AI
training, or terminal UX. Start with `MANUAL.md` for the technical tour. ;)

## License 📄

MIT
