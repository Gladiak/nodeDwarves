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

AI reward + smart termination (Phase 1):

- `ai.reward.*Delta` channels reward step-to-step progress (stockpile, population balance, Underrealm, myths) while preserving legacy static reward terms.
- `ai.reward.deltaClip`: symmetric clip for each delta channel (`0` disables clipping).
- `ai.reward.eventClip`: symmetric clip for aggregated event/progression channels (`0` disables clipping).
- `ai.reward.totalClip`: symmetric clip for final per-step reward (`0` disables clipping).
- `ai.training.terminationProfile.*`: training-only smart early-termination profile injected by `scripts/train_wrapper.js` into `ai.training.configOverrides.ai.termination`.
- Wrapper keeps `ai.training.evalOverrides.ai.termination.enabled=false` so canonical eval/promotion/regression runs still measure long-horizon quality without early-stop bias.
- Smart termination plateau gating supports deep-signal guardrails (`maxUnderrealmCombatPressure`, `maxMythsSeverity`) and raid guard (`allowDuringRaid`).

PPO v2 stability stack (Phase 2):

- `ai.training.trainer.obsNorm` + `obsNormClip` + `obsNormEpsilon`: running observation normalization for rollout/eval/inference parity.
- `ai.training.trainer.returnNorm` + `returnNormClip` + `returnNormEpsilon`: running return normalization for value-loss scale stability.
- `ai.training.trainer.targetKl`: PPO update early-stop based on approximate KL.
- `ai.training.trainer.valueClipRange`: PPO-style value clipping (normalized domain).
- `ai.training.trainer.valueHuberDelta`: optional Huber value loss (`0` keeps MSE).
- `ai.training.trainer.algorithm`: startup-validated trainer selector (`ppo` only for now; other values fail fast).
- Policy payloads now persist normalization metadata (`normalization.observation` / `normalization.returns`).
- Compatibility note: if normalization metadata shape mismatches the current feature/action contract, resume/eval fails fast and training must restart with `--fresh`.

Throughput + resume continuity (Phase 3):

- Trainer console and summary windows now emit throughput diagnostics by default:
  - `eps_pm`: episodes/minute over the current log window.
  - `thr[...]`: average env/IPC latency metrics (`env`, `ipc_w`, `ipc_r`, `ipc_p`, milliseconds).
  - PPO diagnostics now include `upd_ms` (mean PPO update latency per batch in the current window).
- Worker/learner rollout payload is now packed (`dict` of arrays) and GAE is computed in workers before queue transfer, reducing per-episode serialization overhead.
- Promotion continuity now includes optimizer state copy: on best promotion, `python/promote_best.py` mirrors `modelStatePath` to `bestModelStatePath` when present.
- Transport mode is configurable via `ai.training.trainer.transport` or CLI `--transport`:
  - default: `compact` (higher-throughput path).
  - `legacy`: backward-compatible full JSON observation/action envelopes.
  - `compact`: flattened `obsVector` + fixed-order `actionValues` transport, with legacy fallback still accepted by `ai_server.js`.

Scenario curriculum defaults:

- `ai.training.scenarios` now includes dedicated stress slices on top of legacy scarcity/clan/ruins mixes:
  - `underrealm_push`: accelerates deep unlock/readiness loops so Underrealm progression/combat signals are sampled more often.
  - `underrealm_late_gauntlet`: late-difficulty (`>=0.72`) deep gauntlet with tighter readiness/cooldown/surface-reserve constraints.
  - `compound_crisis`: combines low stockpiles, food/water scarcity, harsher needs/weather, stronger raids, and housing pressure.
  - `governance_pressure`: increases world-event and external-camp churn with higher schism pressure to stress diplomacy/governance control paths.
  - `social_tension_pressure`: increases social-drama incident cadence and rivalry/grudge weighting (with elevated schism baseline pressure) to stress social-stability control paths.
- 2026-02 deterministic safety retune (config-only):
  - `underrealm_push` now uses stricter deep readiness + slower retry pacing and keeps more adults on surface reserve.
  - `compound_crisis` now keeps the crisis profile but with moderated scarcity/need/raid pressure to avoid deterministic over-kill in hardened `underrealm`/`governance` regression slices.
- Default canonical eval scenario list (`ai.training.evalScenarios`) is now:
  - `baseline`, `full_sim`, `wildlife_raid`, `water_scarce`, `food_scarce`, `ruins_focus`, `underrealm_push`, `compound_crisis`, `governance_pressure`, `social_tension_pressure`, `warrior_realism_pressure`.
- Design intent: keep daily training focused on robustness under multi-system stress while still preserving baseline/full-sim comparability.
- Adaptive scenario-sampling cadence is tuned for wrapper-sized runs:
  - `ai.training.scenarioSampling.updateEvery=80` by default, so normal quality/full phases can trigger weight updates within one run.
  - `ai.training.scenarioSampling.difficultyPhases` can override `updateEvery`, `boost`, and `exponent` per difficulty band (`early`, `mid`, `late` by default).
- Adaptive sampler observability (2026-02):
  - Trainer summary lines now expose `scenario_updates=<window>/<total>`.
  - `window`: updates applied in the current summary window.
  - `total`: cumulative updates since phase/run start.
  - Keep using `events=scenario_weights` as the qualitative trigger marker.
  - Phase transitions emit `events=scenario_phase=<name>(u<updateEvery>,b<boost>,e<exponent>)`.

Wrapper low-load tuning (no config edit needed):

- `npm run ai:train:quality:lite`: quality preset with wrapper low-load mode.
- `npm run ai:train:quality:mixed`: mixed curriculum preset (`quality-mixed`) with ~`76/24` episode split between light foundation (`160` episodes, non-full-sim) and full-sim finetune (`50` episodes).
- `npm run ai:train:quality:daily`: daily shortcut with canonical final-only promote, canonical eval `12x1600`, and paired-LCB disabled for canonical/non-canonical phase promotes.
- `npm run ai:train:continuous`: cycle orchestrator for cumulative learning using existing presets with historical defaults from `scripts/train_continuous.js` (`daily` by default, periodic `full`, periodic `high`, optional `ai:validate:gate` cadence).
- `npm run ai:train:continuous:balanced`: explicit anti-stagnation balanced alias:
  - `--cycles 36 --full-every 6 --high-every 12 --gate-every 6 --max-no-improve 14 --max-gate-fail 3`
  - Key options:
    - `--cycles <n>`
    - `--full-every <n>` / `--high-every <n>` (high takes precedence when both match)
    - `--gate-every <n>`
    - `--max-no-improve <n>` (strict non-improve: no canonical promotion in cycle summary)
    - `--improve-threshold <x>` (diagnostic only: tags positive delta cycles that were not promoted)
    - `--max-gate-fail <n>`
    - `--fresh-first`
  - Emits run reports in `debug/continuous_train_<timestamp>.json/.md` with explicit fields (`improvedReason`, `promotionAligned`, `deltaPositive`).
- `--low-load`: one-shot preset for reduced machine pressure:
  - caps auto workers (`workersAutoMin/Max <= 4`) and reserves at least 3 CPU slots;
  - switches canonical promotion from per-phase to final-only;
  - lowers canonical eval defaults to `8` episodes and `1600` max steps;
  - disables paired-LCB by default for that run;
  - enables promote partial progress logs every `2` episodes.
- Canonical mode overrides:
  - `--canonical-final-only`
  - `--canonical-per-phase`
  - `--no-canonical-promote`
- Canonical load overrides:
  - `--canonical-eval-episodes <n>`
  - `--canonical-eval-max-steps <n>`
  - `--canonical-no-positive-lcb` / `--canonical-require-positive-lcb`
- Phase promote paired-LCB overrides:
  - `--phase-promote-no-positive-lcb` / `--phase-promote-require-positive-lcb`
- Promote progress overrides:
  - `--promote-eval-progress` / `--promote-no-eval-progress`
  - `--promote-eval-progress-every <n>`
- High-visibility run tracking (slow machines):
  - keep wrapper progress always on: `--promote-eval-progress --promote-eval-progress-every 1`
  - increase trainer console cadence through forwarded args: `--log-every 10 --eval-every 5`
  - example:
    - `npm run ai:train:quality:lite -- --promote-eval-progress --promote-eval-progress-every 1 --log-every 10 --eval-every 5`

Operational cycle runbook (2026-02-19 baseline contract):

- Canonical master contract (use this for all score comparisons):
  - `evalEpisodes=20`
  - `evalMaxSteps=2200`
  - `stepTicks=2`
  - `evalScore=rpt`
  - `transport=compact`
- Command aliases:
  - `npm run ai:validate:canonical`
    - runs eval-only canonical check on `models/policy_best.json`
    - writes `debug/canonical_master_latest.json` + `.md`
  - `npm run ai:validate:risk`
    - `r001`: deterministic collapse pressure check (`ai:validate:benchmark`)
    - `r002`: observation-normalization shape guardrail on `models/policy_best.json`
  - `npm run ai:validate:horizon`
    - horizon profile with deterministic seed-pack default mode (`ai.training.deepChecks.seedPackRotation.defaultMode`) when CLI does not override seeds.
  - `npm run ai:validate:horizon:weekly`
    - horizon profile with deterministic weekly seed-pack rotation (`--seed-pack weekly`, default packs now `4` seeds each).
    - optional override: append `-- --seed-week YYYY-MM-DD` (or `YYYY-Www`) to replay a specific week.
  - `npm run ai:validate:extended:optimized`
    - full acceptance-quality flow with equivalent checks to `ai:validate:extended` but without duplicate benchmark execution.
    - writes runtime profiling reports: `debug/extended_gate_runtime_optimized_latest.json` + `.md`.
  - Deterministic regression profile slices:
    - `standard`: `baseline`, `full_sim`
    - `underrealm`: `baseline`, `underrealm_push`, `compound_crisis`
    - `governance`: `baseline`, `governance_pressure`, `compound_crisis`
    - `social`: `baseline`, `social_tension_pressure`, `governance_pressure`
- Controlled A/B/C cycle template (single-change discipline):
  - Cycle A:
    - `npm run ai:train:quality:daily`
    - `npm run ai:validate:canonical`
    - `npm run ai:validate:gate`
  - Cycle B:
    - apply exactly one additional change
    - rerun the same 3 commands
  - Cycle C:
    - `npm run ai:train:quality:high`
    - `npm run ai:validate:canonical`
    - `npm run ai:validate:gate`
    - `npm run ai:validate:risk`
- Acceptance criteria for a candidate tweak:
  - positive canonical score delta under the fixed master contract
  - benchmark + regression gate pass (`ai:validate:gate`)
  - risk mini-gate pass (`ai:validate:risk`)
  - if any criterion fails, revert the last tweak and start a new single-change cycle
- Recommended cadence split (OQ-6.4):
  - per-change loop (fast signal):
    - `npm run ai:validate:canonical`
    - `npm run ai:validate:gate`
    - `npm run ai:validate:risk:r002`
  - acceptance/nightly full run (no quality-signal loss, runtime-optimized):
    - `npm run ai:validate:extended:optimized`
  - weekly deep sentinel:
    - `npm run ai:validate:horizon:weekly`

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
- `ai.governors.contracts.enabled`: enable contract-governor commit-timing hooks during training/eval.
- `ai.governors.contracts.commitIntentThreshold`: minimum normalized `commitIntent` to complete affordable contracts before near-expiry force window.
- `ai.governors.contracts.forceCompleteTicks`: fail-safe completion window near contract expiry (affordable requests are force-completed).
- `ai.governors.contracts.reserveMinStockpileRatios.<resource>`: optional post-commit reserve-ratio floor guardrails for early contract completion.
- `ai.governors.ruins.enabled`: enable ruins-governor warning-dispatch and mithril-posture hooks during training/eval.
- `ai.governors.ruins.warningDispatchIntentThreshold`: minimum normalized `warningDispatchIntent` required to allow warning-zone expedition starts.
- `ai.governors.ruins.mithrilReinforcementIntentThreshold`: minimum normalized `mithrilReinforcementIntent` required to spend mithril reinforcement when eligible.
- `ai.governors.underrealm.enabled`: enable underrealm-crew posture governor hooks during training/eval.
- `ai.governors.underrealm.surfaceReserveBiasMax`: max absolute reserve-ratio shift from `action.underrealm.surfaceReserveBias`.
- `ai.governors.underrealm.depthAllocationBiasMax`: max absolute depth-ramp shift from `action.underrealm.depthAllocationBias`.
- `ai.governors.underrealm.roleMixBiasMax`: max absolute role-ratio shift from `action.underrealm.minerMixBias|haulerMixBias|guardMixBias`.
- `ai.governors.underrealm.smoothingAlpha`: EMA smoothing factor for underrealm posture intents.
- `ai.governors.underrealm.majorReallocationThreshold`: normalized control-change threshold considered a major reallocation.
- `ai.governors.underrealm.reallocationCooldownTicks`: hold window for major reallocation flips (previous applied posture kept during cooldown).
- `ai.governors.underrealm.surfaceReserveRatioMin|surfaceReserveRatioMax`: clamp envelope for effective surface reserve ratio.
- `ai.governors.underrealm.depthWeightGrowthMin|depthWeightGrowthMax`: clamp envelope for effective depth distribution slope.
- `ai.governors.underrealm.roleRatioMin|roleRatioMax`: clamp envelope for effective miner/hauler/guard ratios before normalization.
- Stability recovery note: if `underrealm.eval.avg_deaths` is the only blocking metric, first tighten underrealm posture envelope before additional full retrains (current conservative baseline: `surfaceReserveBiasMax=0.14`, `depthAllocationBiasMax=0.12`, `roleMixBiasMax=0.12`, `surfaceReserveRatioMin=0.34`, `reallocationCooldownTicks=60`).
- `ai.governors.building.enabled`: enable ranked building-class governor hooks during training/eval.
- `ai.governors.building.defaultWeights.housing`: fallback class weight when no `action.building.housingWeight` is provided.
- `ai.governors.building.defaultWeights.economy`: fallback class weight when no `action.building.economyWeight` is provided.
- `ai.governors.building.defaultWeights.defense`: fallback class weight when no `action.building.defenseWeight` is provided.
- `ai.governors.building.defaultWeights.special`: fallback class weight when no `action.building.specialWeight` is provided.
- `ai.governors.building.mineBiasMax`: max absolute class-internal mine ordering bias from `action.building.mineBias`.
- `ai.governors.building.upgradeBiasMax`: max absolute housing ordering bias from `action.building.upgradeBias`.
- `ai.governors.externalCamps.enabled`: enable external-camps stance governor hooks during training/eval.
- `ai.governors.externalCamps.militiaIntentThreshold`: minimum normalized `militiaSupportIntent` to renew militia support when payment is affordable.
- `ai.governors.externalCamps.raiderTributeIntentThreshold`: minimum normalized `raiderTributeIntent` to pay raider tribute when payment is affordable.
- `ai.governors.externalCamps.forceComplianceOnCritical`: if true, tribute is force-paid (when affordable) during critical stockpile collapse regardless of raider intent.
- `ai.governors.externalCamps.criticalStockpileFloor`: stockpile-ratio floor used by critical-collapse compliance guardrail.
- `ai.governors.externalCamps.criticalResources[]`: resources used to evaluate critical-collapse floor.
- Training contract note: when trade/contracts/ruins/underrealm/building/external-camps governors are enabled, `python/train.py` appends governor pseudo action-ids to the policy action head (`gov_trade_*`, `gov_contract_*`, `gov_ruins_*`, `gov_underrealm_*`, `gov_building_*`, `gov_external_*`) in addition to resource actions and optional `festival`.
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
- `population.socialDrama.enabled`: enable social-drama runtime updates (aggregate social pressure/cohesion channels).
- `population.socialDrama.tickInterval`: ticks between social-drama updates.
- `population.socialDrama.pairSamplesPerUpdate`: sampled adult pair interactions per social update.
- `population.socialDrama.includeBondedPairs`: include currently bonded partner pairs in social-drama sampling.
- `population.socialDrama.carryoverPairsPerDwarf`: keep top historical links active each update for relationship continuity.
- `population.socialDrama.maxTrackedLinksPerDwarf`: retained social links cap per dwarf.
- `population.socialDrama.linkEpsilon`: minimum link strength kept after decay/pruning.
- `population.socialDrama.staleDecayPerTick`: passive per-tick link decay when interactions are stale.
- `population.socialDrama.friendshipThreshold`: affinity threshold for friendship status.
- `population.socialDrama.rivalryThreshold`: rivalry threshold for rivalry status.
- `population.socialDrama.mentorshipThreshold`: mentorship threshold for mentorship status.
- `population.socialDrama.grudgeThreshold`: grudge threshold for grudge status.
- `population.socialDrama.mentorshipAgeGapMin`: minimum age gap for mentorship inference.
- `population.socialDrama.mentorshipSkillGapMin`: minimum skill-gap scalar for mentorship inference.
- `population.socialDrama.affinityGainBase`: baseline affinity gain per evaluated pair.
- `population.socialDrama.affinityBondScale`: affinity gain contribution from partner bond ratio.
- `population.socialDrama.affinitySameClanBonus`: affinity gain bonus for same-clan pairs.
- `population.socialDrama.affinityDecayPerTick`: per-tick affinity decay.
- `population.socialDrama.rivalryBaseGain`: baseline rivalry gain per evaluated pair.
- `population.socialDrama.rivalryStressScale`: rivalry gain contribution from stress.
- `population.socialDrama.rivalryLowMoraleScale`: rivalry gain contribution from low morale.
- `population.socialDrama.rivalryBondShieldScale`: rivalry reduction from partner bond ratio.
- `population.socialDrama.rivalryDecayPerTick`: per-tick rivalry decay.
- `population.socialDrama.mentorshipBaseGain`: baseline mentorship gain when eligibility gates pass.
- `population.socialDrama.mentorshipBondScale`: mentorship gain from partner bond ratio when eligible.
- `population.socialDrama.mentorshipSkillScale`: mentorship gain from skill gap when eligible.
- `population.socialDrama.mentorshipDecayPerTick`: per-tick mentorship decay.
- `population.socialDrama.grudgeStressThreshold`: stress threshold that enables grudge gain.
- `population.socialDrama.grudgeStressScale`: grudge gain scale once stress+rivalry gates are met.
- `population.socialDrama.grudgeRivalryScale`: passive grudge gain from rivalry intensity.
- `population.socialDrama.grudgeDecayPerTick`: per-tick grudge decay.
- `population.socialDrama.incidents.enabled`: enable bounded social incidents during training/eval episodes.
- `population.socialDrama.incidents.intervalTicks`: minimum ticks between incident roll windows.
- `population.socialDrama.incidents.baseChancePerRoll`: incident roll probability when windows open.
- `population.socialDrama.incidents.maxPerUpdate`: max incidents resolved per social update.
- `population.socialDrama.incidents.globalCooldownTicks`: global incident cooldown after a trigger.
- `population.socialDrama.incidents.perPairCooldownTicks`: cooldown before the same pair can trigger another incident.
- `population.socialDrama.incidents.pairCooldownRetentionTicks`: stale pair-cooldown cleanup horizon.
- `population.socialDrama.incidents.historyLimit`: max retained incident history entries.
- `population.socialDrama.incidents.reconciliationAffinityMin`: affinity floor for reconciliation candidates.
- `population.socialDrama.incidents.weights.<type>`: weighted type-selection bias for `mentorship_breakthrough`, `rivalry_clash`, `grudge_escalation`, `reconciliation`.
- `population.socialDrama.incidents.effects.<type>.*`: bounded mood/link (and mentorship warrior-growth) incident effect deltas.
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

Underrealm readiness gate (Ruins dispatch coupling):

- Dispatch depth uses `max(roomIndex + 1, currentFrontierDepth)` (clamped to `underrealm.maxDepth`), so frontier champions remain contestable even after room progression plateaus.
- `underrealm.combat.progression_mode`: progression mode (`champion_gate` keeps unlock chain tied to champion clear).
- `underrealm.combat.readiness.hard_min_gate`: enforce hard block below floor minimum score.
- `underrealm.combat.readiness.warning_zone_risk_multiplier`: warning-zone risk multiplier applied to hazards/guardian/loss severity.
- `underrealm.combat.readiness.score_weights.offense|defense|support`: score component weights.
- `underrealm.combat.readiness.formula.weapon_avg_tier_scale`: weapon average-tier score scale.
- `underrealm.combat.readiness.formula.armor_avg_tier_scale`: armor average-tier score scale.
- `underrealm.combat.readiness.formula.support_kit_full_scale`: expedition-kit support coverage score scale.
- `underrealm.combat.readiness.formula.support_armory_level_scale`: armory-level support score scale.
- `underrealm.combat.encounter.rounds_base|rounds_per_depth`: deterministic champion round budget.
- `underrealm.combat.encounter.retry_cooldown_ticks_base|retry_cooldown_ticks_per_depth`: champion retry cooldown pacing.
- `underrealm.combat.dwarf_champion.enabled`: enable single-slot Dwarf Champion progression/bonus layer on top of aggregated champion encounters.
- `underrealm.combat.dwarf_champion.min_survivals`: survivals needed for deterministic promotion when no active Dwarf Champion exists.
- `underrealm.combat.dwarf_champion.attack_bonus_ratio|defense_bonus_ratio`: bounded aggregated party attack/defense bonus ratios.
- `underrealm.combat.dwarf_champion.requires_party_presence`: require active champion dwarf presence in expedition party before bonus applies.
- `underrealm.combat.floors.defaults.min_armory_level_base|min_armory_level_per_depth`: minimum armory-level baseline/scaling per floor depth.
- `underrealm.combat.floors.defaults.readiness.min_score_base|min_score_per_depth|recommended_score_base|recommended_score_per_depth`: default floor score thresholds by depth.
- `underrealm.combat.floors.defaults.champion.hp_base|hp_per_depth|attack_base|attack_per_depth|defense_base|defense_per_depth|penetration_base|penetration_per_depth`: default champion stat curve per depth.
- `underrealm.combat.floors.by_depth.<depth>.min_armory_level|readiness.min_score|readiness.recommended_score`: per-depth override thresholds.
- `underrealm.combat.floors.by_depth.<depth>.champion.enabled|id|label|hp|attack|defense|penetration`: per-depth champion overrides.

Underrealm AI observation features (M6):

- `underrealmDepthProgress`: unlocked-depth progression ratio (`maxUnlockedDepth / maxDepth`).
- `underrealmChampionProgress`: champion clears ratio (`championsDefeated / maxDepth`).
- `underrealmFrontierContested`: `1` when current frontier floor is `contested`.
- `underrealmChampionCooldown`: normalized champion retry cooldown ratio.
- `underrealmReadinessScore`: normalized readiness score ratio vs floor readiness scale.
- `underrealmReadinessGap`: normalized missing score ratio vs readiness scale.
- `underrealmReadinessBlocked`: `1` when readiness gate blocks dispatch.
- `underrealmReadinessWarning`: `1` when dispatch is in warning zone.
- `underrealmCombatPressure`: compact aggregate pressure signal from frontier/champion/readiness outcomes.
- Shape compatibility note: adding/removing/reordering `ai.training.trainer.featureNames` changes model input size, so resume is blocked and training must restart with `--fresh`.
- M8 compatibility note: Dwarf Champion integration does not change observation feature shape by default; existing M6 feature vectors remain shape-compatible.

Warrior League AI observation features (Phase 6):

- `warriorEnabled`: runtime warrior-system switch as normalized scalar.
- `warriorRosterCoverage`: adult coverage ratio for dwarves with warrior payloads.
- `warriorEliteScore`: deterministic top-roster aggregate combat quality scalar.
- `warriorLegacyAura`: normalized company legacy aura (`state.warriors.company.legacyAura`).
- `warriorChampionMomentum`: normalized champion quality scalar (rating/valor/hero-potential/condition blend).
- `warriorTournamentRecency`: normalized recency of latest league tournament tick.
- Transport parity note: compact `obsVector` and legacy JSON observation now share the same warrior-channel semantics and are validated by contracts.
- Upgrade note: pre-phase-6 checkpoints are shape-incompatible with the expanded default feature list; restart training with `--fresh`.

Diplomacy/governance observation features (Workstream A):

- World events: `worldEventActive`, `worldEventOfferPhase`, `worldEventOfferReady`, `worldEventTimeLeft`, `worldEventPressure`.
- Contracts: `contractActive`, `contractReady`, `contractTimeLeft`, `contractFailurePressure`, `contractReputation`.
- External camps: `externalCampActiveRatio`, `externalCampRaiderPressure`, `externalCampCaravanRisk`, `externalCampMilitiaSupport`, `externalCampTradeInfluence`, `externalCampPressure`.
- Schism: `schismPressure`, `schismLegitimacy`, `schismPhase`, `schismRitualOpen`, `schismClimaxActive`, `schismInstability`.
- Social drama: `socialCohesion`, `socialConflictPressure`, `socialMentorshipCoverage`, `socialGrudgeLoad`, `socialIncidentRecency`.
- Reward adds bounded diplomacy channels: `ai.reward.diplomacyCompletion`, `ai.reward.diplomacyFailure`, `ai.reward.diplomacyExpiration`, `ai.reward.diplomacyPressure`, `ai.reward.diplomacyPressureDelta`, `ai.reward.diplomacyLegitimacyDelta`.
- Reward adds bounded social channels: `ai.reward.socialCohesion`, `ai.reward.socialCohesionDelta`, `ai.reward.socialConflictPressure`, `ai.reward.socialConflictPressureDelta`, `ai.reward.socialMentorshipCoverage`, `ai.reward.socialMentorshipCoverageDelta`, `ai.reward.socialGrudgeLoad`, `ai.reward.socialGrudgeLoadDelta`, `ai.reward.socialIncidentRecency`.

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
