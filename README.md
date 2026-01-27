# NodeDwarves

An autonomous, gamey dwarf colony simulation that lives entirely in your terminal.
No player input after launch: the colony gathers, adapts, and tries to keep itself
alive while you watch the chaos unfold in ASCII.

## Index

- [Highlights](#highlights-)
- [Simulation overview](#simulation-overview-)
- [Quick start](#quick-start-)
- [AI mode (Python)](#ai-mode-python-)
- [Configuration](#configuration-)
- [Scenario presets (training)](#scenario-presets-training-)
- [ASCII legend](#ascii-legend-)
- [Project layout](#project-layout-)

## Highlights ✨

- 🧠 Fully autonomous simulation with a real-time ASCII renderer.
- 🧺 Resource economy with food, water, wood, and stone.
- 🏘️ Village growth: houses (beds), wells (water nodes), fields (food nodes).
- ❄️ Seasons + housing effects (bonding, winter penalties).
- 🌦️ Dynamic weather cycle that reshapes needs, gathering, and regeneration.
- 🎓 PPO training in Python with JS-only inference.

## Screenshot - How it looks 📸

![NodeDwarves simulation](assets/NodeDwarves.gif)

## Simulation overview 🗺️

- 🗺️ The world is a fixed-size ASCII grid with resource nodes, structures, and dwarves.
- ⏱️ Each tick:
  1. Dwarves accumulate needs (hunger, thirst).
  2. Resources are consumed when needs cross thresholds.
  3. Shortages are computed vs target stockpile levels.
  4. Jobs are assigned based on the largest shortages.
  5. Dwarves move to targets, work, and update stockpiles.
- ♻️ Resource nodes have finite capacity and regenerate slowly.
- 🌾 Fields regenerate based on water availability and seasonal limits.
- 🌤️ Seasons apply modifiers to needs, gather speed, regen, and reproduction.
- 🌧️ Weather cycles (clear, rain, storm, drought, cold) add extra modifiers.
- 👪 Population is dynamic: dwarves age, form bonds, reproduce with gestation, and can die.
- 🪵🪨 Wood and stone build clustered villages (center-out placement).
- 🛏️ Housing provides beds; insufficient shelter slows bonding and makes winter harsher.
- 🧳 A roaming merchant visits periodically, trades surplus for scarce resources, then leaves.
- 📊 HUD shows averages, bars, priorities, and counts for wells/fields.

## Job system and priorities ⚙️

- 🧭 Shortages are sorted by severity (missing/target ratio).
- ⛏️ If a resource has nodes on the map, a gather job is created.
- 🚫 Crafting is disabled for now; gathering covers food, water, wood, and stone.
- 🏠 House construction jobs spawn when housing is below the target ratio and vital stockpiles are healthy.
- 💧 Wells are built when water stocks or water node reserves dip below thresholds.
- 🌱 Fields are built when food stocks or food node reserves dip below thresholds and baseline stockpiles are safe.

## Quick start 🚀

Make sure you have Node.js and Python 3 installed.

```bash
npm install
npm start
```

## AI mode (Python) 🤖

The AI lives in Python (PyTorch PPO) and talks to the simulation over
stdin/stdout JSON lines. Training uses a 2x128 MLP and exports JSON weights
so inference stays in JS.

Bootstrap the Python venv + deps (recommended once) 🧪:

```bash
npm run ai:bootstrap
```

Run training 🧑‍🏫:

```bash
npm run ai:train

npm run ai:train -- --episodes 5000

npm run ai:train:combo

```

You can stop training with Ctrl+C to terminate the run.

`ai:train:combo` runs the fast training loop and then a short full-sim pass
(`--full-sim`) that uses `ai.training.evalOverrides` for a more realistic finish.

Use `ai:train:combo:fresh` to force a fresh start for the fast phase:

```bash
npm run ai:train:combo:fresh
```

If you change resources or action space, reset the policy files ♻️:

```bash
npm run ai:train:fresh
```

Run the visual simulation with the trained policy 🕹️:

```bash
npm run ai:play
```

The training loop saves a PPO policy to the path in
`ai.training.trainer.modelPath` (default `models/policy.json`). The best-eval
snapshot is saved to `ai.training.trainer.bestModelPath` (default
`models/policy_best.json`) and its score is tracked in
`ai.training.trainer.bestModelMetaPath` (default `models/policy_best.meta.json`).
Training is incremental by default when `ai.training.trainer.resumeFromBest` is
enabled. Console logs stay compact, while a summary log is written to
`debug/run_*/summary.log` every 500 episodes (one line per window) with a legend.
Detailed snapshots are written to `debug/run_*/detail_ep*.log` only on notable
events (best eval, eval regression, scenario shift).
If you change observation features (e.g. add weather features), training must
restart with `--fresh`.

## Configuration 🧰

All core knobs live in `config.json`. The training loop reads defaults from
`ai.training.trainer` and CLI flags can override any of them.

See [Parameter reference](docs/PARAMETERS.md).

### Scenario presets (training) 🎯

Scenario presets let training sample hard situations on purpose (e.g. water
scarcity, low stockpiles). Each preset is a config override merged into the
base config before the usual curriculum randomization scales are applied.
You can optionally ramp a scenario's weight with difficulty using
`difficultyMin/Max` and the corresponding multipliers.

- Training picks a scenario each episode using the weights in
  `ai.training.scenarios`.
- If `ai.training.scenarioSampling.mode` is `adaptive`, weights are rebalanced
  during training to focus on the weakest-performing scenarios.
- If `ai.training.evalScenarios` is set, evaluation splits the eval episodes
  across those scenarios for a balanced score.
- The debug log includes a "Scenario mix" section that shows how often each
  preset appeared in the window.

See [Training overrides (performance)](docs/TRAINING_OVERRIDES.md).

## ASCII legend 🧷

The legend is printed below the map in the footer. Symbols are configurable in
`config.json` under `symbols`.
When house levels are enabled, houses render as digits `1` to `5` instead of `symbols.house`.

## Project layout 🧱

```text
.
├── ai_server.js                  # Headless JSON server for Python agents
├── app.js                        # Entrypoint and main loop
├── config.json                   # Simulation knobs and defaults
├── REQUIREMENTS.md               # MVP requirements
├── README.md
├── docs
│   ├── PARAMETERS.md             # Full config parameter reference
│   └── TRAINING_OVERRIDES.md     # Training overrides guide
├── python
│   ├── agent.py                  # Example Python agent
│   └── train.py                  # PPO training loop (PyTorch)
├── models
│   ├── policy_best.json          # Best-eval policy (default)
│   ├── policy_best.meta.json     # Best-eval metadata
│   └── policy.json               # Optional latest policy (configurable)
└── src
    ├── ai_policy.js              # Runtime policy loader/inference
    ├── config.js                 # Config loader
    ├── render.js                 # ASCII renderer + HUD
    ├── runtime.js                # Terminal sizing and layout
    ├── simulation.js             # Needs, jobs, movement, survival loops
    ├── state.js                  # World state + spawning
    ├── terminal.js               # Terminal helpers
    └── utils.js                  # Shared helpers
```

## Collaborate with us 🤝

Want to help push this experiment forward? We would love contributors who are
into simulation design, AI training loops, and terminal UX.

Ways to jump in:

- Propose features or balance ideas via issues.
- Improve the job system and resource economy.
- Prototype new AI curricula or reward shaping.

Open a PR or start a discussion with your ideas.

## Roadmap ideas 🧭

- Climate events (droughts, long winters, heavy rains) with survival impact.
- Housing maintenance and decay (wood/stone upkeep over time).
- Storage caps and stockpile prioritization rules.
- Specialized roles (gatherer, builder, caretaker) with distinct bonuses.
- Simple disease system tied to crowding and hygiene.
- Colony morale events that influence productivity and bonding.
- Terrain types (fertile, arid, rocky) that affect yields.
- Village security upgrades (perimeters, watchtowers, winter shelters).

## License 📄

MIT
