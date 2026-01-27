# Parameter Reference


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
- `ai.termination.enabled`: enable early termination when the sim is stable.
- `ai.termination.minTicks`: minimum ticks before early termination can trigger.
- `ai.termination.stableTicks`: consecutive stable ticks required to terminate.
- `ai.termination.minStockpileAvg`: minimum average stockpile ratio for stability.
- `ai.termination.minStockpileMin`: minimum minimum stockpile ratio for stability.
- `ai.termination.maxCriticalNeeds`: maximum critical needs fraction for stability.
- `ai.termination.maxIdleAdults`: maximum idle adults fraction for stability.
- `ai.termination.minPopulationBalance`: minimum population balance ratio for stability.
- `ai.termination.stockpileEps`: max change in average stockpile ratio to count as stable.
- `ai.termination.resourceEps`: max per-resource ratio change to count as stable (defaults to `stockpileEps`).
- `ai.termination.resources`: resource list for per-resource stability (empty = all resources).
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
- `ai.training.configOverrides`: config overrides applied for training before scenario overrides and randomization.
- `ai.training.evalOverrides`: config overrides applied during evaluation runs (after training overrides).
- `ai.training.scenarios`: weighted scenario presets applied before randomization.
- `ai.training.scenarios[].name`: unique scenario name used by the trainer.
- `ai.training.scenarios[].weight`: sampling weight (0 disables sampling).
- `ai.training.scenarios[].difficultyMin`: difficulty where a ramped scenario starts contributing.
- `ai.training.scenarios[].difficultyMax`: difficulty where the ramp reaches full weight.
- `ai.training.scenarios[].difficultyMinMultiplier`: weight multiplier at `difficultyMin`.
- `ai.training.scenarios[].difficultyMaxMultiplier`: weight multiplier at `difficultyMax`.
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
- `ai.training.trainer.evalMaxSteps`: max steps per eval episode (0 = use maxSteps).
- `ai.training.trainer.evalDifficulty`: fixed difficulty for eval (0..1, omit to use current ramp).
- `ai.training.trainer.evalScore`: metric used for best-eval selection (`reward`, `rps`, or `rpt`).
- `ai.training.trainer.sampleScore`: metric used for adaptive scenario weighting (`reward`, `rps`, or `rpt`).
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

