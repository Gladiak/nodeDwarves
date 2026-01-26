# NodeDwarves

An autonomous, gamey dwarf colony simulation that lives entirely in your terminal.
No player input after launch: the colony gathers, adapts, and tries to keep itself
alive while you watch the chaos unfold in ASCII.

## Why this exists

- Experiment-friendly sandbox for AI policy training.
- Clean, modular codebase that is easy to extend.
- Fast feedback loop with a lightweight terminal renderer.

## How the simulation works

- The world is a fixed-size ASCII grid with resource nodes, structures, and dwarves.
- Each tick:
  1. Dwarves accumulate needs (hunger, thirst).
  2. Resources are consumed when needs cross thresholds.
  3. Shortages are computed vs target stockpile levels.
  4. Jobs are assigned based on the largest shortages (gathering only for now).
  5. Dwarves move to targets, work, and update stockpiles.
- Resource nodes have finite capacity and regenerate slowly.
- Seasons apply simple modifiers to pace (needs, gather speed, regen).
- Population is dynamic: dwarves age, form bonds, reproduce with gestation, and can die.
- Rendering is done as a full-frame redraw with a header + side HUD.
- HUD includes ASCII bars for average hunger/thirst and stockpile levels.

## Job system and priorities

- Shortages are sorted by severity (missing/target ratio).
- If a resource has nodes on the map, a gather job is created.
- Crafting is disabled for now; only food/water gathering is active.
- Top priorities are displayed in the HUD queue.

## Quick start

Make sure you have Node.js and Python 3 installed.

Install dependencies (none for now, but keep this for future use):

```bash
npm install
```

Run the simulation:

```bash
npm start
```

## AI mode (Python)

The AI lives in Python (PyTorch PPO) and talks to the simulation over
stdin/stdout JSON lines. Training uses a 2x128 MLP and exports JSON weights
so inference stays in JS.

Bootstrap the Python venv + deps (recommended once):

```bash
npm run ai:bootstrap
```

`ai:train` and `ai:agent` run the bootstrap automatically if needed.

Run the headless server (optional if you use `ai:agent` or `ai:train`):

```bash
npm run ai:server
```

Run the example Python agent:

```bash
npm run ai:agent
```

Run the training loop (multiple episodes):

```bash
npm run ai:train
```

The training loop saves a PPO policy to the path in
`ai.training.trainer.modelPath` (default `models/policy.json`). The best-eval
snapshot is saved to `ai.training.trainer.bestModelPath` (default
`models/policy_best.json`) and its score is tracked in
`ai.training.trainer.bestModelMetaPath` (default `models/policy_best.meta.json`).
`npm run ai:play` loads the best-eval snapshot by default.
The policy is a 2x128 MLP that outputs **resource weight vectors** to bias job
priorities each step. The training loop resets the environment between episodes
and updates the policy.
Training is incremental by default: if `ai.training.trainer.resumeFromBest` is
enabled, training resumes from the best snapshot when it exists; otherwise it
resumes from `modelPath`. To start fresh:

```bash
python python/train.py --fresh
```

`--fresh` deletes the existing policy files (`modelPath`, `bestModelPath`,
`bestModelMetaPath`) before training.
Training runs on CPU for stability. You can enable parallel rollouts with
`ai.training.trainer.workers`.

Curriculum training (strong scarcity + randomization) is enabled by default.
You can tune it with CLI flags like `--difficulty-start`, `--difficulty-end`,
and `--difficulty-ramp`, or adjust ranges in `config.json` under `ai.training`.

Run the visual simulation with the trained policy:

```bash
npm run ai:play
```

Or provide a custom policy path:

```bash
node app.js --ai models/policy_best.json
```

### Step-by-step setup (fresh machine)

1. Install Node.js (LTS) and Python 3.
2. Clone the repo and enter it.
3. Run `npm install`.
4. (Optional) Run `npm run ai:bootstrap` once to set up the venv.
5. Start the game with `npm start`.
6. For AI training, run `npm run ai:train`.
7. To watch the learned policy, run `npm run ai:play`.

## Configuration

All core knobs live in `config.json`.
The training loop reads defaults from `ai.training.trainer` and CLI flags can
override any of them.

### Parameter reference

Display and layout:

- `display.autoSize`: auto-size the grid to the terminal.
- `display.width`: base grid width when not auto-sized.
- `display.height`: base grid height when not auto-sized.
- `display.maxWidth`: max grid width when auto-sized.
- `display.maxHeight`: max grid height when auto-sized.
- `display.tickMs`: milliseconds between ticks in the visible simulation.
- `display.header.enabled`: enable the header bar.
- `display.header.height`: header height in lines.
- `display.header.title`: header title text.
- `display.footer.enabled`: enable the footer bar.
- `display.footer.height`: footer height in lines.
- `display.hud.enabled`: enable the HUD panel.
- `display.hud.width`: HUD width in characters.
- `display.hud.columns`: number of HUD columns.
- `display.hud.columnGap`: gap between HUD columns.
- `display.hud.stockBarMax`: stockpile bar scale (0 = use targets).

Events:

- `events.maxEntries`: number of recent events to show in the HUD.

AI and training:

- `ai.stepTicks`: ticks simulated per AI decision.
- `ai.maxTicks`: episode tick limit for headless training.
- `ai.minWeight`: minimum allowed weight for priorities.
- `ai.maxWeight`: maximum allowed weight for priorities.
- `ai.criticalNeedThreshold`: need value considered critical (0..1).
- `ai.runtime.enabled`: enable trained policy in live simulation.
- `ai.runtime.policyPath`: path to the trained policy file.
- `ai.defaultWeights.<resource>`: fallback priority weights per resource.
- `ai.reward.stockpileAvg`: reward contribution for average stockpile ratio.
- `ai.reward.stockpileMin`: reward contribution for minimum stockpile ratio.
- `ai.reward.stockpilePopGate`: gate stockpile reward by population factor.
- `ai.reward.survival`: survival bonus scaled by population factor.
- `ai.reward.populationDelta`: reward per net population change (positive for births, negative for losses).
- `ai.reward.populationBalance`: reward for staying near soft cap.
- `ai.reward.criticalNeeds`: penalty for critical needs fraction.
- `ai.reward.idleAdults`: penalty for idle adults fraction.
- `ai.reward.death`: penalty per death.
- `ai.reward.extinction`: penalty when population hits zero.
- `ai.training.enabled`: enable curriculum randomization.
- `ai.training.difficultyStart`: starting difficulty (0..1).
- `ai.training.difficultyEnd`: ending difficulty (0..1).
- `ai.training.difficultyRampEpisodes`: episodes to reach max difficulty.
- `ai.training.randomization.stockpileScale`: scale range for starting stockpiles.
- `ai.training.randomization.stockpileFloor`: minimum stockpile after scaling.
- `ai.training.randomization.nodeCountScale`: scale range for node counts.
- `ai.training.randomization.nodeCountMin`: minimum nodes per resource.
- `ai.training.randomization.nodeCapacityScale`: scale range for node capacity.
- `ai.training.randomization.nodeRegenScale`: scale range for node regen amount.
- `ai.training.randomization.needDecayScale`: scale range for need decay rates.
- `ai.training.randomization.seasonStartRandom`: randomize starting season.
- `ai.training.randomization.seasonTickRandom`: randomize tick in season.
- `ai.training.trainer.algorithm`: training algorithm (PPO only right now).
- `ai.training.trainer.episodes`: training episodes per run.
- `ai.training.trainer.maxSteps`: max steps per episode.
- `ai.training.trainer.stepTicks`: ticks advanced per action during training.
- `ai.training.trainer.gamma`: discount factor for PPO.
- `ai.training.trainer.gaeLambda`: GAE lambda for advantage estimation.
- `ai.training.trainer.clipRange`: PPO clip range.
- `ai.training.trainer.entropyCoef`: entropy bonus coefficient.
- `ai.training.trainer.valueCoef`: value loss coefficient.
- `ai.training.trainer.lr`: learning rate.
- `ai.training.trainer.lrFinal`: final learning rate after linear decay.
- `ai.training.trainer.epochs`: PPO epochs per update.
- `ai.training.trainer.miniBatchSize`: minibatch size for PPO updates.
- `ai.training.trainer.batchEpisodes`: episodes per update batch.
- `ai.training.trainer.hiddenSizes`: MLP hidden layer sizes (e.g. `[128, 128]`).
- `ai.training.trainer.activation`: hidden-layer activation (`tanh` or `relu`).
- `ai.training.trainer.logStdInit`: initial log-std for action sampling.
- `ai.training.trainer.maxGradNorm`: gradient norm clip.
- `ai.training.trainer.workers`: number of parallel rollout workers.
- `ai.training.trainer.logEvery`: episodes between training logs.
- `ai.training.trainer.evalEvery`: episodes between evaluation runs.
- `ai.training.trainer.evalEpisodes`: evaluation episode count.
- `ai.training.trainer.modelPath`: policy output path.
- `ai.training.trainer.bestModelPath`: best-eval policy output path.
- `ai.training.trainer.bestModelMetaPath`: best-eval metadata output path.
- `ai.training.trainer.resumeFromBest`: resume training from the best snapshot.
- `ai.training.trainer.seed`: base RNG seed (0 = random).

Simulation:

- `simulation.maxTicks`: hard stop for visible simulation (0 = no limit).

Population:

- `dwarves.count`: initial dwarf count.
- `population.initialAgeRange.min`: minimum starting age (ticks).
- `population.initialAgeRange.max`: maximum starting age (ticks).
- `population.aging.adultAge`: ticks before adulthood.
- `population.aging.fertileStart`: fertile age start.
- `population.aging.fertileEnd`: fertile age end.
- `population.aging.oldAgeStart`: start of old-age mortality.
- `population.aging.maxAge`: max lifespan cap.
- `population.relationships.interactionsPerTick`: random interactions per tick.
- `population.relationships.idleInteractionMultiplier`: extra interactions when adults are idle.
- `population.relationships.maxDistance`: max distance for bonding.
- `population.relationships.bondGain`: bond increase per interaction.
- `population.relationships.bondDecay`: bond decay when not interacting.
- `population.relationships.bondThreshold`: bond score to form a pair.
- `population.reproduction.enabled`: enable reproduction.
- `population.reproduction.gestationTicks`: gestation length in ticks.
- `population.reproduction.baseChance`: base conception chance.
- `population.reproduction.cooldownTicks`: cooldown after birth.
- `population.reproduction.resourcePerCapita.<resource>`: resources required per dwarf.
- `population.reproduction.softCap`: soft population cap for crowding penalty.
- `population.reproduction.crowdingMinFactor`: minimum crowding factor.
- `population.reproduction.moraleInfluence`: morale weight on conception chance.
- `population.reproduction.birthCost.<resource>`: resources consumed at conception.
- `population.death.starvationThreshold`: need threshold to start starvation.
- `population.death.starvationTicks`: ticks before starvation death.
- `population.death.oldAgeChanceMin`: min old-age death chance per tick.
- `population.death.oldAgeChanceMax`: max old-age death chance per tick.

Resources and economy:

- `resources.stockpile.<resource>`: initial stockpile per resource.
- `resources.targets.<resource>`: desired stockpile per resource.
- `resources.defaultNodeCapacity`: fallback capacity for resource nodes.
- `resources.nodeCapacity.<resource>`: per-resource node capacity overrides.
- `resources.removeDepletedNodes`: remove nodes when empty (if regen off).
- `resources.nodeRegen.enabled`: enable node regeneration.
- `resources.nodeRegen.intervalTicks`: ticks between regen pulses.
- `resources.nodeRegen.amount`: amount regenerated per pulse.
- `resources.nodeRegen.onlyDepleted`: only regenerate fully depleted nodes.
- `resources.nodes.<resource>`: number of nodes placed on the map.

Seasons:

- `seasons.enabled`: enable seasonal modifiers.
- `seasons.durationTicks`: ticks per season.
- `seasons.order`: ordered list of season names.
- `seasons.modifiers.<season>.needDecay`: needs decay multiplier.
- `seasons.modifiers.<season>.gatherYield`: gather yield multiplier.
- `seasons.modifiers.<season>.gatherTicks`: gather time multiplier.
- `seasons.modifiers.<season>.nodeRegen`: node regen multiplier.
- `seasons.modifiers.<season>.reproductionChance`: reproduction chance multiplier.

Needs and consumption:

- `needs.initial.<need>`: initial need values (0..1).
- `needs.decayPerTick.<need>`: per-tick need decay rates.
- `consumption.hungerThreshold`: hunger threshold to eat.
- `consumption.thirstThreshold`: thirst threshold to drink.
- `consumption.hungerTarget`: desired hunger cap after eating.
- `consumption.thirstTarget`: desired thirst cap after drinking.
- `consumption.maxUnitsPerTick`: max food/water units consumed per tick.
- `consumption.rawFoodRelief`: hunger relief per raw food unit.
- `consumption.waterRelief`: thirst relief per water unit.

Jobs and gathering:

- `jobs.defaultGatherTicks`: default gather time in ticks.
- `jobs.defaultGatherYield`: default gather yield.
- `jobs.gatherTicks.<resource>`: per-resource gather time override.
- `jobs.gatherYield.<resource>`: per-resource gather yield override.

Symbols:

- `symbols.empty`: empty cell symbol.
- `symbols.dwarf`: dwarf symbol.
- `symbols.food_raw`: raw food node symbol.
- `symbols.water`: water node symbol.

## ASCII legend

The legend is printed below the map in the footer. Symbols are configurable in
`config.json` under `symbols`.

## Project layout

```text
.
├── ai_server.js                  # Headless JSON server for Python agents
├── app.js                        # Entrypoint and main loop
├── config.json                   # Simulation knobs and defaults
├── REQUIREMENTS.md               # MVP requirements
├── README.md
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

## Collaborate with us

Want to help push this experiment forward? We would love contributors who are
into simulation design, AI training loops, and terminal UX.

Ways to jump in:

- Propose features or balance ideas via issues.
- Improve the job system and resource economy.
- Prototype the Python AI bridge and policies.

Open a PR or start a discussion with your ideas.

## Roadmap ideas

- Smarter AI policies (Python bridge).
- World events and biome variation.
- Simple trading or tech progression.

## License

MIT
