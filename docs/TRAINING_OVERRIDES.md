# Training Overrides (Performance)

`ai.training.configOverrides` is a single config override merged into the base
config for training episodes. It is applied before scenario overrides and
randomization, and is ignored when training is disabled. Use it to shrink the
simulation footprint (fewer dwarves, nodes, structures) while keeping the
runtime config intact for `npm start`.

`ai.training.evalOverrides` is merged after training overrides during evaluation
runs, so you can re-enable heavier systems (e.g. merchant) or disable early
termination to measure long-horizon quality without changing the fast training
loop.
Evaluation resets also disable randomization (`randomize=false`) for stable,
repeatable eval passes unless you explicitly re-enable it in code.
If you omit display overrides, training uses the base `display` settings.

Display:

- `display.width`: fixed render width used by the training runtime.
- `display.height`: fixed render height used by the training runtime.
- `display.maxWidth`: cap width when `display.autoSize` is enabled (`<= 0` means uncapped).
- `display.maxHeight`: cap height when `display.autoSize` is enabled (`<= 0` means uncapped).
- `display.dwarves.maxVisible`: max dwarves rendered on the map (`0` = show all, `< 0` = hide all).

Merchant:

- `merchant.enabled`: enable merchant visits.
- `merchant.spawnRangeTicks.min`: minimum ticks between spawns.
- `merchant.spawnRangeTicks.max`: maximum ticks between spawns.
- `merchant.stayTicks`: ticks the merchant waits near houses.
- `merchant.maxTradesPerVisit`: max trades per visit.
- `merchant.reserveRatio`: minimum stockpile ratio kept when trading away resources.
- `merchant.tradeRate.default`: fallback exchange rate used when no per-resource override exists.
- `merchant.tradeRate.<resource>`: per-resource exchange rate override for the traded-away resource.
- Legacy compatibility: `merchant.tradeRate.give`/`merchant.tradeRate.receive` are still accepted and mapped to a ratio (`give / receive`), but `default` + per-resource keys are preferred.
- `ai.governors.trade.enabled`: enable trade-governor intent hooks during training/eval.
- `ai.governors.trade.reserveRatioBiasMax`: max absolute reserve-ratio shift from `action.trade.reserveRatioBias`.
- `ai.governors.trade.reserveRatioMin`: reserve-ratio floor after governor bias.
- `ai.governors.trade.reserveRatioMax`: reserve-ratio ceiling after governor bias.
- `ai.governors.trade.contestIntentThreshold`: minimum normalized `contestIntent` to attempt rival-caravan contest costs.
- `ai.governors.trade.opportunityIntentThreshold`: minimum normalized `opportunityIntent` to auto-complete eligible opportunities.
- `ai.governors.trade.opportunityForceCompleteTicks`: force-complete safety window near opportunity expiry.
- `ai.governors.building.enabled`: enable ranked building-class governor hooks during training/eval.
- `ai.governors.building.defaultWeights.housing`: fallback class weight when no `action.building.housingWeight` is provided.
- `ai.governors.building.defaultWeights.economy`: fallback class weight when no `action.building.economyWeight` is provided.
- `ai.governors.building.defaultWeights.defense`: fallback class weight when no `action.building.defenseWeight` is provided.
- `ai.governors.building.defaultWeights.special`: fallback class weight when no `action.building.specialWeight` is provided.
- `ai.governors.building.mineBiasMax`: max absolute class-internal mine ordering bias from `action.building.mineBias`.
- `ai.governors.building.upgradeBiasMax`: max absolute housing ordering bias from `action.building.upgradeBias`.
- Training contract note: when trade/building governors are enabled, `python/train.py` appends governor pseudo action-ids to the policy action head (`gov_trade_*`, `gov_building_*`) in addition to resource actions and optional `festival`.
- Checkpoint compatibility note: if feature names or action-head ids differ from an existing checkpoint, resume is blocked and you must restart with `--fresh`.

Population:

Training presets may tune reproduction (base chance, cooldown, soft cap) to keep
episodes from collapsing into extinction during long runs.

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
- `population.relationships.moraleMin`: morale where bonding bonus starts (0..1).
- `population.relationships.moraleMax`: morale where bonding bonus caps (0..1).
- `population.relationships.moraleBonusMax`: max bonding bonus added at peak morale (0..1).
- `population.relationships.moraleExponent`: curve exponent for morale-based bonding bonus.
- `population.pathing.mode`: pathing strategy (`detour` or `field`).
- `population.pathing.field.radius`: potential-field radius (tiles).
- `population.pathing.field.ttlTicks`: ticks to reuse a cached field.
- `population.pathing.field.temperature`: randomness for weighted step selection.
- `population.pathing.field.terrainWeight`: terrain delay weight.
- `population.pathing.field.crowdWeight`: crowd avoidance weight.
- `population.pathing.field.inertiaWeight`: directional inertia weight.
- `population.pathing.field.stayPenalty`: penalty for staying in place.
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
- `population.reproduction.minStockpileRatio.<resource>`: block conceptions if stockpile ratio is below this.
- `population.death.starvationThreshold`: need threshold to start starvation.
- `population.death.starvationTicks`: ticks before starvation death.
- `population.death.oldAgeChanceMin`: min old-age death chance per tick.
- `population.death.oldAgeChanceMax`: max old-age death chance per tick.

Clans:

- `clans.enabled`: enable clan dynamics during training.
- `clans.distribution.<clan>`: rebalance initial clan mix for curriculum shaping.
- `clans.effects.<clan>.<effect>`: tune clan bonuses/penalties for stability experiments.

Ruins:

- `ruins.enabled`: enable ruins expeditions.
- `ruins.expedition.minIdleAdults`: minimum idle adults required to start an expedition.
- `ruins.expedition.minPopulation`: minimum population required to start an expedition.
- `ruins.expedition.cooldownTicks`: base cooldown between expeditions.
- `ruins.expedition.failureCooldownTicks`: extra cooldown after failed expeditions.
- `ruins.expedition.partySizeMin`: minimum expedition party size.
- `ruins.expedition.partySizeMax`: maximum expedition party size.
- `ruins.expedition.minStockpileRatio.<resource>`: stockpile ratio gate for expeditions.
- `ruins.expedition.failureLossMin`: minimum resource loss on failure.
- `ruins.expedition.failureLossMax`: maximum resource loss on failure.
- `ruins.mithrilReinforcement.minRoom`: room index where mithril can appear.
- `ruins.rooms`: override the room list for shorter or longer progression.
- `ruins.rooms[].expeditionTicks`: ticks required to clear a room.
- `ruins.rooms[].partySize`: party size target for a room.
- `ruins.rooms[].cost.<resource>`: resource costs paid per room.
- `ruins.rooms[].hazardChance`: hazard chance per room (0..1).
- `ruins.rooms[].guardianChance`: guardian spawn chance per room (0..1).
- `ruins.rooms[].guardianPower`: guardian strength scalar.
- `ruins.rooms[].artifactChance`: artifact chance per room (0..1).
- `ruins.rooms[].artifactRolls`: number of artifact rolls per room.

Endgame cycles:

- `endgame.enabled`: enable or disable endgame cycle resets.
- `endgame.resetPopulation`: dwarf count for the new cycle after reset.
- `endgame.minTicksAfterArtifacts`: ticks that must pass after all artifacts are found before triggering a cycle.
- `endgame.transition.enabled`: enable or disable the endgame fade transition.
- `endgame.transition.fadeOutTicks`: ticks for the fade-out from bottom-right to top-left.
- `endgame.transition.holdTicks`: ticks to hold on a black map before fade-in.
- `endgame.transition.fadeInTicks`: ticks for the fade-in from top-left to bottom-right.
- `endgame.transition.randomizeSeed`: randomize the map seed on each cycle.
- `endgame.transition.messages`: array of story messages used during the transition.
- `endgame.difficulty.enabled`: enable difficulty scaling per completed cycle.
- `endgame.difficulty.perCycle`: difficulty multiplier added per completed cycle.
- `endgame.difficulty.maxMultiplier`: cap for the difficulty multiplier.

Prestige:

- `prestige.enabled`: enable prestige scoring/rank tracking.
- `prestige.cycleResetBonus`: prestige granted on each completed endgame reset.
- `prestige.tiers[]`: rank thresholds used for HUD prestige labels.
- `prestige.tiers[].name`: rank label.
- `prestige.tiers[].min`: minimum prestige required for the rank.

Resources and economy:

- `resources.stockpile.<resource>`: initial stockpile per resource.
- `resources.targets.<resource>`: desired stockpile per resource.
- `resources.targetsPerCapita.<resource>`: per-dwarf target add-on for stockpile ratios.
- `resources.defaultNodeCapacity`: fallback capacity for resource nodes.
- `resources.nodeCapacity.<resource>`: per-resource node capacity overrides.
- `resources.removeDepletedNodes`: remove nodes when empty (if regen off).
- `resources.nodeRegen.enabled`: enable node regeneration.
- `resources.nodeRegen.intervalTicks`: ticks between regen pulses.
- `resources.nodeRegen.amount`: amount regenerated per pulse.
- `resources.nodeRegen.onlyDepleted`: only regenerate fully depleted nodes.
- `resources.nodes.<resource>`: number of nodes placed on the map.
- `resources.decayPerTick.<resource>`: per-tick stockpile decay rate (fraction).
- `resources.terrainCooldownTicks`: cooldown ticks applied to terrain tiles after gathering.
- `resources.terrainCooldownCriticalRatio`: stockpile ratio threshold to ignore terrain cooldowns.
- Resources in this phase: `food`, `water`, `wood`, `stone`.

Structures:

- `structures.<type>.count`: number of structures of a given type (e.g. `house`).
- `structures.<type>.capacity`: capacity for the structure (beds for houses).
- `structures.<type>.buildCost.<resource>`: resources consumed to build.
- `structures.<type>.buildTicks`: time in ticks to build.
- `structures.mine.preferExtraAlways`: prefer extra mine builds regardless of village count.
- `structures.house.levels.<level>.capacity`: house bed capacity by level (1..5).
- `structures.house.levels.<level>.upgradeCost.<resource>`: resources consumed to upgrade to that level.
- `structures.house.levels.<level>.upgradeTicks`: time in ticks to upgrade to that level.
- `structures.house.upgradeMinHousingRatio`: minimum beds/pop ratio before upgrades are attempted when not forced.
- `structures.house.upgradeMinHouses`: minimum number of houses before upgrades are preferred when housing is short.
- `structures.house.upgradeMinAdjacency`: minimum adjacent houses required for an upgrade candidate.
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
- `structures.armory.workersPerArmory`: workers assigned per armory.
- `structures.armory.kitTicks`: ticks required per kit.
- `structures.armory.kitOutput`: kits crafted per job completion.
- `structures.armory.kitMax`: cap for stored kits.
- `structures.armory.kitCost.<resource>`: resource cost per kit.
- `structures.armory.pauseOnEmergency`: pause armory jobs during emergencies.
- `structures.brewery.workersPerBrewery`: workers assigned per brewery.
- `structures.brewery.outputPerTick.<resource>`: per-worker output applied each tick while brewing.
- `structures.brewery.foodCostPerTick`: base food consumed per tick while brewing.
- `structures.brewery.levelMax`: maximum brewery level.
- `structures.brewery.levelBonusMin`: bonus at level 1 (fraction).
- `structures.brewery.levelBonusMax`: bonus at max level (fraction).
- `structures.brewery.levelBonusExponent`: curve exponent for level bonuses.
- `structures.brewery.foodCostReductionMin`: food cost reduction at level 1 (fraction).
- `structures.brewery.foodCostReductionMax`: food cost reduction at max level (fraction).
- `structures.brewery.foodCostReductionExponent`: curve exponent for cost reductions.
- `structures.brewery.upgradeTicks`: ticks required per level upgrade.
- `structures.brewery.upgradeCostScale`: exponential multiplier per level.
- `structures.brewery.upgradeBaseCost.<resource>`: base upgrade costs.
- `structures.brewery.brewmasterInitial`: number of initial dwarves locked as brewmasters.
- `structures.brewery.brewmasterMin`: minimum brewmaster count maintained over time.
- `structures.brewery.brewmasterPerCapita`: per-dwarf brewmaster target scaling with population.
- `structures.brewery.pauseWhenFoodRatioBelow`: pause brewery jobs when food stockpile ratio falls below this.
- `structures.temple_of_ancestors.enabled`: enable temple stage progression.
- `structures.temple_of_ancestors.startStage`: initial completed stage at episode start.
- `structures.temple_of_ancestors.buildMinPopulation`: minimum population gate for temple stages.
- `structures.temple_of_ancestors.buildMinCycles`: minimum completed cycles gate for temple stages.
- `structures.temple_of_ancestors.buildMinIdleAdults`: minimum idle adults gate for temple stages.
- `structures.temple_of_ancestors.buildMinResources.<resource>`: stockpile ratio gates for temple stage jobs.
- `structures.temple_of_ancestors.minArtifactCompletionRatio`: ruins artifact progress gate for temple stages.
- `structures.temple_of_ancestors.outputApplyTo`: resource ids affected by temple output bonuses.
- `structures.temple_of_ancestors.finalCompletionPrestige`: one-time prestige award on final stage completion.
- `structures.temple_of_ancestors.stages`: override stage list for shorter/longer temple progression.
- `structures.temple_of_ancestors.stages[].radius`: per-stage map footprint radius.
- `structures.temple_of_ancestors.stages[].buildTicks`: per-stage build duration.
- `structures.temple_of_ancestors.stages[].buildCost.<resource>`: per-stage build costs.
- `structures.temple_of_ancestors.stages[].prestige`: prestige gain on stage completion.
- `structures.temple_of_ancestors.stages[].prestigePerTick`: passive prestige gain per tick while the stage is active.
- `structures.temple_of_ancestors.stages[].effects.outputBonus`: output multiplier add-on for the stage.
- `structures.temple_of_ancestors.stages[].effects.needDecayReduction`: need-decay reduction for the stage.
- `structures.temple_of_ancestors.stages[].effects.raidDefenseBonus`: raid-defense bonus for the stage.

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

Festivals:

- `festivals.enabled`: enable seasonal festivals.
- `festivals.label`: festival label used in HUD/events.
- `festivals.seasonNames`: seasons eligible for festivals.
- `festivals.seasonWindowTicks`: ticks from season start when a festival may begin.
- `festivals.durationTicks`: festival duration in ticks.
- `festivals.cooldownSeasons`: minimum seasons between festivals (0 = once per season).
- `festivals.minPopulation`: minimum population required to start a festival.
- `festivals.blockDuringRaid`: disallow festivals while raids are active.
- `festivals.minStockpileRatios.<resource>`: stockpile ratio thresholds for eligibility.
- `festivals.costs.<resource>`: stockpile costs paid when the festival starts.
- `festivals.minCostRatio`: required multiple of each cost (1.3 = 130% of cost).
- `festivals.effects.needDecay`: need decay multiplier while active.
- `festivals.effects.gatherYield`: gather yield multiplier while active.
- `festivals.ai.enabled`: allow AI to trigger festivals.
- `festivals.ai.intentThreshold`: normalized threshold (0..1) for the AI festival intent.

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
- `consumption.beerRelief`: thirst relief per beer unit.
- `consumption.beerReserveBase`: base beer reserve target used for rationing.
- `consumption.beerReservePerCapita`: per-dwarf beer reserve target add-on for rationing.
- `consumption.beerMinReserveRatio`: minimum reserve ratio required before dwarves prefer beer.
- `consumption.beerMoraleGain`: morale boost gained per beer consumed.
- `consumption.beerMoraleDecayPerTick`: per-tick decay applied to the beer morale boost.
- `consumption.beerMoraleMax`: maximum beer morale boost.
- `consumption.beerProductionBonusMax`: max production bonus from beer morale.
- `consumption.beerProductionBonusExponent`: curve exponent for beer production bonus.
- `consumption.beerProductionApplyTo`: resource ids receiving the beer production bonus.

Jobs and gathering:

- `jobs.defaultGatherTicks`: default gather time in ticks.
- `jobs.defaultGatherYield`: default gather yield.
- `jobs.gatherTicks.<resource>`: per-resource gather time override.
- `jobs.gatherYield.<resource>`: per-resource gather yield override.

Symbols:

- `symbols.empty`: empty cell symbol.
- `symbols.dwarf`: dwarf symbol.
- `symbols.food`: raw food node symbol.
- `symbols.water`: water node symbol.
- `symbols.wood`: wood node symbol.
- `symbols.stone`: stone node symbol.
- `symbols.house`: house symbol.
- `symbols.well`: well symbol.
- `symbols.field`: field symbol.
- `symbols.temple_of_ancestors`: temple center symbol.
- `symbols.temple_of_ancestors_outline`: temple footprint symbol.
