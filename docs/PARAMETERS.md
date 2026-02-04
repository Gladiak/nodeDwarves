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
- `display.inspect_panel.enabled`: enable the dwarf inspect panel overlay (toggle with `i`).
- `display.inspect_panel.width`: inspect panel width in characters.
- `display.inspect_panel.height`: inspect panel height in lines.
- `display.legend_panel.enabled`: enable the legend overlay panel (toggle with `l`).
- `display.legend_panel.width`: legend panel width in characters.
- `display.legend_panel.height`: legend panel height in lines.
- `display.save_panel.enabled`: enable the map-export confirmation panel.
- `display.save_panel.width`: save panel width in characters.
- `display.save_panel.height`: save panel height in lines.
- `display.save_panel.autoCloseMs`: auto-close delay for the save panel in milliseconds.
- `display.terrain.enabled`: enable randomized valley terrain background for the map.
- `display.terrain.seed`: seed for terrain generation (`0` = random each run).
- `display.terrain.scale`: noise scale (lower = larger blobs).
- `display.terrain.octaves`: noise layers for terrain variation.
- `display.terrain.persistence`: amplitude decay per octave (0..1).
- `display.terrain.lacunarity`: frequency multiplier per octave.
- `display.terrain.valley.bowlStrength`: valley bowl intensity (0..1).
- `display.terrain.valley.smoothingPasses`: number of smoothing passes for the heightmap.
- `display.terrain.valley.domain_warp.enabled`: enable domain warp for more organic terrain.
- `display.terrain.valley.domain_warp.strength`: warp strength in tiles.
- `display.terrain.valley.domain_warp.scale`: noise scale for the warp field.
- `display.terrain.valley.mountainHeight`: height threshold for mountains (0..1).
- `display.terrain.valley.hillHeight`: height threshold for hills (0..1).
- `display.terrain.valley.fertileHeight`: height threshold for fertile ground (0..1).
- `display.terrain.valley.fertileDistance`: max distance from water for fertile ground (tiles).
- `display.terrain.valley.humidityDecay`: humidity falloff distance (higher = wider humidity).
- `display.terrain.valley.waterDistanceDiagonalWeight`: diagonal step cost for water distance (0 = Manhattan, >1 rounder).
- `display.terrain.valley.water_distance_jitter`: noise jitter applied to water distance (tiles).
- `display.terrain.valley.water_distance_noise_scale`: noise scale for water distance jitter.
- `display.terrain.valley.riverBias.<dir>`: river bias per direction (`east`, `south`, `west`, `north`).
- `display.terrain.valley.riverCount`: number of valley rivers to carve (1..4).
- `display.terrain.valley.riverSourceMinDistance`: minimum Manhattan distance between river sources.
- `display.terrain.valley.riverSourceSides`: allowed river source sides (`north`, `south`, `east`, `west`).
- `display.terrain.valley.riverWander`: chance per step to deviate from the steepest descent (0..1).
- `display.terrain.valley.riverValleyDrop`: height drop on the river path.
- `display.terrain.valley.riverValleyDropAdjacent`: height drop around the river path.
- `display.terrain.valley.lakeDepth`: depth drop for lake depressions.
- `display.terrain.valley.lakeThreshold`: height threshold for lake filling.
- `display.terrain.valley.lakePatch.radiusMin`: minimum fallback lake radius when none exist (tiles).
- `display.terrain.valley.lakePatch.radiusMax`: maximum fallback lake radius when none exist (tiles).
- `display.terrain.valley.lakePatch.edge_jaggedness`: jaggedness applied to fallback lake edges (0..1).
- `display.terrain.valley.lakePatch.edge_noise_scale`: noise scale for fallback lake edge jaggedness.
- `display.terrain.valley.lakePatch.edge_aspect`: edge stretch for more elongated fallback lakes (0..1).
- `display.terrain.valley.ponds.enabled`: enable extra valley ponds.
- `display.terrain.valley.ponds.count`: number of ponds to place.
- `display.terrain.valley.ponds.radiusMin`: minimum pond radius (tiles).
- `display.terrain.valley.ponds.radiusMax`: maximum pond radius (tiles).
- `display.terrain.valley.ponds.buffer`: minimum distance from existing water (tiles).
- `display.terrain.valley.ponds.heightMax`: maximum height for pond centers (0..1).
- `display.terrain.valley.ponds.edge_jaggedness`: jaggedness applied to pond edges (0..1).
- `display.terrain.valley.ponds.edge_noise_scale`: noise scale for pond edge jaggedness.
- `display.terrain.valley.ponds.edge_aspect`: edge stretch for more elongated ponds (0..1).
- `display.terrain.valley.forest.humidityMin`: minimum humidity to spawn forests.
- `display.terrain.valley.forest.heightMax`: max height for forests.
- `display.terrain.valley.forest.waterDistanceMin`: minimum distance from water to allow forests (tiles).
- `display.terrain.valley.forest.waterDistanceMax`: maximum distance from water to spawn forests (tiles).
- `display.terrain.valley.forest.waterDistanceJitter`: noise jitter applied to water distance (tiles).
- `display.terrain.valley.forest.waterDistanceNoiseScale`: noise scale for water distance jitter.
- `display.terrain.valley.forest.edge_distance`: distance from lakes where edge jitter applies (tiles).
- `display.terrain.valley.forest.edge_jitter`: strength of forest edge jitter near water (0..1).
- `display.terrain.valley.forest.edge_noise_scale`: noise scale for forest edge jitter.
- `display.terrain.valley.forest.noiseScale`: forest noise scale.
- `display.terrain.valley.forest.noiseThreshold`: forest noise threshold.
- `display.terrain.valley.forest.clusterPasses`: forest clustering passes.
- `display.terrain.valley.pasture.humidityMin`: minimum humidity to spawn pasture tiles.
- `display.terrain.valley.pasture.waterDistanceMax`: maximum distance from water to spawn pasture tiles (tiles).
- `display.terrain.valley.pasture.noiseScale`: pasture noise scale.
- `display.terrain.valley.pasture.noiseThreshold`: pasture noise threshold.
- `display.terrain.valley.pasture.clusterPasses`: pasture clustering passes.
- `display.terrain.valley.pasture.patches.count`: number of pasture clusters to seed (0 = disabled).
- `display.terrain.valley.pasture.patches.radiusMin`: minimum radius for a pasture cluster.
- `display.terrain.valley.pasture.patches.radiusMax`: maximum radius for a pasture cluster.
- `display.terrain.valley.pasture.patches.fill`: fill ratio within a pasture cluster (0..1).
- `display.terrain.valley.food.humidityMin`: minimum humidity to spawn food patches.
- `display.terrain.valley.food.waterDistanceMax`: maximum distance from water to spawn food patches (tiles).
- `display.terrain.valley.food.minTiles`: minimum number of food tiles to guarantee (near water).
- `display.terrain.valley.food.minTilesWaterDistanceMax`: max distance from water used for the minimum food tiles (tiles).
- `display.terrain.valley.food.noiseScale`: food noise scale.
- `display.terrain.valley.food.noiseThreshold`: food noise threshold.
- `display.terrain.valley.food.clusterPasses`: food clustering passes.
- `display.terrain.valley.stone.heightMin`: minimum height for stone clusters.
- `display.terrain.valley.stone.noiseScale`: stone noise scale.
- `display.terrain.valley.stone.noiseThreshold`: stone noise threshold.
- `display.terrain.valley.stone.clusterPasses`: stone clustering passes.
- `display.terrain.minimumTiles.<type>`: minimum number of terrain tiles to guarantee (`food`, `pasture`, `mountain`, `stone`).
- `display.terrain.walkable.<type>`: whether a terrain tile is walkable (`river`, `lake`, `mountain`, `hill`, `plain`, `fertile`, `food`, `pasture`, `forest`, `stone`).
- `display.terrain.movementDelay.<type>`: extra movement cooldown ticks when entering a terrain type (defaults to `0`).
- `display.terrain.symbols.river`: map symbol for river tiles.
- `display.terrain.symbols.lake`: map symbol for lake tiles.
- `display.terrain.symbols.mountain`: map symbol for mountain tiles.
- `display.terrain.symbols.hill`: map symbol for hill tiles.
- `display.terrain.symbols.plain`: map symbol for plain tiles.
- `display.terrain.symbols.fertile`: map symbol for fertile tiles.
- `display.terrain.symbols.food`: map symbol for food tiles.
- `display.terrain.symbols.pasture`: map symbol for pasture tiles.
- `display.terrain.symbols.forest`: map symbol for forest tiles.
- `display.terrain.symbols.stone`: map symbol for stone tiles.
- `display.terrain.plainSymbols.primary`: primary symbol for plain/grass tiles when randomized.
- `display.terrain.plainSymbols.secondary`: secondary symbol for plain/grass tiles when randomized.
- `display.terrain.plainSymbols.tertiary`: tertiary symbol for plain/grass tiles when randomized.
- `display.terrain.plainSymbols.primaryWeight`: chance of choosing the primary symbol (0..1).
- `display.terrain.plainSymbols.secondaryWeight`: chance of choosing the secondary symbol (0..1).
- `display.terrain.mountainSymbols.medium`: medium mountain symbol.
- `display.terrain.mountainSymbols.high`: high mountain symbol for interior tiles.
- `display.terrain.mountainSymbols.mediumNearHill`: force medium mountains next to hills.
- `display.terrain.mountainSymbols.highMinNeighbors`: minimum adjacent mountain tiles (8-neighbor) required for the high symbol.
- `display.terrain.mountainSymbols.highNoiseScale`: noise scale for high mountain patches (higher = smaller patches).
- `display.terrain.mountainSymbols.highNoiseThreshold`: noise threshold to allow high mountain patches (0..1).
- `display.terrain.mountainSymbols.highNoiseSeedOffset`: seed offset for high mountain patch noise.
- `display.terrain.hillSymbols.primary`: primary symbol for hill tiles.
- `display.terrain.hillSymbols.pronounced`: pronounced hill symbol for interior hill tiles.
- `display.terrain.hillSymbols.pronouncedNearMountain`: force pronounced hills next to mountains.
- `display.terrain.hillSymbols.pronouncedMinNeighbors`: minimum adjacent hill tiles (8-neighbor) required for the pronounced symbol.
- `display.terrain.hillSymbols.pronouncedNoiseScale`: noise scale for pronounced hill patches (higher = smaller patches).
- `display.terrain.hillSymbols.pronouncedNoiseThreshold`: noise threshold to allow pronounced hill patches (0..1).
- `display.terrain.hillSymbols.pronouncedNoiseSeedOffset`: seed offset for pronounced hill patch noise.
- `display.terrain.forestSymbols.primary`: primary symbol for forest tiles.
- `display.terrain.forestSymbols.dense`: dense forest symbol for interior forest tiles.
- `display.terrain.forestSymbols.denseMinNeighbors`: minimum adjacent forest tiles (8-neighbor) required for the dense symbol.
- `display.terrain.forestSymbols.denseNoiseScale`: noise scale for dense forest patches (higher = smaller patches).
- `display.terrain.forestSymbols.denseNoiseThreshold`: noise threshold to allow dense forest patches (0..1).
- `display.terrain.forestSymbols.denseNoiseSeedOffset`: seed offset for dense forest patch noise.
- `display.terrain.riverSymbols.horizontal`: symbol for horizontal river segments.
- `display.terrain.riverSymbols.vertical`: symbol for vertical river segments.
- `display.terrain.riverSymbols.cornerNE`: symbol for river corner connecting north + east.
- `display.terrain.riverSymbols.cornerNW`: symbol for river corner connecting north + west.
- `display.terrain.riverSymbols.cornerSE`: symbol for river corner connecting south + east.
- `display.terrain.riverSymbols.cornerSW`: symbol for river corner connecting south + west.
- `display.terrain.riverSymbols.teeNorth`: symbol for river tee connecting north + east + west.
- `display.terrain.riverSymbols.teeSouth`: symbol for river tee connecting south + east + west.
- `display.terrain.riverSymbols.teeEast`: symbol for river tee connecting east + north + south.
- `display.terrain.riverSymbols.teeWest`: symbol for river tee connecting west + north + south.
- `display.terrain.riverSymbols.cross`: symbol for river crossings connecting all four directions.
- `display.terrain.riverConnectsTo`: list of terrain types treated as connected to rivers (defaults to `["river"]`).
- `display.dwarves.maxVisible`: max dwarves to render on the map (0 = show all).
- `display.colors.enabled`: enable ANSI colors in the render.
- `display.colors.reset`: ANSI reset sequence (defaults to `\u001b[0m`).
- `display.colors.map.<key>`: ANSI color for an entity key (e.g. `dwarf`, `merchant`, `house`, `food`, `hud_header`).
- `display.colors.map.weather_<type>`: ANSI color for HUD weather labels (e.g. `weather_rain`).
- `display.colors.map.terrain_<type>`: ANSI color for terrain tiles (`terrain_river`, `terrain_lake`, `terrain_mountain`, `terrain_hill`, `terrain_plain`, `terrain_fertile`, `terrain_food`, `terrain_forest`, `terrain_stone`).
- `display.colors.map.herd`: ANSI color for wildlife herds on the map.
- `display.colors.map.terrain_mountain_medium`: ANSI color for medium mountain tiles.
- `display.colors.map.terrain_mountain_high`: ANSI color for high mountain tiles.
- `display.colors.map.terrain_hill_pronounced`: ANSI color for pronounced hill tiles (used with the pronounced hill symbol).
- `display.colors.map.terrain_forest_dense`: ANSI color for dense forest tiles (used with the dense forest symbol).
- `display.colors.map.terrain_forest_dense_<season>`: seasonal overrides for dense forests (`spring`, `summer`, `autumn`, `winter`).
- `display.colors.map.terrain_pasture`: ANSI color for pasture tiles.
- `display.colors.map.terrain_pasture_depleted`: ANSI color for depleted pasture tiles.
- `display.colors.seasonal.enabled`: enable seasonal terrain color transitions.
- `display.colors.seasonal.types`: terrain types that should use seasonal palettes (e.g. `plain`, `fertile`, `forest`, `food`, `grass`).
- `display.colors.seasonal.palettes.<season>.<type>`: color map key for a terrain type in a season (uses `display.colors.map` keys).
- `display.colors.seasonal.palettes.<season>.cherry`: optional color map key for cherry blossom tiles in a season.
- `display.colors.seasonal.patchy.enabled`: enable patchy noise transitions instead of per-tile randomness.
- `display.colors.seasonal.patchy.scale`: noise scale for patch size (lower = larger patches).
- `display.colors.seasonal.patchy.octaves`: noise octaves used for patch detail.
- `display.colors.seasonal.patchy.persistence`: amplitude falloff per octave (0..1).
- `display.colors.seasonal.patchy.lacunarity`: frequency multiplier per octave.
- `display.colors.seasonal.patchy.seedOffset`: seed offset for seasonal patch patterns.
- `display.colors.seasonal.cherry.enabled`: enable cherry blossom selection for eligible terrain.
- `display.colors.seasonal.cherry.season`: season name that uses the cherry palette.
- `display.colors.seasonal.cherry.terrain`: terrain type eligible for cherry blossoms (defaults to `forest`).
- `display.colors.seasonal.cherry.ratio`: fraction of eligible tiles that become cherry (0..1).
- `display.colors.seasonal.cherry.noiseScale`: noise scale for cherry clustering.
- `display.colors.seasonal.cherry.seedOffset`: seed offset for cherry clustering.

Events:

- `events.maxEntries`: number of recent events to show in the HUD.

Wildlife and pastures:

- `wildlife.enabled`: enable seasonal wildlife herds and hunting.
- `wildlife.seasons`: seasons that can spawn herds (defaults to spring/autumn if empty).
- `wildlife.spawn.herds_min`: minimum herds per eligible season start.
- `wildlife.spawn.herds_max`: maximum herds per eligible season start.
- `wildlife.herd.size_min`: minimum food stock in a herd.
- `wildlife.herd.size_max`: maximum food stock in a herd.
- `wildlife.herd.ttl_ticks`: ticks before a herd despawns if not exhausted.
- `wildlife.herd.move_every_ticks`: movement interval for herds.
- `wildlife.herd.render_min`: minimum number of symbols rendered per herd.
- `wildlife.herd.render_max`: maximum number of symbols rendered per herd.
- `wildlife.hunt.enabled`: enable hunt jobs.
- `wildlife.hunt.max_concurrent`: max concurrent hunt jobs (0 = unlimited).
- `wildlife.hunt.min_food_ratio`: minimum food stockpile ratio required before hunting stops.
- `wildlife.hunt.work_ticks`: ticks required to complete a hunt.
- `wildlife.hunt.yield_min`: minimum food yield per hunt.
- `wildlife.hunt.yield_max`: maximum food yield per hunt.
- `wildlife.hunt.risk.death_chance`: chance of death on a hunt.
- `wildlife.hunt.risk.penalty_chance`: chance of a non-lethal penalty on a hunt.
- `wildlife.hunt.risk.penalty.yield_multiplier`: multiplier applied to hunt yield on penalty.
- `wildlife.hunt.risk.penalty.move_cooldown`: extra move cooldown ticks applied on penalty.
- `pasture.enabled`: enable pasture stock tracking.
- `pasture.capacity_per_tile`: max food stock per pasture tile.
- `pasture.birth.interval_ticks`: ticks between pasture stock regrowth.
- `pasture.birth.amount`: stock amount restored per birth tick.

Merchant:

- `merchant.enabled`: enable the roaming merchant.
- `merchant.spawnRangeTicks.min`: minimum ticks between merchant visits.
- `merchant.spawnRangeTicks.max`: maximum ticks between merchant visits.
- `merchant.stayTicks`: ticks the merchant remains for trading.
- `merchant.maxTradesPerVisit`: max trades per merchant visit.
- `merchant.reserveRatio`: minimum stockpile ratio to consider a resource tradable.
- `merchant.tradeRate.default`: fallback trade rate used for exchange calculations.
- `merchant.tradeRate.<resource>`: per-resource trade rate override.
- `merchant.neverGive`: resource ids the colony will never give to the merchant (can still receive them).

Endgame cycles:

- `endgame.enabled`: enable endgame cycle resets.
- `endgame.resetPopulation`: dwarf count for the new cycle after a reset.
- `endgame.minTicksAfterArtifacts`: ticks that must pass after all artifacts are found before triggering a cycle.
- `endgame.difficulty.enabled`: enable difficulty scaling per completed cycle.
- `endgame.difficulty.perCycle`: difficulty multiplier added per completed cycle.
- `endgame.difficulty.maxMultiplier`: cap for the difficulty multiplier.

Resources:

- `resources.stockpile.<resource>`: initial stockpile amounts (e.g. `food`, `water`, `beer`, `wood`, `stone`, `iron`, `expedition_kit`, `mithril`, `adamantio`, `mana_crystal`).
- `resources.targets.<resource>`: target stockpile amounts used for shortages and stockpile ratios.
- `resources.targetsPerCapita.<resource>`: per-dwarf target add-on (added to `resources.targets`) for scaling shortages and ratios.
- `resources.mapScale.enabled`: enable scaling of initial resources based on map area.
- `resources.mapScale.baselineWidth`: baseline map (grid) width used for map scaling.
- `resources.mapScale.baselineHeight`: baseline map (grid) height used for map scaling.
- `resources.mapScale.minMultiplier`: minimum clamp for the map scale multiplier.
- `resources.mapScale.maxMultiplier`: maximum clamp for the map scale multiplier.
- `resources.mapScale.applyTo.stockpile`: scale initial stockpile amounts by the map multiplier.
- `resources.mapScale.applyTo.targets`: scale stockpile targets by the map multiplier.
- `resources.mapScale.applyTo.nodes`: scale resource node counts by the map multiplier.
- `resources.mapScale.applyTo.nodeCapacity`: scale node capacities by the map multiplier.
- `resources.labels.<resource>`: HUD label overrides for stockpile resources (falls back to the resource id).
- `resources.useTerrainTiles`: gather resources directly from terrain tiles when available.
- `resources.terrainAllowed.<resource>`: allowed terrain tile types for resource placement and terrain gathering.
- `resources.terrainCooldownTicks`: base cooldown ticks applied to terrain tiles after gathering (number or object).
- `resources.terrainCooldownTicks.default`: default cooldown ticks for terrain gathering.
- `resources.terrainCooldownTicks.<resource>`: per-resource cooldown override for terrain gathering.
- `resources.terrainCooldownCriticalRatio`: stockpile ratio threshold to ignore terrain cooldowns (number or object).
- `resources.terrainCooldownCriticalRatio.default`: default ratio threshold to ignore terrain cooldowns.
- `resources.terrainCooldownCriticalRatio.<resource>`: per-resource ratio threshold to ignore terrain cooldowns.
- `resources.decayPerTick.<resource>`: per-tick fractional decay applied to stockpile resources.
- `resources.defaultNodeCapacity`: fallback node capacity for generated resource nodes.
- `resources.nodeCapacity.<resource>`: per-resource node capacity overrides.
- `resources.removeDepletedNodes`: remove nodes entirely once they hit zero.
- `resources.nodeRegen.enabled`: enable node regeneration.
- `resources.nodeRegen.intervalTicks`: ticks between node regen pulses.
- `resources.nodeRegen.amount`: regen amount per pulse.
- `resources.nodeRegen.perTick`: regen amount applied every tick (optional).
- `resources.nodeRegen.onlyDepleted`: only regenerate nodes that are fully depleted.
- `resources.nodes.<resource>`: initial count of resource nodes to spawn.

Needs and consumption:

- `consumption.beerRelief`: thirst relief per beer consumed.
- `consumption.beerReserveBase`: base beer reserve target used for rationing.
- `consumption.beerReservePerCapita`: per-dwarf beer reserve target add-on for rationing.
- `consumption.beerMinReserveRatio`: minimum reserve ratio required before dwarves prefer beer.
- `consumption.beerMoraleGain`: morale boost gained per beer consumed.
- `consumption.beerMoraleDecayPerTick`: per-tick decay applied to the beer morale boost.
- `consumption.beerMoraleMax`: maximum beer morale boost (0..1).
- `consumption.beerProductionBonusMax`: max production bonus from beer morale (0..1+).
- `consumption.beerProductionBonusExponent`: curve exponent for beer production bonus.
- `consumption.beerProductionApplyTo`: resource ids receiving the beer production bonus.

Morale:

- `morale.gatherTicks.enabled`: enable morale-based gather tick adjustments.
- `morale.gatherTicks.moraleMin`: morale where the gather tick bonus starts (0..1).
- `morale.gatherTicks.moraleMax`: morale where the gather tick bonus reaches max (0..1).
- `morale.gatherTicks.bonusMax`: maximum gather tick reduction ratio (0..1).
- `morale.gatherTicks.exponent`: curve exponent for morale scaling.
- `morale.gatherTicks.resources`: resource ids affected by morale-based gather ticks.

Jobs:

- `jobs.buildQueue.maxConcurrent`: maximum concurrent build/house-upgrade jobs.
- `jobs.buildQueue.maxPerTick`: maximum new build/house-upgrade jobs spawned per tick.
- `jobs.gatherTriggerRatio`: multiplier applied to stockpile targets when computing shortages (number or object).
- `jobs.gatherTriggerRatio.default`: fallback multiplier for all resources.
- `jobs.gatherTriggerRatio.<resource>`: per-resource multiplier (values >1 start gathering earlier).

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

Festivals:

- `festivals.enabled`: enable seasonal festivals.
- `festivals.label`: festival label used in HUD/events.
- `festivals.seasonNames`: seasons eligible for festivals (empty = any).
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

Myths:

- `myths.enabled`: enable global myth modifiers.
- `myths.maxActive`: maximum active myths at once (0 = no cap).
- `myths.maxTraditions`: max retained traditions between endgame cycles (0 = no cap).
- `myths.minGapTicks`: minimum ticks between activations of the same myth.
- `myths.historyLimit`: maximum myth history entries to retain (0 = unlimited).
- `myths.traditionsEnabled`: enable tradition carry-over between endgame cycles.
- `myths.definitions.<id>.label`: HUD label for the myth.
- `myths.definitions.<id>.durationTicks`: myth duration in ticks (0 = indefinite).
- `myths.definitions.<id>.effects.<key>`: multiplier applied while the myth is active (1 = neutral).
- `myths.definitions.<id>.traditionEffects.<key>`: multiplier applied by the tradition (1 = neutral).
- `myths.definitions.<id>.trigger.type`: trigger type (`resource_crisis`, `raid_deaths`, `ruins_success`, `drought_or_water_crisis`).
- `myths.definitions.<id>.trigger.resources`: resource ids used for `resource_crisis` ratios.
- `myths.definitions.<id>.trigger.ratioThreshold`: stockpile ratio threshold for `resource_crisis`.
- `myths.definitions.<id>.trigger.ticksRequired`: ticks below threshold to trigger.
- `myths.definitions.<id>.trigger.seasonWindow`: seasons window for repeated crises/droughts.
- `myths.definitions.<id>.trigger.seasonCount`: seasons with crisis required (resource crisis).
- `myths.definitions.<id>.trigger.deathsPerRaidThreshold`: deaths in a single raid to trigger.
- `myths.definitions.<id>.trigger.recentRaidWindow`: number of recent raids to sum.
- `myths.definitions.<id>.trigger.recentRaidDeathsThreshold`: total deaths in recent raids to trigger.
- `myths.definitions.<id>.trigger.artifactImmediate`: trigger immediately on artifact found.
- `myths.definitions.<id>.trigger.successStreak`: consecutive ruins successes needed.
- `myths.definitions.<id>.trigger.droughtCount`: drought seasons required for trigger.
- `myths.definitions.<id>.trigger.waterRatioThreshold`: water ratio threshold for drought crisis.

Population roles:

- `population.roles.enabled`: enable builder/gatherer role preferences.
- `population.roles.builderRatio`: target share of builders among adults (0..1).
- `population.roles.managerRatio`: share of builders assigned to structure management (0..1).
- `population.roles.switchCooldownTicks`: ticks before a role can be reassigned.
- `population.roles.emergencyMinRatio`: stockpile ratio threshold to trigger emergency gathering.
- `population.roles.emergencyResources`: resources checked for emergency gathering.

Population relationships:

- `population.relationships.interactionsPerTick`: baseline relationship interactions per tick.
- `population.relationships.minInteractionsPerTick`: minimum interactions guaranteed each tick.
- `population.relationships.idleInteractionMultiplier`: extra interactions gained from idle adults.
- `population.relationships.proximityShare`: share of interactions that use proximity checks when housing is enabled (0..1).
- `population.relationships.maxDistance`: max distance (Manhattan) for proximity bonding.
- `population.relationships.bondGain`: bond score gained per interaction.
- `population.relationships.bondDecay`: bond score decay per interaction.
- `population.relationships.sameClanBondGainBonus`: extra bond gain multiplier for same-clan pairs (0.2 = +20%).
- `population.relationships.bondThreshold`: bond score required for stable bonding.
- `population.relationships.moraleMin`: morale where bonding bonus starts (0..1).
- `population.relationships.moraleMax`: morale where bonding bonus caps (0..1).
- `population.relationships.moraleBonusMax`: max bonding bonus added at peak morale (0..1).
- `population.relationships.moraleExponent`: curve exponent for morale-based bonding bonus.
- `population.idleWanderChance`: legacy per-tick wander chance (0..1), used as fallback for `population.idleWander.chance`.
- `population.idleWander.enabled`: enable waypoint-style idle wandering.
- `population.idleWander.chance`: chance per tick to start an idle stroll (0..1).
- `population.idleWander.radius`: max Manhattan distance from anchor (tiles).
- `population.idleWander.minPauseTicks`: minimum pause ticks after reaching a target.
- `population.idleWander.maxPauseTicks`: maximum pause ticks after reaching a target.
- `population.idleWander.maxTargetAge`: max ticks to keep the same idle target (0 disables).
- `population.idleWander.maxAttempts`: random samples to find a walkable idle target.
- `population.settlement.enabled`: enable smarter settlement center selection.
- `population.settlement.scanStep`: grid sampling step when evaluating settlement centers.
- `population.settlement.clearRadius`: radius around a candidate center to evaluate open space (tiles).
- `population.settlement.edgeBuffer`: minimum tiles from map edge for the village center.
- `population.settlement.minOpenRatio`: minimum open-space ratio required for a candidate (0..1).
- `population.settlement.resourceDistanceCap`: distance cap for resource proximity scoring (tiles).
- `population.settlement.resourceWeights.<resource>`: weights for proximity to key resources (0..1).
- `population.settlement.blockedTerrain`: terrain types treated as obstacles when scoring settlement centers.
- `population.pathing.stallThreshold`: ticks without progress before pathing detour kicks in.
- `population.pathing.detourTicks`: number of ticks to keep using detour pathing once stalled.
- `population.pathing.bfsRadius`: local BFS radius for detour pathing (tiles).
- `population.pathing.mode`: pathing strategy (`detour` or `field`).
- `population.pathing.field.radius`: Manhattan radius for the cached potential field (tiles).
- `population.pathing.field.ttlTicks`: ticks to reuse a cached field before rebuilding.
- `population.pathing.field.temperature`: randomness for weighted step selection (0..1).
- `population.pathing.field.terrainWeight`: weight for terrain movement delay (0..1).
- `population.pathing.field.crowdWeight`: weight for avoiding occupied tiles (0..1).
- `population.pathing.field.inertiaWeight`: bias to continue the previous direction (0..1).
- `population.pathing.field.stayPenalty`: penalty for staying in place when pathing (0..1).

Population reproduction:

- `population.reproduction.enabled`: enable reproduction.
- `population.reproduction.gestationTicks`: ticks before a pregnancy results in birth.
- `population.reproduction.baseChance`: base conception chance per eligible couple per tick.
- `population.reproduction.cooldownTicks`: fertility cooldown after a birth.
- `population.reproduction.resourcePerCapita.<resource>`: per-capita stockpile required to scale conception chance.
- `population.reproduction.softCap`: soft population cap for crowding penalty.
- `population.reproduction.crowdingMinFactor`: minimum crowding multiplier (0..1).
- `population.reproduction.moraleInfluence`: morale weight on conception chance (0..1).
- `population.reproduction.birthCost.<resource>`: stockpile cost consumed at conception.
- `population.reproduction.minStockpileRatio.<resource>`: block conceptions if stockpile ratio is below this (0..1).

Villages:

- `villages.enabled`: enable multi-village founding.
- `villages.maxCount`: maximum simultaneous villages.
- `villages.founderCount`: number of dwarves credited as founders when a village is created.
- `villages.populationThresholds`: population thresholds for founding new villages (e.g. `[200, 400]`).
- `villages.minDistanceBetween`: minimum Manhattan distance between village centers.
- `villages.requiredResources`: resources that must be nearby for a new village site.
- `villages.requiredResourceDistance`: max distance for required resources (tiles).
- `villages.structureRadius`: radius used to spread new builds across village centers (tiles).
- `villages.expandStructures`: structure types allowed to use non-primary village centers.

Clans:

- `clans.enabled`: enable clan culture system.
- `clans.list`: ordered list of clan ids.
- `clans.labels.<clan>`: short clan label used in the HUD.
- `clans.distribution.<clan>`: spawn weight for initial/random clan assignment.
- `clans.inheritance.mode`: `parent` (inherit from parents) or `random` (distribution only).
- `clans.effects.<clan>.mine_output_bonus`: mine output bonus applied to all mine outputs (0..1).
- `clans.effects.<clan>.mine_rare_chance_bonus`: additive rare drop chance for mines (0..1).
- `clans.effects.<clan>.storm_cold_need_decay_bonus`: extra need-decay multiplier during storm/cold (0..1).
- `clans.effects.<clan>.build_ticks_bonus`: build/upgrade tick reduction (0..1).
- `clans.effects.<clan>.build_cost_penalty`: extra stone/iron cost ratio for build/upgrade jobs (0..1).
- `clans.effects.<clan>.gather_ticks_penalty`: gather tick penalty (0..1).
- `clans.effects.<clan>.mine_output_penalty`: mine output penalty (0..1).
- `clans.effects.<clan>.sawmill_output_penalty`: sawmill output penalty (0..1).
- `clans.effects.<clan>.raid_defense_bonus`: raid defense bonus scaled by clan share of adults (0..1).
- `clans.effects.<clan>.raid_max_kills_bonus`: watchtower max-kills bonus scaled by clan share of adults (0..1).
- `clans.effects.<clan>.ruins_combat_bonus`: ruins combat bonus scaled by clan share in expedition party (0..1).
- `clans.effects.<clan>.ruins_hazard_reduction`: ruins hazard reduction scaled by clan share in expedition party (0..1).
- `clans.effects.<clan>.gather_yield_penalty`: gather yield penalty (0..1).
- `clans.effects.<clan>.gather_penalty_resources`: list of gather resources affected by the penalty.

Structures (houses):

- `structures.house.buildTicks`: ticks required to build a house.
- `structures.house.buildCost.<resource>`: resource costs to build a house.
- `structures.house.levels.<level>.capacity`: beds provided by a house level.
- `structures.house.levels.<level>.upgradeTicks`: ticks required to upgrade to that level.
- `structures.house.levels.<level>.upgradeCost.<resource>`: resource costs for that level.
- `structures.house.upgradeMinHousingRatio`: minimum beds/pop ratio before upgrades are attempted when not forced.
- `structures.house.upgradeMinHouses`: minimum house count before upgrades are preferred when housing is short.
- `structures.house.upgradeMinAdjacency`: minimum adjacent houses required for an upgrade candidate.

Structures (watchtowers):

- `structures.watchtower.count`: initial watchtower count.
- `structures.watchtower.maxCount`: maximum watchtowers allowed.
- `structures.watchtower.buildTicks`: ticks to build one watchtower.
- `structures.watchtower.buildCost.<resource>`: resource costs to build a watchtower.
- `structures.watchtower.buildMinResources.<resource>`: minimum stockpile ratios before building.
- `structures.watchtower.manager.enabled`: enable manager-driven watchtower builds.
- `structures.watchtower.placement.minDistanceBetween`: minimum Manhattan distance between watchtowers.
- `structures.watchtower.placement.maxAttempts`: random samples per build attempt.
- `structures.watchtower.placement.avoidTerrain`: terrain types where watchtowers cannot be placed.
- `structures.watchtower.raid.range`: Manhattan range for watchtower attacks.
- `structures.watchtower.raid.hitChance`: chance per tick to hit a beast within range (0..1).
- `structures.watchtower.raid.damagePerTick`: reserved for future per-hit damage tuning.
- `structures.watchtower.raid.maxKillsPerTick`: cap on beasts killed per tick.
- `structures.watchtower.raid.defensePerTower`: defense gained per watchtower (0..1).
- `structures.watchtower.raid.defenseMax`: maximum defense contribution from watchtowers (0..1).

Structures (wells, fields):

- `structures.well.buildMinRadius`: minimum Manhattan radius from village center.
- `structures.well.buildOuterBuffer`: extra distance beyond the current village perimeter (houses).
- `structures.well.skipWhenTerrainWaterWithin`: skip well building if terrain water is within this Manhattan distance of the village center.
- `structures.well.criticalStockpileRatio`: allow well building despite nearby terrain water when water stockpile ratio is below this threshold.
- `structures.well.manager.enabled`: enable manager-driven well builds.
- `structures.well.manager.buildBelowRatio`: start building when water stockpile ratio is below this (0..1).
- `structures.well.manager.stopAboveRatio`: stop building when water stockpile ratio is above this (0..1).
- `structures.well.placement.mode`: placement mode (`poisson` uses map sampling; omit for legacy).
- `structures.well.placement.minDistanceFromCenter`: minimum Manhattan distance from village center (omit to use build radius).
- `structures.well.placement.maxDistanceFromCenter`: maximum Manhattan distance from village center (0 = no cap).
- `structures.well.placement.minDistanceBetween`: minimum Manhattan distance between wells.
- `structures.well.placement.minStructureDistance`: minimum Manhattan distance from any structure.
- `structures.well.placement.maxAttempts`: random samples per build attempt.
- `structures.well.placement.avoidTerrain`: terrain types where wells cannot be placed.
- `structures.well.cluster.enabled`: enable fixed cluster placement for wells.
- `structures.well.cluster.radius`: cluster radius in tiles (Manhattan).
- `structures.well.cluster.minWallDistance`: minimum distance from the village center to the cluster edge (tiles).
- `structures.well.cluster.minSeparation`: minimum distance between well/field cluster centers (tiles).
- `structures.well.cluster.minStructureDistance`: minimum distance from other structures to the cluster edge (tiles).
- `structures.well.cluster.shape`: cluster shape (`diamond` or `rect`).
- `structures.well.cluster.width`: cluster width in tiles (rect only).
- `structures.well.cluster.height`: cluster height in tiles (rect only).
- `structures.well.cluster.side`: placement side for rect clusters (`left` or `right`).
- `structures.field.buildMinRadius`: minimum Manhattan radius from village center.
- `structures.field.buildOuterBuffer`: extra distance beyond the current village perimeter (houses).
- `structures.field.allowForestWhenPlainBelow`: allow structures to be placed on forest tiles when plain+fertile coverage is below this ratio (0..1).
- `structures.field.manager.enabled`: enable manager-driven field builds.
- `structures.field.manager.buildBelowRatio`: start building when food stockpile ratio is below this (0..1).
- `structures.field.manager.stopAboveRatio`: stop building when food stockpile ratio is above this (0..1).
- `structures.field.placement.mode`: placement mode (`poisson` uses map sampling; omit for legacy).
- `structures.field.placement.minDistanceFromCenter`: minimum Manhattan distance from village center (omit to use build radius).
- `structures.field.placement.maxDistanceFromCenter`: maximum Manhattan distance from village center (0 = no cap).
- `structures.field.placement.minDistanceBetween`: minimum Manhattan distance between fields.
- `structures.field.placement.minStructureDistance`: minimum Manhattan distance from any structure.
- `structures.field.placement.maxAttempts`: random samples per build attempt.
- `structures.field.placement.avoidTerrain`: terrain types where fields cannot be placed.
- `structures.field.cluster.enabled`: enable fixed cluster placement for fields.
- `structures.field.cluster.radius`: cluster radius in tiles (Manhattan).
- `structures.field.cluster.minWallDistance`: minimum distance from the village center to the cluster edge (tiles).
- `structures.field.cluster.minSeparation`: minimum distance between well/field cluster centers (tiles).
- `structures.field.cluster.minStructureDistance`: minimum distance from other structures to the cluster edge (tiles).
- `structures.field.cluster.shape`: cluster shape (`diamond` or `rect`).
- `structures.field.cluster.width`: cluster width in tiles (rect only).
- `structures.field.cluster.height`: cluster height in tiles (rect only).
- `structures.field.cluster.side`: placement side for rect clusters (`left` or `right`).

Structures (workshop):

- `structures.workshop.count`: initial workshop count.
- `structures.workshop.maxCount`: maximum workshops allowed.
- `structures.workshop.buildMinRadius`: minimum Manhattan radius from village center.
- `structures.workshop.buildOuterBuffer`: extra distance beyond the current village perimeter (houses).
- `structures.workshop.buildTicks`: ticks required to build a workshop.
- `structures.workshop.buildCost.<resource>`: resource costs to build a workshop.

Structures (armory):

- `structures.armory.count`: initial armory count.
- `structures.armory.maxCount`: maximum armories allowed.
- `structures.armory.buildMinRadius`: minimum Manhattan radius from village center.
- `structures.armory.buildOuterBuffer`: extra distance beyond the current village perimeter (houses).
- `structures.armory.buildMinResources.<resource>`: minimum stockpile ratios before building.
- `structures.armory.buildTicks`: ticks required to build an armory.
- `structures.armory.buildCost.<resource>`: resource costs to build an armory.
- `structures.armory.workersPerArmory`: workers assigned per armory.
- `structures.armory.kitTicks`: ticks required to craft a kit.
- `structures.armory.kitOutput`: kits produced per job.
- `structures.armory.kitMax`: maximum kits to keep in stockpile.
- `structures.armory.kitCost.<resource>`: resource costs per kit.
- `structures.armory.pauseOnEmergency`: pause armory jobs during emergency gathering.

Structures (mithril forge):

- `structures.mithril_forge.count`: initial mithril forge count.
- `structures.mithril_forge.maxCount`: maximum mithril forges allowed.
- `structures.mithril_forge.buildMinRadius`: minimum Manhattan radius from village center.
- `structures.mithril_forge.buildOuterBuffer`: extra distance beyond the current village perimeter (houses).
- `structures.mithril_forge.buildMinResources.<resource>`: minimum stockpile ratios before building.
- `structures.mithril_forge.buildTicks`: ticks required to build a mithril forge.
- `structures.mithril_forge.buildCost.<resource>`: resource costs to build a mithril forge.
- `structures.mithril_forge.levelMax`: maximum mithril forge level.
- `structures.mithril_forge.levelBonusMin`: bonus at level 1 (fraction).
- `structures.mithril_forge.levelBonusMax`: bonus at max level (fraction).
- `structures.mithril_forge.levelBonusExponent`: curve exponent for level bonuses.
- `structures.mithril_forge.levels.<level>.upgradeTicks`: ticks required to upgrade to this level.
- `structures.mithril_forge.levels.<level>.upgradeCost.<resource>`: resource costs for this level.

Structures (brewery):

- `structures.brewery.count`: initial brewery count.
- `structures.brewery.maxCount`: maximum breweries allowed.
- `structures.brewery.workersPerBrewery`: workers assigned per brewery.
- `structures.brewery.buildMinRadius`: minimum Manhattan radius from village center.
- `structures.brewery.buildOuterBuffer`: extra distance beyond the current village perimeter (houses).
- `structures.brewery.buildTicks`: ticks required to build a brewery.
- `structures.brewery.buildCost.<resource>`: resource costs to build a brewery.
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
- `structures.brewery.pauseWhenFoodRatioBelow`: pause brewery jobs when food stockpile ratio falls below this (0..1).

Structures (sawmill):

- `structures.sawmill.count`: initial sawmill count.
- `structures.sawmill.maxCount`: maximum sawmills allowed.
- `structures.sawmill.workersPerSawmill`: workers assigned per sawmill.
- `structures.sawmill.buildMinRadius`: minimum Manhattan radius from village center.
- `structures.sawmill.buildOuterBuffer`: extra distance beyond the current village perimeter (houses).
- `structures.sawmill.buildTicks`: ticks required to build a sawmill.
- `structures.sawmill.buildCost.<resource>`: resource costs to build a sawmill.
- `structures.sawmill.outputPerTick.<resource>`: per-worker output applied each tick while operating.
- `structures.sawmill.levelMax`: maximum sawmill level.
- `structures.sawmill.levelBonusMin`: bonus at level 1 (fraction).
- `structures.sawmill.levelBonusMax`: bonus at max level (fraction).
- `structures.sawmill.levelBonusExponent`: curve exponent for level bonuses.
- `structures.sawmill.upgradeTicks`: ticks required per level upgrade.
- `structures.sawmill.upgradeCostScale`: exponential multiplier per level.
- `structures.sawmill.upgradeBaseCost.<resource>`: base upgrade costs.

Structures (mines):

- `structures.mine.count`: initial mine count (spawned on allowed terrain when possible).
- `structures.mine.maxCount`: maximum number of mines allowed.
- `structures.mine.minersPerMine`: number of miners assigned per mine.
- `structures.mine.buildMinRadius`: minimum Manhattan radius from village center.
- `structures.mine.buildOuterBuffer`: extra distance beyond the current village perimeter (houses).
- `structures.mine.buildTerrain`: allowed terrain types for mine placement.
- `structures.mine.buildTicks`: ticks required to build a mine.
- `structures.mine.buildCost.<resource>`: resource costs to build a mine.
- `structures.mine.outputPerTick.<resource>`: per-miner output applied each tick while mining.
- `structures.mine.levelMax`: maximum mine level.
- `structures.mine.levelBonusMin`: bonus at level 1 (fraction).
- `structures.mine.levelBonusMax`: bonus at max level (fraction).
- `structures.mine.levelBonusExponent`: curve exponent for level bonuses.
- `structures.mine.upgradeTicks`: ticks required per level upgrade.
- `structures.mine.upgradeCostScale`: exponential multiplier per level.
- `structures.mine.upgradeBaseCost.<resource>`: base upgrade costs.
- `structures.mine.rareDrops.<resource>.minLevel`: minimum mine level required to unlock a rare drop.
- `structures.mine.rareDrops.<resource>.chance`: per-tick chance per miner to add the rare resource (0..1).
- `structures.mine.rareDrops.<resource>.amount`: amount added on a successful roll.
- `structures.mine.preciousChanceMin`: placeholder chance at level 1 for future precious drops.
- `structures.mine.preciousChanceMax`: placeholder chance at max level for future precious drops.

Structures (ruins):

- `structures.ruins.count`: initial ruins count (typically 1, always placed at start).
- `structures.ruins.spawnTerrain`: terrain types allowed for initial ruins placement.
- `structures.ruins.minSpawnTiles`: minimum number of spawn terrain tiles reserved for ruins.

Ruins exploration:

- `ruins.enabled`: enable ruins exploration system.
- `ruins.outputBonusApplyTo`: resources that receive output bonuses from ruin artifacts.
- `ruins.expedition.requiresArmory`: require at least one armory to start expeditions.
- `ruins.expedition.kitResource`: stockpile resource id used as expedition kits.
- `ruins.expedition.kitPowerBonus`: combat power bonus from a kit (fraction).
- `ruins.expedition.minIdleAdults`: minimum idle adults required to start an expedition.
- `ruins.expedition.minPopulation`: minimum population required to start an expedition.
- `ruins.expedition.cooldownTicks`: cooldown ticks after a successful expedition.
- `ruins.expedition.failureCooldownTicks`: cooldown ticks after a failed expedition.
- `ruins.expedition.partySizeMin`: minimum expedition party size.
- `ruins.expedition.partySizeMax`: maximum expedition party size.
- `ruins.expedition.maxConcurrentAfterClear`: max concurrent expeditions after all rooms are cleared (cooldown is ignored).
- `ruins.expedition.minStockpileRatio.<resource>`: minimum stockpile ratios before expeditions start.
- `ruins.expedition.failureLossMin`: minimum expedition casualties on failure.
- `ruins.expedition.failureLossMax`: maximum expedition casualties on failure.
- `ruins.mithrilReinforcement.enabled`: enable mithril reinforcement for expeditions.
- `ruins.mithrilReinforcement.minRoom`: minimum room index (1-based) to allow mithril use.
- `ruins.mithrilReinforcement.cost.<resource>`: resources consumed for mithril reinforcement.
- `ruins.mithrilReinforcement.powerBonus`: combat power bonus when mithril is used (fraction).
- `ruins.guardians.artifactBonus`: extra artifact chance when guardians are defeated (fraction).
- `ruins.rooms[]`: ordered list of rooms to explore.
- `ruins.rooms[].name`: display name for the room.
- `ruins.rooms[].expeditionTicks`: ticks required to explore the room.
- `ruins.rooms[].partySize`: desired party size for the room.
- `ruins.rooms[].cost.<resource>`: per-expedition resource costs for the room.
- `ruins.rooms[].hazardChance`: base failure chance (0..1).
- `ruins.rooms[].guardianChance`: chance to spawn a guardian (0..1).
- `ruins.rooms[].guardianPower`: guardian power threshold.
- `ruins.rooms[].artifactChance`: base artifact drop chance (0..1).
- `ruins.rooms[].artifactRolls`: number of artifact rolls on success.
- `ruins.artifacts.sets.<set>.name`: label for an artifact set.
- `ruins.artifacts.sets.<set>.artifacts`: ordered artifact ids for the set (used for counts).
- `ruins.artifacts.pool.<artifact>.name`: artifact display name.
- `ruins.artifacts.pool.<artifact>.set`: artifact set id.
- `ruins.artifacts.pool.<artifact>.weight`: weight for random selection.
- `ruins.setBonuses.<set>.<count>.<bonus>`: bonus values unlocked at the given set count.
- `ruins.comboBonuses[]`: cross-set bonus entries with `requires` and `bonus` mappings.

Tools:

- `tools.initialLevel`: starting tool level.
- `tools.maxLevel`: maximum tool level.
- `tools.bonusMin`: minimum gathering bonus at level 1 (fraction).
- `tools.bonusMax`: maximum gathering bonus at max level (fraction).
- `tools.bonusExponent`: curve exponent for bonus progression.
- `tools.upgradeTicks`: ticks required per tool upgrade.
- `tools.upgradeBaseCost.<resource>`: base resource costs for tool upgrades.
- `tools.upgradeCostScale`: exponential multiplier per level.
- `tools.applyTo`: resource ids affected by tool bonuses.

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
- `ai.reward.raidPrepDefense`: bonus for defense readiness (adults + watchtowers) during raid-eligible seasons.
- `ai.reward.ruinsSuccess`: reward per successful expedition (delta).
- `ai.reward.ruinsArtifact`: reward per artifact found (delta).
- `ai.reward.ruinsFailure`: penalty per failed expedition (delta).
- `ai.reward.ruinsRoomClear`: reward per room cleared (delta).
- `ai.reward.festival_active`: reward per step while a festival is active.
- `ai.reward.festival_start`: reward when a festival starts (edge-triggered).
- `ai.reward.festival_intent`: reward per step for higher festival intent while eligible.
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
- `ai.training.trainer.featureNames`: ordered list of observation features per resource (e.g. `shortage`, `nodeScarcity`, `criticalNeeds`, `idleAdults`, `populationBalance`, `seasonIndex`, `seasonProgress`, `weatherSeverity`, `weatherTimeLeft`, `raidActive`, `raidTimeLeft`, `raidExposed`, `raidDefense`, `housingShortage`, `seasonEligible`, `ruinsActive`, `ruinsCooldown`, `ruinsProgress`, `ruinsArtifacts`, `clanShare_abyssborn`).
- `ai.training.trainer.activation`: hidden-layer activation (`tanh` or `relu`).
- `ai.training.trainer.logStdInit`: initial log-std for action sampling.
- `ai.training.trainer.maxGradNorm`: gradient norm clip.
- `ai.training.trainer.workers`: number of parallel rollout workers.
- `ai.training.trainer.logEvery`: episodes between training checkpoints (policy save + window reset).
- `ai.training.trainer.debugMode`: debug payload mode for ai_server (`full`, `summary`, `final`, `off`).
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
