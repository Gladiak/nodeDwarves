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

