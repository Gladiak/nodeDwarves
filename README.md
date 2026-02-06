# NodeDwarves 🛠️

An autonomous, gamey dwarf colony simulation that lives entirely in your terminal.
No player input after launch: the colony gathers, adapts, and tries to keep itself
alive while you watch the chaos unfold in ASCII. Grab popcorn. :)

Think of it as a living systems sandbox: you tune config, press run, and watch
trade-offs emerge from shortages, weather, raids, and long-term growth pressure.

## Screenshot 📸

![NodeDwarves simulation](assets/NodeDwarves.png)

## Highlights ✨

- 🧠 Fully autonomous ASCII colony sim with real-time rendering.
- ⛏️ Resource economy with production chains and rare minerals (yes, shiny ones).
- 🏘️ Village growth with structures, roads, and organic placement.
- 🌦️ Seasons, weather, festivals, and wildlife that shift priorities (raids optional).
- 📜 Merchant trading, caravan contracts, and faction reputation.
- 🗝️ Endgame ruins expeditions with artifacts, set bonuses, and cycle resets.
- 🏛️ Dwarf Temple of Ancestors: biome-aware multi-stage final work with prestige growth.
- ⚗️ Alchemy Lab rites: burn rare minerals for powerful global buffs, then survive the backlash.
- 🛡️ Clan culture traits that create trade-offs without micromanagement.
- 🤖 AI training in Python (PPO) with JS-only inference.
- 🧩 Modular architecture (simulation, state, render, AI) for sane iteration.
- ⚡ Late-game pathing cache optimizations for smoother high-population ticks.
- 🔧 Configurable performance knobs for heavy profiling runs.

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
- `m`: export current map (PNG + SVG)
- `Shift+M`: export map with structures/roads

## AI training (optional) 🤖

```bash
npm run ai:bootstrap
npm run ai:train
npm run ai:play
```

For training presets, evaluation, and overrides, see `MANUAL.md` and
`docs/TRAINING_OVERRIDES.md`.

Training now highlights every best-checkpoint save with a colored `[BEST SAVED]`
line and keeps both `models/policy_best.json` and `models/policy_best.meta.json`
in sync. 🧠

## Four runs to try ⚡

1. `Vanilla sim`: `npm start`
2. `Train then watch`: `npm run ai:train` then `npm run ai:play`
3. `Capture the world`: during runtime press `m` (or `Shift+M`) for map export
4. `CLI map export`: `npm run map:export -- --width=120 --height=40 --season=spring`

## Documentation 📚

- `MANUAL.md`: technical and gameplay manual (systems, formulas, workflows).
- `docs/PARAMETERS.md`: full config reference.
- `docs/TRAINING_OVERRIDES.md`: training override guide.
- `AGENTS.md`: contribution and implementation guidelines.

## Roadmap ideas 🧭

- 🛰️ Fog-of-war + scouting: unlock map intel with explorers, towers, and rumors.
- 🧬 Lineages and legacy perks: clan bloodlines evolve traits across cycles.
- ⚖️ Dynamic laws: policy toggles that trade safety, productivity, and morale.
- 🔥 Disaster arcs: drought → fire → recovery chain with emergent priorities.
- 🧭 World events: traveling bards, rival caravans, and time-limited opportunities.
- 🧭 Multi-village specialization: assign production roles per settlement.
- 🗺️ Expedition map: alternate tactical layer for ruins parties and outcomes.
- 🧠 AI governors: trainable sub-policies for jobs, trade, and building.
- 🕳️ Underrealm Front: start with one chamber, then expand into a full depth-layer as a second strategic dimension.

## Project layout (high level) 🧱

- `app.js`: entrypoint and main loop.
- `config.json`: single source of truth for tunables.
- `src/`: simulation, state, rendering, AI.
- `src/simulation/alchemy.js`: alchemy rites, pact lifecycle, and backlash logic.
- `src/simulation/temple.js`: Temple of Ancestors stages, map footprint, and prestige system.
- `scripts/train_wrapper.js`: safe unified wrapper for all `ai:train:*` profiles.
- `python/`: PPO training + agent example.
- `docs/`: parameter reference and training overrides.
- `models/`: policy checkpoints.
- `scripts/`: utilities and regression tooling.

## Collaborate with us 🤝

Open a PR or start a discussion if you want to help with simulation design, AI
training, or terminal UX. Start with `MANUAL.md` for the technical tour. ;)

## License 📄

MIT
