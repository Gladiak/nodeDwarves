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
- 🌤️ In-map Ops Snapshot shows a live weather token (`Wx:*`, e.g. `Clear`, `Rain`, `Storm`) for at-a-glance climate context.
- 📊 In-game Data Center (`h`) with dashboard, deep economy views, and AI explainability.
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

Export map layers:

```bash
npm run map:export -- --width=120 --height=40 --layers=surface,d1,d2
```

## Controls 🎮

- ⏯️ `Space`: pause/resume
- 🗺️ `l`: legend
- 🔍 `i`: dwarf inspect panel
- ⚔️ `w`: Warrior League modal
- 📡 `h`: telemetry Data Center
- 🧾 `e`: Event Log modal
- 🔁 `f`: switch Event Log filter
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

Quality-oriented loop:

```bash
npm run ai:train:quality
npm run ai:validate:canonical
npm run ai:validate:gate
npm run ai:validate:risk
npm test
```

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

Useful presets:

```bash
npm run ai:validate:benchmark
npm run ai:validate:regression
npm run ai:validate:extended:optimized
npm run debug:clean
```

## Documentation 📚

- 📘 `MANUAL.md`: technical runbook (systems, runtime flow, operations).
- ⚙️ `docs/PARAMETERS.md`: complete config parameter reference.
- 🧩 `docs/TRAINING_OVERRIDES.md`: training override guide.
- ✅ `docs/TRAINING_STATUS.md`: current quality status and validation cadence.
- 🧪 `docs/TRAINING_OPTIMIZATION_WORKBOOK.md`: optimization timeline and decisions.
- 📡 `docs/TELEMETRY.md`: telemetry operator guide.
- 🤖 `AGENTS.md`: contributor implementation guidelines.

## Project Layout (High Level) 🧱

- 🚀 `app.js`: simulation entrypoint and loop.
- 🎛️ `config.json`: single source of truth for tuning knobs.
- 🌉 `ai_server.js`: JS inference bridge used by training/eval tooling.
- 🧭 `src/config.js`: config loader.
- ⚙️ `src/simulation/`: core simulation systems (economy, events, underrealm, schism, social drama, warriors, temple).
- 🌍 `src/state/`: world/terrain and initial state generation.
- 🎨 `src/render/`: map, overlays, panels, and layout helpers.
- 📊 `src/telemetry/`: Data Center sections and metric builders.
- 🧠 `src/ai/`: observation and policy helpers.
- 🛠️ `scripts/`: benchmarking, regression, validation orchestration, export, cleanup.
- 🐍 `python/`: PPO training and rollout tooling.
- 🗂️ `benchmark_cache/`: cached deterministic benchmark baseline.
- 📦 `regression/baselines/`: durable regression reference profiles.
- 📚 `docs/`: manuals and tuning references.

## Contributing 🤝

PRs are welcome for simulation design, AI quality, and terminal UX.
Start with `AGENTS.md` + `MANUAL.md` for implementation standards and workflows.

## License 📄

MIT
