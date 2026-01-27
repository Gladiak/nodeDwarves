# NodeDwarves

An autonomous, gamey dwarf colony simulation that lives entirely in your terminal.
No player input after launch: the colony gathers, adapts, and tries to keep itself
alive while you watch the chaos unfold in ASCII.

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

```

You can stop training with Ctrl+C to terminate the run.

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

### Parameter reference 🧾

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
- `display.colors.enabled`: enable ANSI colors in the render.
- `display.colors.reset`: ANSI reset sequence (defaults to `\u001b[0m`).
- `display.colors.map.<key>`: ANSI color for an entity key (e.g. `dwarf`, `merchant`, `house`, `food_raw`).
- `display.colors.map.weather_<type>`: ANSI color for HUD weather labels (e.g. `weather_rain`).

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
- `ai.reward.waterStockpile`: extra reward contribution for the water stockpile ratio.
- `ai.reward.waterLowThreshold`: water ratio threshold for low-water penalty.
- `ai.reward.waterLowPenalty`: penalty applied when water is below the low threshold.
- `ai.reward.waterLowExponent`: curve exponent for the low-water penalty.
- `ai.reward.stockpilePopGate`: gate stockpile reward by population factor.
- `ai.reward.survival`: survival bonus scaled by population factor.
- `ai.reward.populationDelta`: reward per net population change.
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
- `ai.training.scenarios`: weighted scenario presets applied before randomization.
- `ai.training.scenarios[].name`: unique scenario name used by the trainer.
- `ai.training.scenarios[].weight`: sampling weight (0 disables sampling).
- `ai.training.scenarios[].overrides`: config overrides merged into the base config.
- `ai.training.evalScenarios`: list of scenario names evaluated at eval checkpoints.
- `ai.training.scenarioSampling.mode`: `static` or `adaptive` scenario reweighting.
- `ai.training.scenarioSampling.updateEvery`: episodes between adaptive weight updates.
- `ai.training.scenarioSampling.emaAlpha`: EMA smoothing for per-scenario reward.
- `ai.training.scenarioSampling.boost`: extra weight multiplier applied to weak scenarios.
- `ai.training.scenarioSampling.exponent`: curve exponent for adaptive weighting.
- `ai.training.scenarioSampling.minWeightRatio`: minimum weight ratio vs base weight.
- `ai.training.scenarioSampling.maxWeightRatio`: maximum weight ratio vs base weight.
- `ai.training.trainer.algorithm`: training algorithm (PPO only right now).
- `ai.training.trainer.episodes`: training episodes per run.
- `ai.training.trainer.maxSteps`: max steps per episode.
- `ai.training.trainer.stepTicks`: ticks advanced per action during training.
- `ai.training.trainer.gamma`: discount factor for PPO.
- `ai.training.trainer.gaeLambda`: GAE lambda for advantage estimation.
- `ai.training.trainer.clipRange`: PPO clip range.
- `ai.training.trainer.entropyCoef`: entropy bonus coefficient.
- `ai.training.trainer.entropyCoefFinal`: final entropy coefficient after decay.
- `ai.training.trainer.entropyRampEpisodes`: episodes to reach the final entropy coefficient.
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
- `ai.priorityBoosts.<resource>.threshold`: stockpile ratio below which to boost a resource.
- `ai.priorityBoosts.<resource>.multiplier`: max multiplier for boosted priority.
- `ai.priorityBoosts.<resource>.minWeight`: minimum weight enforced during boost.
- `ai.priorityBoosts.<resource>.exponent`: curve exponent for how fast the boost ramps.

Simulation:

- `simulation.maxTicks`: hard stop for visible simulation (0 = no limit).

### Scenario presets (training) 🎯

Scenario presets let training sample hard situations on purpose (e.g. water
scarcity, low stockpiles). Each preset is a config override merged into the
base config before the usual curriculum randomization scales are applied.

- Training picks a scenario each episode using the weights in
  `ai.training.scenarios`.
- If `ai.training.scenarioSampling.mode` is `adaptive`, weights are rebalanced
  during training to focus on the weakest-performing scenarios.
- If `ai.training.evalScenarios` is set, evaluation splits the eval episodes
  across those scenarios for a balanced score.
- The debug log includes a "Scenario mix" section that shows how often each
  preset appeared in the window.

Merchant:

- `merchant.enabled`: enable merchant visits.
- `merchant.spawnRangeTicks.min`: minimum ticks between spawns.
- `merchant.spawnRangeTicks.max`: maximum ticks between spawns.
- `merchant.stayTicks`: ticks the merchant waits near houses.
- `merchant.maxTradesPerVisit`: max trades per visit.
- `merchant.reserveRatio`: minimum stockpile ratio kept when trading away resources.
- `merchant.tradeRate.give`: units given per trade.
- `merchant.tradeRate.receive`: units received per trade.

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
- `population.housing.enabled`: enable housing effects.
- `population.housing.bondingMinMultiplier`: bonding multiplier when housing is scarce.
- `population.housing.bondingMaxMultiplier`: bonding multiplier when housing is sufficient.
- `population.housing.buildTargetRatio`: build houses until beds/pop meets this ratio.
- `population.housing.buildMinResources.<resource>`: minimum stockpile ratio required before building houses.
- `population.housing.winterNeedPenalty`: extra need decay in winter per unsheltered fraction.
- `population.housing.winterOldAgePenalty`: extra old-age chance in winter per unsheltered fraction.
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
- Resources in this phase: `food_raw`, `water`, `wood`, `stone`.

Structures:

- `structures.<type>.count`: number of structures of a given type (e.g. `house`).
- `structures.<type>.capacity`: capacity for the structure (beds for houses).
- `structures.<type>.buildCost.<resource>`: resources consumed to build.
- `structures.<type>.buildTicks`: time in ticks to build.
- `structures.house.levels.<level>.capacity`: house bed capacity by level (1..5).
- `structures.house.levels.<level>.upgradeCost.<resource>`: resources consumed to upgrade to that level.
- `structures.house.levels.<level>.upgradeTicks`: time in ticks to upgrade to that level.
- `structures.house.upgradeMinHousingRatio`: minimum beds/pop ratio before upgrades begin.
- `structures.house.upgradeMinHouses`: minimum number of houses before upgrades begin.
- `structures.house.upgradeMinAdjacency`: minimum adjacent houses required to upgrade.
- `structures.house.storage.enabled`: enable house storage buffer.
- `structures.house.storage.resources`: resources buffered in houses.
- `structures.house.storage.capacityPerLevel.<level>`: storage capacity per house level (per resource).
- `structures.house.storage.surplusRatio`: move stockpile into storage above this ratio.
- `structures.house.storage.releaseRatio`: release storage back below this ratio.
- `structures.house.storage.transferPerTick`: units moved per tick (per resource).
- `structures.house.storage.decayPerTick.<resource>`: decay rate per tick for stored resources.
- `structures.well.nodeCapacity`: capacity for water wells (artificial water nodes).
- `structures.well.maxCount`: limit for how many wells can be built.
- `structures.well.buildWhenNodeRatioBelow`: build well if water node ratio falls below this.
- `structures.well.buildWhenStockpileRatioBelow`: build well if water stockpile ratio falls below this.
- `structures.field.nodeCapacity`: capacity for fields (artificial food nodes).
- `structures.field.maxCount`: limit for how many fields can be built.
- `structures.field.buildWhenNodeRatioBelow`: build field if food node ratio falls below this.
- `structures.field.buildWhenStockpileRatioBelow`: build field if food stockpile ratio falls below this.
- `structures.field.buildMinResources.<resource>`: minimum stockpile ratio required before building fields.
- `structures.field.irrigationMinMultiplier`: minimum field regen multiplier when water is scarce.
- `structures.field.irrigationMaxMultiplier`: maximum field regen multiplier when water is abundant.

Seasons:

- `seasons.enabled`: enable seasonal modifiers.
- `seasons.durationTicks`: ticks per season.
- `seasons.order`: ordered list of season names.
- `seasons.modifiers.<season>.needDecay`: needs decay multiplier.
- `seasons.modifiers.<season>.gatherYield`: gather yield multiplier.
- `seasons.modifiers.<season>.gatherTicks`: gather time multiplier.
- `seasons.modifiers.<season>.nodeRegen`: node regen multiplier.
- `seasons.modifiers.<season>.reproductionChance`: reproduction chance multiplier.
- `seasons.modifiers.<season>.fieldRegen`: extra regen multiplier for fields (food).

Weather:

- `weather.enabled`: enable dynamic weather.
- `weather.default`: starting weather state.
- `weather.durationTicks.min`: minimum ticks per weather state.
- `weather.durationTicks.max`: maximum ticks per weather state.
- `weather.states.<type>.weight`: base weight when picking the next weather.
- `weather.states.<type>.severity`: 0..1 severity signal for AI observations.
- `weather.states.<type>.needDecay`: global need decay multiplier.
- `weather.states.<type>.needDecayByNeed.<need>`: per-need decay multiplier.
- `weather.states.<type>.gatherTicks`: gather time multiplier.
- `weather.states.<type>.gatherYield`: gather yield multiplier.
- `weather.states.<type>.nodeRegen`: node regeneration multiplier.
- `weather.states.<type>.fieldRegen`: field regeneration multiplier.
- `weather.states.<type>.irrigation`: irrigation multiplier.
- `weather.seasonBias.<season>.<type>`: seasonal weight bias for a weather type.

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
- `symbols.wood`: wood node symbol.
- `symbols.stone`: stone node symbol.
- `symbols.house`: house symbol.
- `symbols.well`: well symbol.
- `symbols.field`: field symbol.

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
