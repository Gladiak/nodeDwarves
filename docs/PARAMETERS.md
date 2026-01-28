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
- `display.frame.enabled`: render a frame around the map.
- `display.frame.horizontal`: frame horizontal character.
- `display.frame.vertical`: frame vertical character.
- `display.frame.topLeft`: frame top-left corner character.
- `display.frame.topRight`: frame top-right corner character.
- `display.frame.bottomLeft`: frame bottom-left corner character.
- `display.frame.bottomRight`: frame bottom-right corner character.
- `display.terrain.enabled`: enable randomized terrain background for the map.
- `display.terrain.mode`: terrain generator mode (`valley` or `coast`).
- `display.terrain.seed`: seed for terrain generation (`0` = random each run).
- `display.terrain.scale`: noise scale (lower = larger blobs).
- `display.terrain.octaves`: noise layers for terrain variation.
- `display.terrain.persistence`: amplitude decay per octave (0..1).
- `display.terrain.lacunarity`: frequency multiplier per octave.
- `display.terrain.valley.bowlStrength`: valley bowl intensity (0..1).
- `display.terrain.valley.smoothingPasses`: number of smoothing passes for the heightmap.
- `display.terrain.valley.mountainHeight`: height threshold for mountains (0..1).
- `display.terrain.valley.hillHeight`: height threshold for hills (0..1).
- `display.terrain.valley.fertileHeight`: height threshold for fertile ground (0..1).
- `display.terrain.valley.fertileDistance`: max distance from water for fertile ground (tiles).
- `display.terrain.valley.humidityDecay`: humidity falloff distance (higher = wider humidity).
- `display.terrain.valley.riverBias.<dir>`: river bias per direction (`east`, `south`, `west`, `north`).
- `display.terrain.valley.riverValleyDrop`: height drop on the river path.
- `display.terrain.valley.riverValleyDropAdjacent`: height drop around the river path.
- `display.terrain.valley.lakeDepth`: depth drop for lake depressions.
- `display.terrain.valley.lakeThreshold`: height threshold for lake filling.
- `display.terrain.valley.forest.humidityMin`: minimum humidity to spawn forests.
- `display.terrain.valley.forest.heightMax`: max height for forests.
- `display.terrain.valley.forest.waterDistanceMax`: maximum distance from water to spawn forests (tiles).
- `display.terrain.valley.forest.noiseScale`: forest noise scale.
- `display.terrain.valley.forest.noiseThreshold`: forest noise threshold.
- `display.terrain.valley.forest.clusterPasses`: forest clustering passes.
- `display.terrain.valley.food.humidityMin`: minimum humidity to spawn food patches.
- `display.terrain.valley.food.waterDistanceMax`: maximum distance from water to spawn food patches (tiles).
- `display.terrain.valley.food.noiseScale`: food noise scale.
- `display.terrain.valley.food.noiseThreshold`: food noise threshold.
- `display.terrain.valley.food.clusterPasses`: food clustering passes.
- `display.terrain.valley.stone.heightMin`: minimum height for stone clusters.
- `display.terrain.valley.stone.noiseScale`: stone noise scale.
- `display.terrain.valley.stone.noiseThreshold`: stone noise threshold.
- `display.terrain.valley.stone.clusterPasses`: stone clustering passes.
- `display.terrain.walkable.<type>`: whether a terrain tile is walkable (`river`, `lake`, `mountain`, `hill`, `plain`, `fertile`, `food`, `forest`, `stone`).
- `display.terrain.movementDelay.<type>`: extra movement cooldown ticks when entering a terrain type (defaults to `0`).
- `display.terrain.symbols.river`: map symbol for river tiles.
- `display.terrain.symbols.lake`: map symbol for lake tiles.
- `display.terrain.symbols.mountain`: map symbol for mountain tiles.
- `display.terrain.symbols.hill`: map symbol for hill tiles.
- `display.terrain.symbols.plain`: map symbol for plain tiles.
- `display.terrain.symbols.fertile`: map symbol for fertile tiles.
- `display.terrain.symbols.food`: map symbol for food tiles.
- `display.terrain.symbols.forest`: map symbol for forest tiles.
- `display.terrain.symbols.stone`: map symbol for stone tiles.
- `display.colors.enabled`: enable ANSI colors in the render.
- `display.colors.reset`: ANSI reset sequence (defaults to `\u001b[0m`).
- `display.colors.map.<key>`: ANSI color for an entity key (e.g. `dwarf`, `merchant`, `house`, `food_raw`).
- `display.colors.map.weather_<type>`: ANSI color for HUD weather labels (e.g. `weather_rain`).
- `display.colors.map.terrain_<type>`: ANSI color for terrain tiles (`terrain_river`, `terrain_lake`, `terrain_mountain`, `terrain_hill`, `terrain_plain`, `terrain_fertile`, `terrain_food`, `terrain_forest`, `terrain_stone`).

Events:

- `events.maxEntries`: number of recent events to show in the HUD.

Resources:

- `resources.useTerrainTiles`: gather resources directly from terrain tiles when available.
- `resources.terrainAllowed.<resource>`: allowed terrain tile types for resource placement and terrain gathering.

Raids:

- `raids.enabled`: enable wildlife raids.
- `raids.symbol`: map symbol for beasts (defaults to `\u00f6`).
- `raids.seasonNames`: seasons eligible for raids.
- `raids.durationTicks`: raid duration in ticks.
- `raids.chance.min/max`: per-season trigger probability range (0..1).
- `raids.minPopulation`: minimum population to allow raids.
- `raids.minTick`: minimum tick before raids can trigger.
- `raids.minSeasonsBetween`: minimum seasons between raid starts.
- `raids.defenseAdults`: adults needed for full defense scaling.
- `raids.defenseMax`: max defense reduction (0..1).
- `raids.deathRate.min/max`: fraction of exposed dwarves killed.
- `raids.resourceLoss.min/max`: base loss ratio (scaled by exposed fraction).
- `raids.resourceLoss.weights.<resource>`: per-resource loss weights.
- `raids.beasts.min/max`: min/max beast count for visuals.
- `raids.beasts.perPop`: population per beast (visual scaling).

Population roles:

- `population.roles.enabled`: enable builder/gatherer role preferences.
- `population.roles.builderRatio`: target share of builders among adults (0..1).
- `population.roles.switchCooldownTicks`: ticks before a role can be reassigned.
- `population.roles.emergencyMinRatio`: stockpile ratio threshold to trigger emergency gathering.
- `population.roles.emergencyResources`: resources checked for emergency gathering.
- `population.idleWanderChance`: chance for idle dwarves to move randomly each tick (0..1).
- `population.settlement.enabled`: enable smarter settlement center selection.
- `population.settlement.scanStep`: grid sampling step when evaluating settlement centers.
- `population.settlement.clearRadius`: radius around a candidate center to evaluate open space (tiles).
- `population.settlement.minOpenRatio`: minimum open-space ratio required for a candidate (0..1).
- `population.settlement.resourceDistanceCap`: distance cap for resource proximity scoring (tiles).
- `population.settlement.resourceWeights.<resource>`: weights for proximity to key resources (0..1).
- `population.settlement.blockedTerrain`: terrain types treated as obstacles when scoring settlement centers.
- `population.pathing.stallThreshold`: ticks without progress before pathing detour kicks in.
- `population.pathing.detourTicks`: number of ticks to keep using detour pathing once stalled.
- `population.pathing.bfsRadius`: local BFS radius for detour pathing (tiles).

Structures (walls):

- `structures.wall.count`: initial wall count.
- `structures.wall.maxCount`: maximum wall segments allowed.
- `structures.wall.buildTargetRatio`: build until wall count reaches this ratio of `maxCount`.
- `structures.wall.buildWhenRaidEligible`: require raid-eligible seasons to build.
- `structures.wall.buildMinHousingRatio`: minimum housing ratio before building walls.
- `structures.wall.buildMinResources.<resource>`: minimum stockpile ratios before building.
- `structures.wall.buildInnerBuffer`: extra space between the outermost building and wall ring.
- `structures.wall.buildRadius`: preferred ring radius around the village center (0 = default placement).
- `structures.wall.buildTicks`: ticks to build one wall segment.
- `structures.wall.buildCost.<resource>`: resource costs to build a segment.
- `structures.wall.defensePerWall`: defense gained per wall segment (0..1).
- `structures.wall.defenseMax`: maximum defense contribution from walls (0..1).

Structures (wells, fields):

- `structures.well.buildMinRadius`: minimum Manhattan radius from village center.
- `structures.well.buildOuterBuffer`: extra distance beyond the current village perimeter (houses/walls).
- `structures.well.skipWhenTerrainWaterWithin`: skip well building if terrain water is within this Manhattan distance of the village center.
- `structures.well.criticalStockpileRatio`: allow well building despite nearby terrain water when water stockpile ratio is below this threshold.
- `structures.field.buildMinRadius`: minimum Manhattan radius from village center.
- `structures.field.buildOuterBuffer`: extra distance beyond the current village perimeter (houses/walls).

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
- `ai.reward.raidExposure`: penalty for exposed ratio while a raid is active.
- `ai.reward.raidExposureEligible`: penalty for exposed ratio when the season is raid-eligible.
- `ai.reward.raidDeaths`: extra penalty per raid death (delta).
- `ai.reward.raidLoot`: penalty for normalized raid loot loss (delta vs targets).
- `ai.reward.raidPrepShelter`: bonus for shelter readiness (beds/pop) during raid-eligible seasons.
- `ai.reward.raidPrepDefense`: bonus for defense readiness (adults + walls) during raid-eligible seasons.
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
