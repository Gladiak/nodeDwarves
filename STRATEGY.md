# NodeDwarves Strategy: State of the Art, Evidence and Plan

The single source of truth for simulation quality, training quality, measurements and the step plan.
Every change to difficulty, reward, action/observation design or the training recipe is measured
with the protocol in section 6 and recorded here (section 8). `README.md` describes the product;
`AGENTS.md` holds contributor rules. No other Markdown is kept in the repository.

Status date: 2026-11-26.

---

## 1. Goal: what "a real quality jump" means

Two axes, both measurable:

1. **Simulation quality.** Every game is its own story: it can be lost, it rewards foresight, its
   dangers are readable before they strike, and progress (Underrealm depth, landmarks, prestige) is
   earned. Concretely: a wide, stable spread between bad, default, good and trained play, no
   unavoidable collapses, and no hidden mechanics that make decisions irrelevant.
2. **Training quality.** Each training run produces a policy that is measurably better than the
   strongest hand-written strategy, and chained runs keep improving instead of flattening after the
   first one.

North-star scorecard (8,000-tick eval plan, section 6): final population and avoidable deaths for
`neglect` < `default` < `steward` (S2) < trained policy, with the trained-minus-steward gap
growing run after run. Companion metric, the **AI control share**: per scenario, the spread of final
population between the best and the worst player on the same seeds (trained or steward vs neglect),
relative to default. It measures how much of the outcome decisions control and must grow with S2-S4.

---

## 2. State of the art

### 2.1 Simulation

- Economy (since 2026-11-24, E18): fractional gather yields (food/water base 1.0 per trip, seasons,
  weather and bonuses scale every trip); lean winter (yield x0.45, node regen x0.25, births x0.5,
  needs x1.12); water is the everyday drink and beer a luxury (0.5 beer per 0.1 food, relief 0.25 vs
  water 0.35-0.4, breweries stop at 1.5x the drinking reserve); idle dwarves are split across
  shortages in proportion to weight x severity (a weight of 0 ignores a resource); births need
  2 food and 2 water in store per dwarf for full chances.
- The game can be lost. Ignoring resources ends in extinction in 11 of 24 games; the no-AI game
  survives all 24 but shrinks after its peak.
- Standard `npm start` game (4 seeds x 8,000 ticks, no AI): population 111 (65-158), deaths 43,
  idle adults 5%, beer average 3. Before the tightening: population 679, idle 22%, beer 13,272.
- Known weaknesses (section 4): synchronized founders cause a demographic cliff after
  ~4,500 ticks; progress collapsed with population (Underrealm depth 2.5 -> 0.5, completed landmarks
  -80% in the standard game); deep raids are the largest avoidable killer and have little counterplay.

### 2.2 AI interface

- 29 continuous action heads in [0, 2]: 4 job weights (food, water, wood, stone), festival intent,
  3 trade, 6 building, 1 contracts, 2 ruins, 5 Underrealm, 2 external camps, 5 warriors (social heads
  disabled). Governor intents are thresholds on value/2 (usually >= 0.5); a missing action means
  intent 1, so the default posture is "everything on".
- Observation: 81 named features in an 87-value factored vector (`src/ai/observation_layout.js`),
  including clan shares, social and warrior signals, the age structure, births last year, growth
  budget, food/water autonomy (S4e) and population against the cycle peak (`populationToPeak`, T5);
  the simulation tracks that peak in `state.populationPeak` (bookkeeping only, games unchanged).
- Decisions every 2 ticks in training and promotion (5 in the interactive game).

### 2.3 Training

- PPO, 2x128 MLP, JSON weights for JS inference (`src/ai/policy.js`).
- Reward (`src/ai/outcome_reward.js`, weights in `ai.reward`): population per 100 dwarves every step,
  -2 per avoidable death (starvation, raids, deep raids, ruins, hunts, Warrior League; not old age),
  -1 x share of dwarves with hunger or thirst >= 0.6, +0.3 x food/water reserve per dwarf (2 units =
  full), +20 per Underrealm depth, +5 per landmark stage, +0.2 per prestige point, -1 per 100 dwarves
  below the population peak of the current cycle every step (drawdown), -2,000 on extinction (T5, E46:
  until then -20 and no drawdown, which made the reward the area under the population curve).
- Recipe `v2-base` (`ai.training.recipe`, section 7), run by `scripts/train_recipe.js` and the lean
  deterministic trainer `python/trainer_v2.py`: 9 heads (4 job weights, 5 levers), decisions every
  10 ticks, gamma 0.999, foundation 1,920 episodes of 2,800 ticks (half from a 2,000-40,000-tick
  snapshot bank), finetune 50 episodes, 7 workers, ~35 min of foundation on an M4 Pro (E42). The old
  stack (`train.py`, wrapper profiles, continuous training, regression harness, v1 heads and the
  per-resource observation layout) was deleted in T4.
- Promotion gate (`scripts/scorecard.js --promote`, settings in `ai.evaluation`, T3): 24 eval-plan
  games x 8,000 ticks, `rpp` score (reward per planned tick, so an early extinction scores zero for
  the ticks it did not live), paired delta >= 0.005 with lower confidence bound (z 1.96) > 0, and on
  32 standard games x 20,000 ticks no guard metric worse beyond one SE: `rpp` and final population
  (upper bound >= 0), extinctions and avoidable deaths (lower bound <= 0) (T5, E45); the incumbent is
  the best v2 policy, or the council while `models/` holds none.
- `models/` was empty from T4 (the v1 policies were trained on the old, easy game and no longer
  load) until T5 promoted the first v2 policy, E48 r3 (2026-11-27), so `npm run ai:play` runs again.

### 2.4 Measurement tooling (`experiments/`, outputs in git-ignored `experiments/runs/`)

| Tool | Purpose | Cost |
|---|---|---|
| `challenge_probe.js` | In-process scorecard: synthetic players (`default`, `const:X`, `random`, `neglect`, `gov:X`) and trained ones (`policy:<file>`, the game's JS inference), stock flows, reserve autonomy, labor mix, deaths, outcome-reward score, progress (max Underrealm depth, landmark stages, prestige); `--set path=value` A/B on the effective config; `--plan eval` or `standard` | 48 games x 8,000 ticks in ~3 min |
| `scripts/scorecard.js` | The single evaluator (T3): a policy at its own cadence and the council on the `ai.evaluation` horizons through `challenge_probe.js`, paired population and `rpp`, results cached per game version in `.cache/scorecard/`; `--gate`/`--promote` | 24 x 8,000 + 32 x 20,000 ticks per new player |
| `replicates.js` | Replicated recipe runs (training, scorecard, lever readout, pooled paired summary), resumable | ~45 min training + ~8 min scorecard per replicate |
| `pairing_probe.py` | Variance of lever-effect estimates from bank snapshots (E40) | ~30 min |
| `sensitivity_screen.js` | One-at-a-time +/-25% screen of `CORE_KEYS` (E28) | ~1-2 h |

`eval_paired.py`, `exp_run.js`, `leverage_probe.py` and `analyze.py` served the v1 stack and were
deleted in T4; earlier evidence rows that cite them stay as recorded.

Bit-identity checks (E17-E19, E43): `challenge_probe.js` reproduced `eval_paired.py` for default,
constant and council players and the cached benchmark rows for the standard game.

---

## 3. Evidence

Paired by seed. "Pop" = final population; "avoidable" = deaths excluding old age.

| ID | Date | Finding | Numbers | Consequence |
|---|---|---|---|---|
| E1 | 11-23 | JS simulation dominates training time | env ~95% of time; bit-identical optimizations 35.8 -> 128.6 ticks/s | Optimize JS, not PPO hardware |
| E2 | 11-23 | Worker scaling saturates at ~7 on M4 Pro | 1: 246, 4: 875, 6: 1,148, 8: 1,230, 10: 1,276 steps/s | 7 workers; 12 gave no speed-up (E16) |
| E3 | 11-23 | Old gate noise | per-episode SD 0.23; +0.06-0.08 needed to promote | Larger, longer evals |
| E5 | 11-23 | 20,000-tick endgame phase: 60% of time, no gain | long horizon -0.040 (z -1.61) | Removed from `m4-pro` |
| E7 | 11-23 | Gains scale with foundation length (old game) | 160/320/640 eps: +0.005/+0.031/+0.059 | Foundation 640 |
| E8-E9 | 11-23 | Lower entropy, more epochs: no gain | z -0.98, z -0.12 | Not adopted |
| E10 | 11-23 | Short-horizon training erodes long-horizon play | -0.024 (z -1.4) at 20k ticks | Horizon mismatch is real |
| E13 | 11-24 | M4 PPO knee at 7 workers | 192 eps: 4w 170 s, 7w 143 s | `m4` profile |
| E14 | 11-24 | Old policy vs no-AI game | 3.6k ticks: tie; 20k: pop 565 vs 450 | Short gate cannot see quality |
| E15 | 11-24 | Trivial policies matched the trained one | const 0 beat it; reward vs pop r = 0.52; weight 0 became 1 | Action space and reward redesign |
| E16 | 11-24 | Per-group leverage | leverage: jobs, ruins, Underrealm, external camps (via deep raids), trade (harmful); none: festival, building, contracts, warriors; 5 intents identical to default at value 2 | Prune and discretize heads (S4) |
| E17 | 11-24 | Old game could not be lost | 0 extinctions, 0 starvation for every player; neglect -5% pop; beer 0.028 vs water 0.0005 per dwarf-tick; idle 21-37% | Tighten economy |
| E18 | 11-24 | Tight economy applied | 12 games: default 70, gov:0 96, random 89, neglect 23 (7 ext.), const 0 1 (11 ext.); yields were rounded to >= 1 unit (bug); stronger raids rejected (tax without counterplay); node regen inert (terrain tiles) | Current game |
| E19 | 11-24 | Outcome reward + 8k `rpp` gate | reward vs pop r = 0.89, 93% pairs ranked like pop; table below | Training learns again |
| E20 | 11-25 | Train/serve skew: the game fed policies different inputs than training | `nodeScarcity` (4 of 79 inputs) was ~0.85-0.98 in training (terrain tiles counted) and always 0 in game inference; first decisions differed across governor thresholds; JS vs Python on 24 games: replicate 2 84.0 vs 71.5 (z ~-2), replicate ranking reversed | Shared `getObservationNodeRatio`; after the fix first decisions match to 1e-7 and JS/Python means agree within one SE (+1.0, -7.3, +1.8) |
| E22 | 11-25 | The emergency reflex is a poverty trap and the only growth brake | eval plan 24 games: emergency off -> default 57 -> 94 (z 5.6), gov:0 96 -> 124; standard game 20k ticks, 8 seeds, emergency at 0.15: default and gov:0 4/8 extinctions (boom to 200-370 dwarves by 6k ticks, empty larder, famine, aging collapse); water x3 boost off rescues neglect (crowds out food) | Keep `emergencyMinRatio` 0.52 until a growth lever exists (S3/S4a) |
| E23 | 11-25 | Steward: a fixed "hold every venture back" posture beats state-aware variants | eval 24 games: 96.4 (gov:0 96.0, default 57.0), avoidable 10.0, 0 extinctions; standard 8 seeds: 8k 201 (gov:0 182, default 116), 20k 128 (default 69, gov:0 73, 2/8 extinctions vs 1 and 2); opening ventures when reserves >= 3 per dwarf: 87.8 eval, 101 at 20k | Steward on by default with all governor groups restrained; the difference with gov:0 is the social group, which gov:0 leaves on defaults |
| E24 | 11-25 | Config read trace: few keys are dead, much content is unreachable | proxy trace over `npm test`, 120 eval games (5 players incl. a trained policy), 20k-tick games, eval server and a mini training: of 4,326 values 3,959 read; dead (no code path): the whole `population.relationships.socialDrama` block (53 values, an old duplicate of `population.socialDrama`), armory `equipment_tier_max` (10), 3 house storage keys, 1 ritual context key, external-camp influence/outline symbols and colors (6); deleted, games bit-identical. Never triggered in 120 games: festivals, alchemy formulas (78 values), traveling bards, ruin set/combo bonuses, forge/armory upgrades | Dead keys removed; unreachable content listed for S3 |
| E25 | 11-25 | System ablation (R1, 24 games, steward) | economic (|z| >= 2): raids (off: +21.6 pop, -7.9 avoidable deaths), landmarks, Underrealm and ruins (progress -75, -31, -18); narrative drags (off: +10 to +13 pop, z 1.3-1.9): schism, social drama, wildlife; schism, social drama, warriors and temple each write 14-17% of events; no effect within 8,000 ticks: endgame, festivals, prestige, villages, world legacy | Systems labelled; festivals are dead content |
| E26 | 11-25 | Job weights had leverage only through the water boost | water priority boost applied on top of policy weights; with boosts limited to default weights (R4) neglect 59.5 -> 94.2 (z 3.5), default unchanged (24/24 identical) | Job weights are a weak AI lever (S4a); bad-play reference becomes "everything on" (gov:2) |
| E27 | 11-25 | The AI was trained and evaluated on other economies than the game | training and eval overrides restated needs, consumption, stocks, targets, 60 explicit food nodes (game: terrain), reproduction (soft cap 32/48 vs 620, birth chance x3.6), structure caps, expedition rules and 20 founders; removed (R5). Scorecard v2 on the game economy, 24 games x 8,000 ticks: steward 181.8, gov:0 181.8 (identical), everything on 93.2 (-49%, 1 extinction, 23 starvation), random 114.2 (-37%), neglect 163.4 (-10%, z -0.6) | All earlier eval-plan numbers (S0-S2) describe the old eval economy |
| E28 | 11-25 | Sensitivity screen (R6): water is the binding constraint, 18 of 50 core keys move outcomes | steward, eval plan, 24 games x 8,000 ticks, each key at -25% and +25% (paired high minus low; baseline pop 181.8); strongest (|z| >= 3): thirst decay (pop -157, progress -35), thirst threshold (pop +97, avoidable +37), water yield (pop +102, progress +24), hunger decay (pop -70), old-age start (+50) and max age (+38), housing build target (pop -61, progress -18), birth food reserve ratio (progress +9); marginal (2 <= |z| < 3): base birth chance (progress -14), food yield, food gather ticks, food trigger ratio, raw food relief, water relief, hunger threshold, birth water per dwarf, emergency ratio (progress -12), raid chance max (avoidable +22); inert (exactly 0): raid chance/death minimums (eval runs at difficulty 1) and the steward reserve (no cautious group); no measurable effect: beer, brewery, winter/autumn modifiers, stock targets and starting stocks, founders, wood/stone, roles, soft cap; ~7 of 150 tests are expected above |z| 2 by chance, so marginal single-metric keys are provisional | `CORE_KEYS` = the 18 sensitive keys, the other 32 move to `FROZEN_KEYS`; S3 starts from the water economy, lifespan and housing labor |
| E29 | 11-25 | S3-0: colonies collapse from one synchronized generation, not famine; a growth cap fixes it | standard game, steward, 20,000 ticks, 16 seeds: 4,455 of ~5,000 deaths are old age; a boom (14 -> 290 dwarves in ~3,000 ticks) fills the water limit, births stop for ~5,000 ticks and the cohort dies together at 8,000-12,000 ticks (3/16 extinctions, median drawdown 51%). Emergency reflex 0.15 alone: 3/8 vs 2/8 extinctions, avoidable deaths +82 (z 2.5). Birth budget at 25% a year: 0/16 extinctions, pop +74 (z 2.2), avoidable -47 (z -5.5), but -37% pop on the 8,000-tick eval (z -3.0); 35%, 50% and 100% a year do not help. Adopted: 25% a year with a floor of 20 births a year and emergency 0.15: eval 24 games pop 173 vs 182 (z -0.5), avoidable 12 vs 27 (z -4.5), progress 116 vs 77 (z 4.6); standard 20k 1/16 extinctions, pop 175 vs 114 (z 2.1), progress 180 vs 138 (z 3.1); floor 30: 2/16, pop 134 | `population.reproduction.growthCap` on (0.25, floor 20), `emergencyMinRatio` 0.15; the cap without floor (20k pop 209) is headroom for the S4 growth lever |
| E30 | 11-25 | S3-0 at long horizon, S3a and S3b: the cap delays the water wall, it does not remove it | 16 harsher seeds at 20,000 ticks: old config 7/16 extinctions, adopted cap 6/16 (pop +43, progress +39, z 3.5), cap without floor 3/16; pooled 32 seeds: 10, 7 and 3 extinctions. 40,000 ticks (16 seeds): floor 20 6/16, no floor 5/16, both with lifespan jitter 0.15 4/16 and 5/16, starvation 440-680 deaths per run. Mechanism (seed 1717 trace): the colony overuses its water tiles, the stock stays below `minStockpileRatio` for ~4,000 ticks, births are blocked longer than the fertile window (101 fertile adults -> 0) and the colony ages out with stocks recovered. S3a: per-dwarf lifespan jitter 0.15 (new `population.aging.lifespanJitter`) 20k extinctions 7 -> 3 of 32 (discordant 6 vs 2, p ~0.3), 40k 5 vs 3, eval pop -8 (z -0.9); jitter 0.3 and founder ages up to 2,500 ticks: no effect. S3b: median Underrealm depth at 8,000 ticks 2 (eval), 5 at 20,000 (pass >= 1 already met); landmark stages hit the maximum (15) in 46 of 48 games | Jitter and founder spread not adopted (below z 2; jitter stays available at 0 for S3d); the long-run water trap is the decision the S4 growth lever must learn, with S5 snapshot starts; landmark stages no longer separate good from bad play (reward term `landmarkStage` is nearly constant) |
| E31 | 11-25 | S3c guards and S3d world variety | S3c: Underrealm guard share 0.01 -> 0.25: deep-raid deaths 24.5 -> 9.0 per 20,000-tick game (z -3.6), 0.7 -> 0.2 on the eval plan (z -2.5), progress -34 (z -4.3): a real defense trade-off, already exposed as `guardMixBias` but restrained by the council. S3d: world profile drawn from the map seed (`src/simulation/world_profile.js`, `variety.ranges`), entering the ledger as `world`; off = bit-identical. On the 8,000-tick eval variety does not change which posture wins (steward beats gov:1/gov:2 in 71-79% of games with narrow or wide ranges; growth 50% a year beats 25% in 20-21 of 24 games because its cost lands later). At 20,000 ticks (16 seeds) no growth rate dominates: best per game 15%/25%/50% = 2/6/8, 25% vs 50% wins 50%; with wide variety 50% a year falls to pop 99 and 4/16 extinctions (188 and 3/16 without) | Wide variety on by default (food 0.7-1.3, water 0.8-1.2, winter 0.5-1.5, needs 0.9-1.1, raids 0.25-1.75); guards and growth rate are S4 lever candidates whose best setting depends on the game only at long horizon |
| E32 | 11-25 | Scorecard v3 (S3 defaults: growth cap, emergency 0.15, wide variety) | eval 24 games x 8,000 ticks: steward 166.1 (avoidable 13.5, progress 112, 0 extinctions, drawdown 4-8k median 3%), gov:0 identical, everything on 147.4 (-11%, z -2.1), random 151.2 (-9%), neglect 166.0 (=); standard game 32 seeds x 20,000 ticks: steward 169.6 with 4/32 extinctions, everything on 101.8 (-40%, z -3.0, 2/32), neglect 165.2 (3/32, avoidable +19); median Underrealm depth at 8,000 ticks 2 | S3 pass: drawdown, 8k extinctions, depth and defense lever met; 20k extinctions 4/32 (target 3/48) and neglect gap (E26) not met. The growth cap also slows weak players, so skill now shows mainly at 20,000 ticks: S5 must add a 20k check to the gate |
| E33 | 11-26 | S4a lever audit: horizon-dependent levers and two council inefficiencies | council, 24 eval games x 8,000 ticks and 16 standard games x 20,000, each candidate low/high vs scorecard v3 (paired z; best/game = share of games won by the most frequent setting): growth 50%/yr +39 pop at 8k (z 2.5) but -86 at 20k (z -2.1, avoidable +42, 4 extinctions), best/game 88% at 8k vs 50% at 20k; ventures open (ruins, Underrealm, camps) avoidable +68 (z 3.9) and progress +38 (z 5.0) at 20k, best/game 56-58%; reserves 1.8x target +24 at 8k (z 2.8), best/game 62%; builders 0.10 avoidable +6 (z 3.0) and progress +12 (z 2.2) at 8k, best/game 42-44%; Underrealm share 0.45 -17 pop at 8k (z -2.1), 0.10 progress -16 at 20k (z -2.9), best/game 50-62%; guard share and merchant reserve: no outcome |z| >= 2. Housing target 1.2 (vs 1.7) +122 at 20k (z 4.5, best in 14/16) and later meals (thresholds +40%) +38 at 8k (z 4.2), +97 at 20k (best in 19/24 and 14/16): council inefficiencies, not levers. Both as defaults: council 202 vs 166 at 8k (z 4.0), 352 vs 185 at 20k (z 5.5), 0/16 extinctions; everything-on -87 at 20k (z -3.6) with avoidable +52 and progress +49 | Levers for S4b: growth rate, reserves, builders, Underrealm share, ventures (risk). Housing target and meal thresholds stay at the v3 values and stay out of the AI's reach: adopting them made the council colony nearly immortal (0/16 extinctions at 20k), and the game must stay a challenge (decision 2026-11-26). Open: eating later is free (no morale or work cost); a real cost would turn rationing into a lever |
| E34 | 11-26 | S4b-S4f built; cadence sweep (one replicate each, 640 episodes, half the episodes from snapshots, gamma for a ~10,000-tick horizon) | action space v2: 9 heads (4 job weights + growth, reserves, builders, Underrealm share, ventures) instead of 33; 7 strategic inputs (age shares, births last year, growth budget, food/water autonomy); snapshot bank of 368 states (48 council games, 2,000-16,000 ticks, 156 MB); training 12-14 min per 640 episodes. vs council, eval 24 x 8,000: every 10 ticks +21 pop (z 2.1), 20 ticks +9, 40 ticks +12 (z 1.8); standard 16 x 20,000: -15, -9, -21 (all n.s.), avoidable +16, +27 (z 2.0), +1; extinctions 0, 1, 1 (council 2). Levers stay near the council midpoint (0.3-0.75) after 640 episodes: growth and reserves slightly up, Underrealm share low early and higher late | Cadence 10 ticks (gamma 0.999); 3 replicates of 1,920 episodes; dual-horizon gate in `promote_best.py` (`canonical.longHorizon`: 16 games x 20,000 ticks, block if paired mean + 1 SE < 0) |
| E35 | 11-26 | S4 verdict: the v2 stack works, the trained policies do not beat the council at 20,000 ticks | 2 of 3 planned replicates (cadence 10, gamma 0.999, 1,920 episodes, half from snapshots; replicate 3 stopped): eval 24 x 8,000 vs council 166: r1 190 (+14%, z 1.95), r2 156 (-6%, z -1.3); standard 32 x 20,000 vs council 170 (4/32 extinctions): r1 137 (z -1.4, 1/32, median drawdown 54% vs 34%), r2 150 (z -0.7, avoidable +23 z 2.1, 4/32). Training diagnostics: critic explained variance 0 -> 0.93 (the value side learns), but policy entropy rose 5.57 -> 5.90 in both runs: with entropy coefficient 0.008 ramped over 15,000 episodes the exploration bonus outweighs the weak per-decision advantage of 9 strategic heads, so lever means stay near the council midpoint (0.3-0.75) and runs diverge | S4 pass not met (needs +10% at 20,000 with z >= 2 over 3 replicates). Kept: action space v2, strategic inputs, snapshot bank, dual-horizon gate, cadence 10. Next: fix the entropy schedule for v2 (ramp within the run, lower final coefficient), then longer runs, before S5 |
| E36 | 11-26 | S4 fix screen: the entropy schedule is not what keeps v2 levers at the midpoint | E35 recipe rebuilt (cadence 10, gamma 0.999, 280 steps = 2,800 ticks per foundation episode, 50% starts from a fresh 368-state council bank), 320 foundation episodes, 1 replicate each: old schedule (0.008, ramp 15,000) entropy 5.569 -> 5.609, ramp within the run 0.008 -> 0 flat (5.568 -> 5.566), 0.002 -> 0 falling (5.563 -> 5.534); per-head log std -0.79 to -0.81 in all three (init -0.80), mean reward 427/428/434. One run makes ~1,500-2,000 Adam steps at lr <= 2.5e-4, so log std can move at most ~0.3-0.4 whatever the schedule (E35 moved +0.04 per head): exploration noise is set by `logStdInit`. Likely bottleneck: noise is drawn independently every 10 ticks while levers act over years, so one decision's effect is lost in game variance. Training speed 30-41 episodes/min (1,920 episodes ~50-65 min) | Entropy schedule unchanged (a 3+3 replicate test would cost ~7 h for an expected null); next step is temporally correlated exploration (S5) |
| E37 | 11-26 | T1: the old trainer is not deterministic | `scripts/train_recipe.js` driving the old `train.py`, default recipe with the E36 bank: two 16 + 8-episode runs gave identical weights, but two 64-episode runs did not. Workers pick up new weights whenever they arrive (an episode plays whichever version is in the queue when it starts) and the adaptive scenario sampler reweights scenarios at timing-dependent moments | Every earlier training replicate mixed seed variance with timing variance; determinism becomes a T2 requirement of the new trainer |
| E38 | 11-26 | T2: the lean v2 trainer matches the old numerics, the game's inference and itself | `python/trainer_v2.py` + `python/v2/` (~700 lines instead of `train.py`'s 5,200): GAE, running statistics, PopArt return rescaling and two full PPO updates bit-identical to the old functions; a saved policy gives the same outputs in the JS game inference (max difference 4-9e-8 on real states); two 64-episode runs give identical weights. Integration vs the E36 control (old trainer), same settings (stable termination on, E36 bank, 320 foundation episodes, 1 replicate each): mean reward per window 370/351 (episodes 1-160/161-320) vs 353/362, entropy +0.024 vs +0.040 under the same schedule, critic explained variance 0.60 vs 0.17 over episodes 161-320, wall clock 600 s vs 526 s. Found on the way: fresh episodes start at tick 300-800 (random season start) but `ai.maxTicks` counted from tick 0, so they were cut short (old recipe headroom hid it); the limit now counts ticks played in the episode | Lean trainer adopted for v2 runs (`scripts/train_recipe.js`); the gate's 8,200-tick canonical config is affected by the tick-limit fix and is rebuilt in T3; `policyLagBatches` (1) is the knob if throughput matters |
| E39 | 11-26 | Simulation hot spots removed, bit-identical | Profile of a 510-dwarf state (11.3 ms/tick): path fields 23% (gather jobs share one cache key but send each dwarf to its own cell, so the same BFS ran up to 260 times per tick), housing 12% plus couple lookups 10% (O(n^2) partner `find` and slot scans), Underrealm crew scoring 14% (every pick rescored the whole pool); narrative systems together ~5%. Fixes: pure memo of BFS fields per walkability grid (`movement.js`), id index and monotone slot cursors (`population.js`), score-once stable selection (`underrealm.js`). Checks: full state and RNG stream identical on 61 bank snapshots x 300 ticks and a fresh 3,000-tick game, `scripts/sim_fingerprint.js` identical to the previous commit (4 seeds x 1,000/4,000/8,000 ticks), headless benchmark reports identical, a 64-episode training run gives the same weights. Speed: heavy state 11.3 -> 5.4 ms/tick, snapshot set 1.86x, standard benchmark 67 -> 46 s, short training run 148 -> 127 s (colonies of 80-150 dwarves gain least). The profile is now flat (top function 6%) | `scripts/sim_fingerprint.js` becomes the gate for every performance change; found on the way: `assignHousing` lists every couple twice (from both partners), wasting house slots; kept for identity, a candidate game fix |
| E40 | 11-26 | Paired branches do not reduce variance; trainer-scale lever noise is invisible in an episode | `experiments/pairing_probe.py`: 48 bank snapshots, 2,800 ticks, four rollouts each (antithetic lever noise +e/-e, two game seeds), job weights neutral. Seasonal noise at the trainer's sigma (0.45 pre-tanh, held 20 decisions): Var(return difference) paired 34.1k, unpaired 35.2k, game noise alone (same noise, other seed) 41.7k; efficiency multiplier 1.03 and no lever effect above game noise. Strong noise (sigma 1.5 held all episode): paired 58.5k, unpaired 58.7k, game noise 44.7k, multiplier 1.00; lever effect variance ~14k (SD ~117 on mean return 595, about 0.55 of the game-noise SD per pair). The game draws everything from one `Math.random` stream, so a single different choice shifts every later draw and a shared seed gives no common randomness | Paired branches dropped. The S4 failure has a measured cause: with the exploration the trainer uses, a lever choice does not change an episode's return detectably, so the lever gradient is mostly noise. Options: persistent, larger lever exploration (episode-level hold, wider sigma), per-system RNG streams (would make pairing and paired evaluation effective, a game-identity change), or a black-box optimizer for the 5 levers |
| E41 | 11-26 | Persistent wide lever exploration makes the levers learn; the learned levers pay at 8,000 ticks, not at 20,000 | One replicate each, lean trainer, E36 bank (2,000-16,000 ticks), 960 foundation + 50 finetune episodes; control = default recipe (lever noise redrawn every decision, sigma 0.45), persistent = noise held all episode (`leverNoiseHold` 280) and lever sigma 1.0 (`leverLogStdInit` 0). Deterministic lever choice on 62 bank states (u, 0.5 = council): control growth 0.58, reserves 0.56, builders 0.47, Underrealm share 0.56, ventures 0.52 (spread 0.08-0.13); persistent 0.76, 0.60, 0.75, 0.34, 0.38 (spread 0.16-0.34, state-dependent). vs council, eval 24 x 8,000: control 175.7 vs 166.1 (+9.5, z 1.0, 13/24), persistent 221.3 (+55.2, +33%, z 3.7, 18/24), avoidable 17.3 vs 14.8 both, 0 extinctions. Standard 16 x 20,000: council 185.3 (2 extinctions, avoidable 47), control 161.1 (-24, z -0.7, 2 ext.), persistent 180.8 (-4, z -0.1, 4 ext., avoidable 76). PPO KL higher with held noise (0.007-0.018, no early stops); foundation 1,176 s vs 1,309 s | First trained policy whose levers move and react to the state. The levers it learned (high growth and builders, fewer ventures) are the E33 short-horizon optimum, so the next lever on quality is the horizon: the 40,000-tick bank and stable termination off of the default recipe, then 3 replicates before adoption |
| E42 | 11-26 | Persistent wide lever exploration on the default recipe: large, replicable gain at 8,000 ticks, worse at 20,000 | `experiments/replicates.js` (session `2026-11-27_e42`, a797a67, game identical to e77e8f7), 3 replicates, default recipe (1,920 foundation + 50 finetune episodes, 40,000-tick bank of 753 council snapshots, stable termination off) with `leverNoiseHold` 280 and `leverLogStdInit` 0, scored by `scripts/scorecard.js` vs the council. 8k (24 games, council 166.1, avoidable 13.5, 0 ext.): replicates 268.5 / 210.2 / 256.5 (+102 z 4.1, +44 z 2.2, +90 z 3.4); pooled 245.1, +78.9 (SE 19.2, z 4.1, 20/24), replicate SD 30.8; avoidable 15.3 / 19.2 / 37.7 (mean 24.0); 0 extinctions. 20k (32 standard games, council 169.6, 4 ext., avoidable 43.8): 132.2 / 124.8 / 167.8 (-37 z -1.0, -45 z -1.6, -2 z -0.1); pooled 141.6, -28.0 (SE 25.4, z -1.1, 14/32), replicate SD 23.0; extinctions 9 / 6 / 7 (22 of 96 = 23% vs 12.5%); avoidable 61.8 / 52.7 / 67.2 (mean 60.6). `rpp` vs council at 20k +0.019 / -0.011 / +0.008: two of three replicates would pass today's gate (8k `rpp` LCB > 0, 20k guard) while doubling extinctions. Levers (u on 60 bank states, 0.5 = council): growth 0.83 / 0.69 / 0.81, reserves 0.78 / 0.49 / 0.56, builders 0.58 / 0.45 / 0.30, Underrealm share 0.21 / 0.22 / 0.22, ventures 0.23 / 0.46 / 0.46 (state SD 0.16-0.34). Foundation 2,007-2,126 s per replicate on an M4 Pro (critic EV 0.96-0.98); whole session 3 h 22 min including the bank | Not adopted as the recipe default: 20,000 ticks is worse (population z -1.1, extinctions and avoidable deaths up well beyond one SE). The 40,000-tick bank and gamma 0.999 did not teach the long horizon: every replicate learned high growth and a small Underrealm share, the E33 short-horizon optimum. Persistent exploration stays the way levers learn at all (E41); the horizon is the open problem, and the gate must see extinctions before T5 promotes anything |
| E43 | 11-26 | T3: one in-process evaluator reproduces the old ones and is faster | `scripts/scorecard.js` on the E41 persistent-exploration policy. Council at 8,000 ticks: the same 24 games as `eval_paired.py` give the same final population game by game (166.1, 24/24 identical); council 24 x 8,000 ticks in 75 s (`eval_paired.py` ~3 min), 32 x 20,000 standard ticks in 413 s. Policy at 8,000 ticks: 243.3 vs 221.3 through `ai_server` + Python inference, per-game difference +22.0 (SE 16.1, z 1.4), chaotic both ways (-113 to +212): float32 Python vs float64 JS inference, not a bias. Full scorecard vs council: 8k pop +77.1 (z 4.8, 20/24), `rpp` +0.0096 (z 1.4); 20k (32 games) pop +17.9 (z 0.5), `rpp` +0.029 (z 2.8), extinctions 8 vs 4, avoidable 63.5 vs 43.8. The gate would refuse it vs the council (8k `rpp` lower bound < 0) while population is far ahead, and its 20k `rpp` guard does not see the doubled extinctions | Scorecard adopted as the only evaluator and gate for v2 policies; `rpp` vs population/extinctions disagreement left as a gate-metric question for T5 |
| E44 | 11-26 | T4: deleting the old stack changes no game, training run or evaluation | Removed `train.py`, `train_wrapper.js`, `train_continuous.js`, `regression.js`, `regression_rollout.py`, `promote_best.py`, `validate_extended_optimized.js`, the CI workflow and its artifact assembler, `eval_paired.py`, `exp_run.js`, `leverage_probe.py`, `analyze.py`, the v1 models and regression baselines; v1 heads (festival, `gov_*`), the per-resource layout, stable termination and `leverRaw` decoding left `ai_server.js` and `src/ai/policy.js`, which now refuse v1 policies. ~14,300 lines of code removed (models and baselines aside). `ai.training` 772 -> 185 values (80 are the feature list); the 19-scenario catalog (455 values) moved to a top-level `scenarios` section, the eval plan names to `ai.evaluation.scenarios`. Checks against the pre-T4 tree (a797a67): `sim_fingerprint.js` identical (4 seeds x 1,000/4,000/8,000 ticks); a 16 + 8-episode recipe run on the E42 bank gives identical weights; scorecard outcomes of the E42 r1 policy identical game by game on both horizons (smoke size); `npm test` green | Old stack gone; tests that used the v1 model now use a seeded v2 fixture (`scripts/test_policy_fixture.js`); the bank and scorecard caches rebuild once because the config hash changed |
| E45 | 11-26 | T5 gate: a 20k `rpp` guard alone promotes policies that double extinctions; the section 6 guards refuse them | Replay on the cached E42 scorecards (no games played), candidate minus council, bounds at 1 SE on 32 standard games x 20,000 ticks. Old gate (8k `rpp` LCB z 1.96 > 0, 20k `rpp` upper bound >= 0): r1 PASS, r2 FAIL (8k LCB -0.0004), r3 PASS. New 20k guards: r1 `rpp` +0.033 ok, population upper bound -1.0 FAIL, extinctions lower bound +0.055 FAIL (9 vs 4), avoidable +5.1 FAIL; r2 `rpp` -0.0009 FAIL, population -16.0 FAIL, extinctions -0.027 ok, avoidable +1.4 FAIL; r3 `rpp` +0.022 ok, population +28.7 ok, extinctions 0.000 ok (7 vs 4: 32 games cannot see it), avoidable +13.8 FAIL (+23.4, SE 9.6). All three refused. An avoidable-death guard at 8k would refuse even r1 (+1.7, SE 1.5): there deaths grow with a much larger colony, so the avoidable guard stays on the 20k horizon. 8k primary stays `rpp` (E43's population-vs-`rpp` disagreement left as is: the 20k guards now catch the long-horizon damage that a population primary would let through) | Gate = 8k `rpp` LCB > 0 with minImprove 0.005, plus 20k guards `rpp`, population, extinctions, avoidable deaths at guardZ 1 (`ai.evaluation.gate.guards`); bounds rounded to 1e-9 so an exact zero is not worse |
| E46 | 11-26 | T5 long horizon: the reward itself prefers boom-and-bust; extinction and drawdown terms realign it | 20k replay, council vs E42 r1 (32 standard games): `rpp` +0.019 for r1 comes from the population term (+0.031 per tick, SE 0.012; area under the population curve), offset by progress -0.007, reserves -0.003, avoidable deaths -0.002, extinction -0.0002 (a -20 extinction costs about one decision of a 170-dwarf colony). Mean population every 2,000 ticks: council 42 89 147 187 193 168 153 148 162 170 (4 ext.), r1 40 106 220 296 302 239 168 126 130 132 (9 ext., all at 13,000-19,000 ticks: the boom cohort ages out, life is at most 7,600 ticks); r1 beats the council on population area in 20/32 games and on final population in 10/32. Offline screen (`experiments/reward_screen.js`, session `2026-11-27_t5_reward`): 7 players (council 170 / 4 ext., `gov:2` 102 / 2, `random` 71 / 9, `neglect` 165 / 3, E42 r1-r3 132 / 9, 125 / 6, 168 / 7) x 32 games x 20,000 ticks, per-decision signals; share of same-seed player pairs where the candidate's return agrees in sign with final population at 20k (0 if extinct), undiscounted / discounted with gamma 0.999 from tick 0 / 8k-check; council-minus-policy z for r1, r2, r3. Today's reward 0.749 / 0.652 / 0.824, z -1.28 +1.08 -0.58 (prefers r1 and r3). Extinction 2,000: 0.793 / 0.712 / 0.824, z -0.15 +1.10 +0.06; extinction 5,000: 0.793 / 0.740 / 0.824, z +0.56 +0.97 +0.48. Drawdown (k x (cycle peak - population) / 100 per decision) 1: 0.763 / 0.692 / 0.833; drawdown 1 + extinction 2,000: 0.807 / 0.745 / 0.833, z +0.98 +1.16 +1.30; drawdown 1 + extinction 5,000: 0.807 / 0.766 / 0.833, z +1.25 +1.04 +1.28; population in remaining lifetime (x2) + drawdown 1 + extinction 2,000: 0.817 / 0.743 / 0.866, Kendall tau of player means 0.81 (today 0.52). Lifetime-weighted population alone (0.766 / 0.659) and sqrt population (8k agreement falls to 0.745) do not fix the ranking | The long-horizon failure is a reward misalignment, not only a credit-assignment horizon: the outcome reward is area under the population curve. A heavy extinction penalty plus a drawdown term makes the council beat every E42 replicate and raises agreement from tick 0 by ~0.09-0.11 without losing the 8k ranking; the drawdown term needs the cycle peak (or population/peak) in the observation to stay Markov, which a fresh training cycle allows |
| E47 | 11-27 | T5 long horizon: with the drawdown + extinction reward, persistent lever exploration wins at 20k too; 2 of 3 replicates pass the gate | `experiments/replicates.js`, session `2026-11-27_e47` (HEAD 5c5320a + reward/observation diff), recipe with `leverNoiseHold` 280, `leverLogStdInit` 0, reward drawdown 1 + extinction 2,000, observation +`populationToPeak` (87 inputs, fresh), bank rebuilt (753 snapshots); 3 replicates vs council, same scorecard games as E42. 8k (24 games): council pop 166; replicates 207 / 250 / 301, pooled +86.5 (SE 15.6, z 5.5, 21/24), no extinctions, avoidable 13.3 / 18.5 / 18.9 vs 13.5. 20k (32 games): council pop 170, 4 ext., avoidable 43.8; replicates 218 / 202 / 218, pooled +43.1 (SE 26.3, z 1.6, 20/32, replicate SD 9.2), extinctions 3 / 7 / 4, avoidable 46.1 / 39.6 / 38.5. E42 at 20k on the same games: 132 / 125 / 168, pooled -28.0, extinctions 9 / 6 / 7, avoidable 61.8 / 52.7 / 67.2. Gate (new reward): r1 FAIL (8k `rpp` +0.0008, LCB -0.010; 20k guards ok), r2 PASS (8k LCB +0.004; 20k extinctions +0.094, SE 0.094, bound exactly 0), r3 PASS (8k LCB +0.021, `rpp` z 4.0; 20k population +48.4, extinctions 0.000, avoidable -5.2). Levers (mean over play): growth 0.87 / 0.79 / 0.73 (E42 0.83 / 0.69 / 0.81), reserves 0.36 / 0.51 / 0.76, builders 0.60 / 0.49 / 0.55, deep 0.15 / 0.15 / 0.11, ventures 0.17 / 0.49 / 0.23. Training stable in r2 and r3 (KL <= 0.06); r1 drifted from episode 1,320 (KL 0.06-0.37 every window to the end, clip fraction up to 0.37; E42 max 0.07) and is the replicate that fails the 8k gate | The reward was the long-horizon problem: the same recipe that lost 28 dwarves at 20k under the old reward gains 43 with fewer avoidable deaths. The extinction gap is closed only partly (14/96 vs 12/96 for the council), and r2 passes the extinction guard on its bound. Growth stays high; what changed is reserves and the bust after the boom. One replicate in three runs away in KL late in foundation; E48 traces it to a log-probability bug, not to the learning rate |
| E48 | 11-27 | T5: the late KL drift was a log-probability bug; with it fixed training is stable, 8k unchanged, 20k gain smaller | Zero-update check (scratch probe, final policies of E47, 16 late-foundation episodes each, real rollouts, weights unchanged): KL r1 0.286, r2 0.0045, r3 0.0009; share of decisions with the deep lever at |tanh| > 0.999: 27% / 4.5% / 2.6%. Cause: `log_prob_of` rebuilt the pre-tanh sample from the stored squashed action clamped to +/-0.999, so a sample at pre-tanh -8 was read as -3.8 (log-ratio down to -8.8). Fix: rollouts store the exact pre-tanh sample and the PPO ratio uses it (`python/v2/model.py`, `ppo.py`, `rollout.py`, `trainer_v2.py`; zero-update ratio exactly 1 in `python/test_trainer_v2.py`; two 64-episode runs give identical weights; `npm test` green). E48 = E47 recipe and reward with the fix, session `2026-11-27_e48`, same bank and scorecard games. Training: max window KL 0.024 / 0.022 / 0.025, no window above 0.05, no early stops (E47 r1: 16 windows above 0.05, max 0.37). 8k (24 games): replicates 217 / 232 / 290, pooled +80.3 vs council (SE 14.8, z 5.4, 23/24), no extinctions, avoidable 10.5 / 14.8 / 21.7 vs 13.5; `rpp` vs council +0.007 / +0.010 / +0.031. 20k (32 games): replicates 177 / 167 / 203, pooled +12.6 (SE 22.7, z 0.55, 19/32, replicate SD 18.7), extinctions 4 / 5 / 4 vs 4, avoidable 41.1 / 37.8 / 35.1 vs 43.8. Gate: r1 FAIL (8k `rpp` LCB -0.0047), r2 FAIL (-0.0039), r3 PASS (LCB +0.0079; 20k population +33.3, avoidable -8.6). Levers: growth 0.85 / 0.83 / 0.75, reserves 0.38 / 0.35 / 0.66, builders 0.47 / 0.82 / 0.24, deep 0.16 / 0.17 / 0.07, ventures 0.29 / 0.24 / 0.14. E47 + E48 (6 replicates, persistent exploration, new reward): 20k population 218 / 202 / 218 / 177 / 167 / 203, mean 198 vs council 170, extinctions 27/192 vs 24/192, avoidable deaths below the council in 5 of 6 | The fix is a correctness fix and stays: the old ratio trained the saturated lever on actions never played. It does not improve outcomes: 8k is unchanged and the 20k gain is smaller than E47's (+13 vs +43; the difference is within about two replicate SEs, and E47's lead rests on three runs). The recipe with persistent exploration and the new reward beats the council at 20k in 5 of 6 replicates on population and in 5 of 6 on avoidable deaths, with extinctions level; 3 of 6 pass the gate (E47 r2, r3; E48 r3) |
| E21 | 11-25 | Evaluation speed is not the bottleneck | 24 games x 8,000 ticks: `eval_paired.py` 61 s, in-process JS 60 s; per worker ~270 ticks/s at late-game population (3.7 ms/tick) | Keep `eval_paired.py` as the reference evaluator; noise, not speed, limits decisions |

E19, 24 games x 8,000 ticks (seed base 100000):

| Player | rpp | Pop | vs default (z) | Wins | Avoidable | Extinctions |
|---|---|---|---|---|---|---|
| neglect (`challenge_probe`) | 0.259 | 22.2 | - | - | - | 11 |
| default (no AI) | 0.478 | 57.0 | - | - | 11.4 | 0 |
| old `policy_best.json` | 0.510 | 74.8 | +17.8 (2.63) | 18/24 | 11.6 | 0 |
| fresh, gamma 0.995, run 1 (two replicates) | 0.525-0.534 | 76.6-80.8 | +19.6-23.8 (3.1-3.3) | 16-19/24 | 10.8-11.6 | 0-1 |
| fresh, gamma 0.995, run 2 | 0.525 | 83.6 | +26.6 (3.37) | 18/24 | 12.0 | 0 |
| fresh, gamma 0.998, run 1 | 0.534 | 83.2 | +26.2 (3.96) | 20/24 | 10.2 | 0 |
| fresh, gamma 0.998, run 2 | 0.531 | 79.8 | +22.8 (3.94) | 19/24 | 10.0 | 0 |
| gov:0 rule (`challenge_probe`) | 0.566 | 96.0 | +39.0 | - | - | 0 |

Per scenario (mean pop, 2 games each): the trained policy (gamma 0.998, run 1) beats default most in
`food_scarce` (126 vs 63), `underrealm_push` (117 vs 65) and `social_tension_pressure` (79 vs 25),
but loses in `baseline` (72 vs 98); `gov:0` beats it in `full_sim`, `ruins_focus` and
`warrior_realism_pressure`.

Throughput: inside training the Node env costs 2.2-2.4 ms per 2-tick step (~1.15 ms per simulated
tick, 7 workers) on short 2,800-tick episodes with small colonies. Full 8,000-tick games cost ~3.7 ms
per tick per worker (~270 ticks/s, 8 workers) because cost grows with population; in-process and
Python-IPC evaluation run at the same speed (E21). An earlier claim that half of the env time was
per-decision overhead came from misreading an aggregate rate as per-worker and is withdrawn.

---

## 4. Diagnosis: what limits quality today

Ranked by expected impact.

- **D1. Inert and binary action space (E15, E16, E19).** 29 heads, 4 groups with no measured
  leverage. Most governor intents are on/off thresholds whose default is "on", while a continuous
  Gaussian head starts near the middle of the range. The policy beats the no-AI game by ~45% but not
  the trivial "all governors off" rule (83 vs 96 dwarves): it has not learned the main switches.
  Worse, the decisions that shape a game are fixed config thresholds the policy neither sees nor
  controls: growth (births unlock above 60% stock and 2 units per dwarf), seasonal reserves (gather
  to 128% of target in every season), workforce split (22% builders, 12% managers), housing (build
  below 1.7 beds per dwarf), Underrealm crew size (fixed surface reserve) and defense (24 adults for
  full defense). The AI tunes details while the steering wheel is hard-coded.
- **D2. Weak reference strategy (addressed by S2).** The no-AI posture (every governor on) is worse than random under
  scarcity (default 57 vs gov:0 96). Gains are measured against a strawman, and `npm start` players
  watch a needlessly poor colony.
- **D3. Decision cadence and credit assignment.** One decision every 2 ticks means 4,000 decisions in
  a gate game, while consequences (famines, aging, raids) unfold over hundreds to thousands of ticks.
  The speed cost of frequent decisions is unmeasured (E21 withdrew the earlier estimate).
- **D4. Horizon mismatch.** Foundation episodes last 2,800 ticks; the gate judges 8,000. Founder
  infertility (from ~4,300 ticks) and old age (5,200-7,600) are never seen in training (E10).
- **D5. Observation misses the signals that predict outcomes.** No food/water autonomy, time to
  winter, reserve vs birth requirement, birth gating or age structure; many low-value features
  (clan shares, social, warrior details).
- **D6. Simulation fairness and depth.** Founders share one age window (180-700 ticks), so the
  colony hits a synchronized demographic cliff; progress systems were tuned for 600+ dwarves and
  now rarely fire; deep raids kill without a decision that can prevent them.
- **D7. Evaluation noise and train/serve parity.** The paired SE of a population delta is ~7 dwarves
  at 24 games and training replicates differ by SD 9 (S0), so gains below ~15% are hard to confirm;
  speed is not the limit (E21). The game's JS inference fed policies different inputs than training
  until E20; parity must be re-checked whenever observations change.
- **D8. Stale production state.** Production policy, regression baselines and model reports refer to
  the old game.
- **D9. The game corrects itself.** Hard-coded reflexes act exactly when decisions matter most:
  emergency gathering reassigns dwarves below 52% food or water (`population.roles.emergencyMinRatio`),
  water gets an automatic x3 priority below 85% (`ai.priorityBoosts`), breweries pause on emergencies.
  They flatten the gap between good and bad play and leave the AI little to decide in a crisis.
  Measured (E22): the emergency reflex is harmful at 8,000 ticks but is also the only brake on
  population overshoot; it can only go once growth is controlled.
- **D10. Levers with tiny ranges.** Several governor biases are capped at +/-0.1 (trade reserve ratio,
  Underrealm surface reserve, depth allocation and role mix), so even their extremes barely move the
  colony; part of the "no leverage" verdict in E16 may be a range problem, not a design problem.
- **D11. Games are too alike.** Training randomization spans only +/-5-10% of stocks, nodes and
  needs, and evaluation uses fixed parameters. When games resemble each other a fixed rule wins (gov:0);
  the value of adaptive play only appears when conditions differ from game to game.
- **D12. AI decisions are invisible.** Players cannot see what the AI (or the default posture)
  decided or why, so a better policy does not make a more readable game, and wrong decisions are hard
  to spot while debugging.
- **D13. Stratification.** The game has grown by layers: 4,926 config values (structures 841, AI and
  training 784, display 556, schism 337, Underrealm 320, warriors 251), ~120 key names never read by
  name in code, 19 training scenarios (381 values) and 12 game scenarios on top of base, training and
  eval overrides; ~70,000 lines in `src/`, 53 simulation modules, 35 systems per tick. Narrative
  systems all feed the same few quantities through hidden multiplier stacks (gather yield is a product
  of ~16 factors, need decay of ~17), and the same decision is taken in up to five places (defaults,
  governors, engine reflexes, steward, policy, scenario overrides). Most defects found so far are
  symptoms: yields floored to one unit (E18), weight 0 read as 1 (E15), the emergency reflex doing
  two opposite jobs (E22), inert governor heads (E16), duplicated observation code (E20), yields
  restated in three override layers. Consequences: tuning is not identifiable, the AI cannot assign
  credit to choices that other layers overrule, and nobody can see why a colony fails.

---

## 5. Step plan

Order: measure (S0-S1), define "good" with a strong hand-written strategy (S2), rationalize the
model (R) so the next changes land on a small, visible core, settle the game (S3), then rebuild the learning stack (S4), lay a clean training foundation (T), then improve learning (S5), scale it with a better observation (S6, which absorbed S7) and ship (S8). The steward comes first
because it improves the `npm start` game at once, needs no training, and gives every later step a
serious opponent: if reinforcement learning cannot beat it, that shows early and cheaply. Simulation
changes (S3) follow it and precede any heavy training, because each one invalidates trained policies.
Within these steps, the structural items that set the ceiling on how much the AI can matter come
first: per-game variety (S3d) and moving reflexes into the steward (S2), then the cheapest strong
levers (rationing and trade in S4a), then visibility (S2, extended to the trained policy in S8).
Each step changes one thing, uses the protocol in section 6, and is accepted only when its pass
criteria hold. If a step fails its criteria twice, revert it and record why. Before and after every
step that changes what players see (S2, S3, S8), watch at least 10 minutes of an `npm start` game and
note whether the colony reads as challenging or merely frustrating.

### S0. Freeze scorecard v1 (measurement only, ~1 h)
- Freeze a session from the current config; run the scorecard for `default`, `gov:0`, `random`,
  `neglect` on 24 games x 8,000 ticks, the standard game (4 seeds x 8,000 and x 20,000 ticks), and
  3 fresh training replicates of the current recipe, each evaluated on the same 24 games.
- Pass: scorecard v1 recorded in section 8 with means and replicate SD. Done 2026-11-25: replicate
  SD 9.1 dwarves, paired SE ~7 per replicate (section 8, "Scorecard v1").

### S1. Native policy evaluation and train/serve parity (D7) - done 2026-11-25
- Added a `policy:<file>` player to `challenge_probe.js` using `src/ai/policy.js` (the game's own
  inference).
- Outcome: no speed gain (E21: 60 s vs 61 s for 24 games), but the parity check found that the game
  fed policies different inputs than training (E20). Fixed with one shared helper; first decisions
  now match to 1e-7 and JS/Python means agree within one SE on all 3 replicates.
- Games still diverge after the first decisions (0 of 24 identical; win/loss sign vs default agrees
  in 12-19 of 24): float32 vs float64 inference plus a chaotic simulation. Use the JS player for
  distribution-level checks of what the game plays, and `eval_paired.py` for paired decisions.
- Standing rule: every observation change re-runs this parity check (first-decision match and mean
  population within one SE). Decisions use 48 games (seeds 100000-100047) at ~2 minutes each.

### S2. Steward reference strategy (D2, D9, D12) - done 2026-11-25
- `src/simulation/steward.js`, config `ai.steward`: the council fills every action group a policy
  does not provide. `restrainedGroups` are held at their minimum in every posture; `cautiousGroups`
  only while food and water per dwarf (`safeReservePerCapita`) or population (`safeMinPopulation`)
  are below threshold, judged every `decisionTicks`. RNG-free; its state lives in `state.steward`.
- Measured choice (E23): all nine groups restrained, no cautious groups. State-aware variants that
  reopen ventures when reserves are secure were worse on every horizon tested.
- Reflexes (E22): removing the emergency reflex lifts 8,000-tick games but lets colonies overshoot
  and collapse at 20,000 ticks, so it stays until growth is controlled.
- Visibility: posture changes that alter what is held back become `council.posture_changed`
  decrees in the Event Log; the Colony Report status page shows a Council row.
- Pass met: eval plan steward 96.4 >= gov:0 96.0 with fewer avoidable deaths (10.0 vs 11.0) and no
  extinctions (24 games, not 48: the result is a tie within noise); standard game 201 >= gov:0 182 at
  8,000 ticks and 128 >= default 69 at 20,000 ticks (8 seeds).
- `npm start` benchmark (4 seeds x 8,000 ticks): population 111 -> 237, Underrealm depth 0.5 -> 1.5,
  completed landmarks +2; no negative stocks. Cached baseline refreshed.
- Side effects: `neglect` now inherits the steward posture (59.5 pop, 1 extinction, -38% vs default;
  S3 asks for <= -50%); trained policies inherit it for the groups they do not send (today only
  `social`), so S0 replicate numbers predate the steward.

### R. Rationalization: a small visible core, narrative attached through explicit channels (D13)
Narrative systems stay (they make every game a story); what changes is how they couple to the
economy and where decisions are taken. One sub-step at a time:
- R1 system ablation (measurement only, ~15 runs x 40 s): disable one system at a time (schism, myths,
  alchemy, warriors, social drama, world events, external camps, contracts, festivals, ruins,
  Underrealm, epic conflicts, landmarks, world legacy, merchant) on the 24-game plan and record the
  effect on final population, avoidable deaths, progress and event count. Output: each system
  labelled economic (moves outcomes, |z| >= 2) or narrative (does not).
- R2 key classification and dead-key report: a script labels every config key core (tuned, in the
  tuning surface), narrative (flavor, fixed), presentation or infrastructure, and lists keys never
  read. Delete dead keys; target <= ~50 core keys.
- R3 modifier ledger: gather yield, need decay, birth chance and death risk are computed through one
  registry where each system enters a named factor; first bit-identical, then the product is
  bounded (e.g. [0.5, 1.5]) and the Colony Report shows the active factors ("food yield x0.62:
  winter x0.45, festival x1.1 ...").
- R4 one decision chain: policy, then steward, then a single engine safety guard. Reflexes that
  duplicate decisions (emergency gathering, water priority boost, brewery pause) become steward rules
  or levers; the emergency reflex moves once growth is controlled (S3-0).
- R5 three-level config: base, then scenario, then training profile; economic values are never
  restated in override layers, enforced by a contract test that flags restated core keys.
- R6 sensitivity screen (Morris elementary effects) on the remaining core keys with the 24-game plan;
  keys without measurable effect are frozen and leave the tuning surface.
- Pass: R3-R5 refactors bit-identical before any behavior change; <= ~50 core keys, each with a
  measured effect; no restated economic values across layers (test green); one documented decision
  chain; the Colony Report explains active modifiers; scorecard unchanged within noise after the
  bounded ledger.

Status 2026-11-25: step R done (R1-R6).
- Dead keys (E24): trace tool `scripts/config_trace.js` + `scripts/audit_config.js`; 21 dead paths
  (84 lines) deleted, games bit-identical.
- R1 (E25): raids, landmarks, Underrealm and ruins are economic; schism, social drama and wildlife are
  narrative drags; endgame, festivals, prestige, villages and world legacy never act within 8k ticks.
- R2: 4,253 values; 298 never read because their situation never occurs; 50 core tuning keys listed in
  `scripts/audit_config.js` (`CORE_KEYS`), everything else frozen.
- R3: `src/simulation/modifier_ledger.js`; gather yield (11 factors), need decay (11) and birth chance
  (5) go through it, bit-identical; bounds `simulation.modifierBounds` (yield 0.35-1.6, need decay
  0.8-1.4) sit just outside the observed range (yield 0.40-1.34, need decay 0.86-1.25 over ~2,900
  samples), so they never bind today but stop runaway stacks; Colony Report Economy page "What
  drives the economy" shows the multiplier and its strongest factors.
- R4: decision chain policy -> council (steward) -> engine defaults, with emergency gathering as the
  single engine guard; priority boosts adjust only default weights (E26); the Council row reports who
  decided how many groups.
- R5 (E27): training and eval overrides keep only profile keys (`events`, `ai`, `merchant`,
  `endgame`); a contract in `test_core_simulation_contracts.js` fails on any non-profile section or
  core key in them.
- R6 (E28): `experiments/sensitivity_screen.js` (100 variants, ~3.2 h); 18 keys move outcomes and form
  the tuning surface (`CORE_KEYS`), 32 are frozen (`FROZEN_KEYS`, still protected from overrides by the
  contract). Water dominates: thirst decay, thirst threshold and water yield move population by
  100-160 dwarves for a +/-25% change, so the economy sits on a knife edge on the water side;
  lifespan and housing labor come next. Inputs for S3: S3-0 growth control must reason about water
  first; S3a founder ages touch the two lifespan keys; S3d variety ranges must stay narrow on the
  water keys or extinction rates jump.

### S3. Simulation fairness and earned progress (D6)
One sub-change at a time, each A/B'd with `--set` before it becomes a default:
- S3-0 growth control (first, E22): births follow sustainable food and water production rather than
  a stock snapshot, so colonies stop overshooting into famine. Pass: with the emergency reflex
  lowered to a last-resort 0.15, the standard game at 20,000 ticks (8 seeds) has no more extinctions
  than today (steward 2/8) and keeps the 8,000-tick gains of E22.
- S3a founders: spread founding ages and fertility windows (config-driven jitter) so the colony
  ages continuously.
- S3b progress pacing: Underrealm depth and landmark stages reachable by good play in the tight
  economy (requirements scaled to the colony, not to 600-dwarf settlements).
- S3c deep-raid counterplay: a defense or guard decision with measurable effect on deep-raid deaths.
- S3d per-game variety (D11): each game draws its own parameters from wide, config-driven ranges
  (winter severity, gather yields, raid frequency and strength, map resources), deterministic per seed
  and applied in the game, training and evaluation alike; part of them is visible in the observation,
  the rest must be inferred. Pass for S3d: the best fixed posture (default, gov:0, steward variants)
  differs between at least a third of the games, and no fixed posture wins more than 60% of paired
  games against the others.
- Pass (scorecard, 48 games): default median drawdown between 4,000 and 8,000 ticks <= 25%
  (today ~37%); default extinctions <= 1/48 at 8,000 ticks and <= 3/48 at 20,000; neglect at least
  50% below default; good play (gov:0 or steward) reaches median Underrealm depth >= 1 by 8,000
  ticks; the leverage probe shows the new defense decision moving deep-raid deaths with |z| >= 2.

Status 2026-11-25: S3 done, pass partly met (E29-E32).
- S3-0 (E29, E30): the 20k collapse was one synchronized generation aging out, not famine. Birth
  budget `population.reproduction.growthCap` (25% a year, floor 20 births a year) with the emergency
  reflex lowered to 0.15: eval avoidable deaths halved, progress +50%, 20k extinctions 10 -> 7 of 32
  seeds. At 40,000 ticks every variant still loses 4-6 of 16 colonies to a water-overuse trap (births
  blocked longer than the fertile window): the long-run growth decision is the S4 lever's job.
- S3a (E30): founder ages and per-dwarf lifespan jitter (`population.aging.lifespanJitter`, 0) below
  z 2; not adopted.
- S3b (E30): depth target already met; landmark stages saturate (15/15 in 46 of 48 games), so they
  no longer separate good from bad play.
- S3c (E31): Underrealm guards cut deep-raid deaths (z -3.6) at a progress cost (z -4.3); no code
  change, lever candidate for S4.
- S3d (E31): per-map world profile on by default; game-dependent best settings appear for growth at
  20,000 ticks, not for governor postures at 8,000.
- Scorecard v3 (E32): steward 166 at 8k, everything-on -11% at 8k but -40% at 20k; 20k extinctions
  4/32 and the neglect gap remain open. Session `experiments/runs/2026-11-25_s3` (git-ignored).

### S4. Strategic levers and action space v2 (D1, fresh training)
Give the AI 6-8 high-level decisions with a real trade-off and hand everything else to the steward.

S4a lever audit (no AI change, ~3 minutes per candidate). First widen capped governor ranges (D10)
so existing levers are judged at a meaningful extreme. For each candidate, move the underlying
config threshold to a low and a high setting with `challenge_probe.js --set` (players `default`,
steward and `neglect`, 48 games, 8,000 ticks; 20,000 ticks for growth and reserves) and record the
paired effect on final population, avoidable deaths and progress:

| Candidate lever | Trade-off | Config it replaces today |
|---|---|---|
| Growth rate | more dwarves now vs one synchronized cohort that ages out together (S3-0) and famine after overshoot | `population.reproduction.growthCap.maxAnnualGrowth` (council default from S3-0), `minStockpileRatio`, `resourcePerCapita` |
| Seasonal reserves | safety in winter vs growth and building | `jobs.gatherTriggerRatio` (same in every season) |
| Workforce budget | essentials vs building vs Underrealm vs defense | `population.roles.builderRatio`, `managerRatio`, Underrealm crew ratios |
| Build priority | houses vs fields/wells vs towers vs brewery | `population.housing.buildTargetRatio`, structure guardrails |
| Risk posture | expeditions, Underrealm push and camp deals vs safety | ruins, Underrealm and external-camp intents (binary today) |
| Defense | guards against deep raids vs labor | `raids.defenseAdults`, Underrealm guard mix |
| Rationing | smaller meals in lean seasons (morale and productivity cost) vs starvation | fixed `consumption.*Threshold` and `*Target` |
| Merchant trade | sell materials to buy food before winter vs keeping building stock | automatic merchant trades with a fixed `merchant.reserveRatio` |
| Event choices | accept or refuse caravans, pay tribute or fight, which decree to issue | threshold-based resolution of world events, camps and schism decrees |
| Scouting | spend labor to learn raid timing and winter severity in advance | none (no forecast exists) |

Growth is the lever whose cost arrives last: a boom at tick 3,000 is paid at 10,000-12,000 ticks
when that cohort dies of old age, far beyond the ~1,000-tick discount horizon and the 8,000-tick
gate. No dedicated birth reward (it would teach births, not judgment): the outcome reward already
pays population over time and charges extinction. It becomes learnable only with the age structure
in the observation (S6) and long-horizon training from mid-game snapshots (S5). Check: with the
lever free, the policy must beat both the council default and maximum growth on 20,000-tick games;
if it settles on maximum growth, the horizon is still too short.

Event choices are rare discrete decisions: expose them as masked heads that act only when an offer is
open. Scouting only becomes useful after S3d makes games differ.

A candidate becomes an AI lever only if one direction moves an outcome with |z| >= 2 and the
best setting differs between scenarios or seasons (otherwise a fixed steward rule is enough).

The S4a audit (E33) showed the strongest levers pay at 8,000 ticks and cost at 20,000 (growth,
risk), so a policy trained on today's ~1,000-tick horizon and promoted by the 8,000-tick gate would
learn "grow fast, risk everything". The training changes once planned for S5 and S6 therefore land
in S4, before the first fresh training (decision 2026-11-26):

S4b action space v2: keep the four job weights (they carry the per-resource observation rows) and
replace the festival and the 28 governor heads with one head per lever that passes S4a, initialized
to the council posture; the council fills every group no head decides.
S4c strategic cadence: one decision every N ticks for training, gate and game (sweep 10, 20, 40 on
a short run, keep the best), with gamma per decision set for a ~10,000-tick horizon.
S4d mid-game snapshot starts (described in S5 below): a bank of states from 2,000-16,000 ticks of
council and current-policy games, refreshed every chained run; part of the episodes start from tick
0 (growth decisions), part from the bank (where their cost is paid), with shorter episodes.
S4e observation: age structure (child, fertile-adult and old-age shares, births in the last year,
growth budget) and food/water autonomy in ticks; S1 parity check after the change.
S4f dual-horizon gate: promote only if the 8,000-tick `rpp` gate passes and the 20,000-tick check
(16 standard games) is not worse than the incumbent.
Then one fresh training with 3 replicates.

Pass: every exposed lever moves an outcome with |z| >= 2 in the leverage probe; trained policy beats
the council by >= 10% final population with z >= 2 on 20,000-tick games and is not worse at 8,000
(48 games, 3 replicates); no more extinctions than the council at 20,000; worse than the council in
at most 3 of 12 scenarios; fewer action heads than today (33).

Status 2026-11-26: S4 closed, pass not met (E33-E35).
- Built and kept: five levers (growth rate, reserves, builders, Underrealm share, ventures) as 9-head
  action space v2 (`src/simulation/levers.js`, `ai.levers`); seven strategic inputs (S4e); snapshot
  starts (`scripts/build_snapshot_bank.js`, `train.py --snapshot-bank/--snapshot-prob`, ai_server
  `autostep`/`save_snapshot`/snapshot reset); dual-horizon gate (`canonical.longHorizon`);
  evaluators use each policy's own action list, so v1 and v2 policies compare under one config.
- Measured: cadence 10 best of 10/20/40 (E34); replicates 1-2 at 1,920 episodes: +14% and -6% at
  8,000 ticks, both below the council at 20,000 (E35). Production `models/` unchanged (v1).
- Suspected cause: policy entropy grows during v2 training under the schedule tuned for 33 heads.
  The S4 fix screen (E36) showed the schedule barely moves the noise (log std stays at its init
  within a run); the likely bottleneck is per-decision independent exploration noise, which S5
  addresses first.
- Not done in S4: cadence 10 is not yet the default of `train_wrapper` phases, the gate or the game
  (`ai.stepTicks` stays 5 for the v1 policy); S1-style JS/Python parity run on a v2 policy.

### T. Training foundation (D7, D13; decision 2026-11-26)
S4-E36 showed the training stack had become the main source of cost and doubt: the E35 recipe lived
only in ad-hoc `--set` flags and had to be rebuilt by hand, the snapshot bank was lost with its run
folder, trainer, gate and game used three different cadences (2, 2 and 5 ticks) while v2 policies were
trained at 10, and the train/serve bugs of E20 and E27 both came from overlapping layers (~15,000
lines across `train.py`, `ai_server.js`, `train_wrapper.js`, `regression.js`, `promote_best.py` and
`train_continuous.js`; 709 config values in `ai.training`). The game side stays frozen during T.
Goal: one recipe, one command, one evaluator, one gate; every run repeatable from its own folder.
- T0 cleanup: stale workbook, per-seed regression folders and old run folders removed.
- T1 one recipe: `ai.training.recipe` holds every run-shape knob (cadence, gamma, workers, seeds, noise
  hold, stable termination, snapshot bank, per-phase episodes, episode ticks, difficulty, epochs,
  batches, learning rate and entropy schedule); `scripts/train_recipe.js` (`npm run ai:train:recipe`)
  freezes the phase configs and the effective recipe into the run folder, builds or reuses the
  snapshot bank (cached by config, bank shape and start policy; a chained run `--from` a policy
  rebuilds it with that policy playing `policyShare` of the games), runs the phases and refuses to
  finish if `models/` changed. The cadence belongs to the policy: the trainer writes `stepTicks` into
  the policy file; the game, `ai_server` autostep, `challenge_probe` and the snapshot builder use it;
  `eval_paired.py` (new `--ticks`) and `promote_best.py` refuse a different cadence instead of
  silently using it. No tick ceiling on what training sees: stable termination is off (it cut settled
  colonies out of training) and the bank covers 2,000-40,000 ticks; episodes stay ~2,800-tick
  segments with time-limit bootstrap (the effective horizon is set by gamma, ~10,000 ticks).
- T2 lean v2 trainer: a PPO trainer for lever heads only, reusing `ai_server`; every fix of the old
  trainer (output-preserving return rescaling, time-limit bootstrap, observation normalization, value
  clipping) ported with a test. Parity: with `stableTermination=true` and the E36 bank it reproduces
  the E36 control within noise; then a new baseline on the default recipe (3 replicates vs council).
- T3 one evaluator and one gate, both in ticks and at each policy's own cadence: 8,000 and 20,000
  ticks vs the council (council results cached per config); one command writes the full scorecard.
- T4 delete the old stack: v1 heads, legacy observation layout, wrapper profiles, continuous
  training, regression profiles, `exp_run.js`; `ai.training` from 709 values to ~50, guarded by a
  contract test.
- T5 close the loop: train and promote a v2 policy with the new stack (even if only level with the
  council) so `npm run ai:play` works again; regenerate baselines.
- Pass: two runs of the same recipe give bit-identical weights; one command per run, evaluation and
  gate; no run-shape value outside the recipe; `npm test` green; `npm run ai:play` runs a v2 policy.

Status 2026-11-26: T0 and T1 done.
- T1 checks: `npm test` green with the new `scripts/test_recipe_contracts.js`; `eval_paired.py --ticks`
  runs a v2 policy at its own 10-tick cadence and rejects `--step-ticks 2`. Determinism of the old
  trainer held at 16 episodes but failed at 64 (E37), so it moved into T2.
- Not measured yet: stable termination off and the 40,000-tick bank change the recipe against E36;
  T2 measures the new default against the parity setting.

Status 2026-11-26: T2 built and checked (E38); the new-default baseline is not run yet.
- `python/trainer_v2.py` + `python/v2/` replace `train.py` for v2 runs: compact transport only (no
  Python observation code), action ids from config, per-episode settings as pure functions of run
  seed and episode number, fixed scenario weights (the adaptive sampler is gone), weight version per
  episode fixed by `policyLagBatches`, everything else read from the run folder. `scripts/train_recipe.js`
  calls it; `python/test_trainer_v2.py` (inside `npm test`) guards numeric parity with the old trainer
  (while it exists), JS/Python inference parity and policy round trips, and a source check forbids the
  trainer from reading run-shape keys outside the recipe.
- `ai_server.js`: episode tick limits count from the episode's own start tick (E38).
- Worker count is a pure speed knob: 4, 5, 6, 7 and 9 workers give identical weights. Time for 160
  foundation episodes: 6 workers 198 s, 7 workers 201 s (the 4- and 5-worker runs overlapped another job
  and are not comparable); the recipe keeps 7.
- Left for later in T2: the new-default baseline (3 replicates x 1,920 episodes, ~1 h each, plus the
  40,000-tick bank build, ~30-40 min once) against the council at 8,000 and 20,000 ticks.

Status 2026-11-26: T3 built and checked (E43).
- `scripts/scorecard.js` is the single evaluator: `experiments/challenge_probe.js` plays every player
  in-process (a policy at its own `stepTicks`, the council at `ai.evaluation.councilStepTicks`) on the
  `ai.evaluation` horizons; results are cached in `.cache/scorecard/` by simulation sources, probe
  source, evaluation version, config, horizon and player content, so the council and an unchanged
  incumbent are played once per game version. `--gate` judges a candidate against the best v2 policy
  (the council while `models/` holds only the v1 policy); `--promote` writes `models/policy_best.*`
  only on a pass. `experiments/replicates.js` scores replicates through it.
- Contracts (`scripts/test_recipe_contracts.js`): settings validation, the three gate rules, refusal of
  policies without a cadence, reproducible scorecards, cache hits, same games for every player.
- `eval_paired.py`, `promote_best.py` and `ai.training.promotion` remain for v1 policies until T4.
- `scripts/train_recipe.js --bank-only` builds (or finds) the cached snapshot bank and stops, to prepare
  a machine ahead of a run. The bank cache key hashes the whole config, so any config edit (even
  `ai.evaluation`) rebuilds a bank whose content is identical; banks stay out of git (250-400 MB of
  binaries, invalidated by T4) and are moved between machines by hand with `--bank <dir>` if needed.

Status 2026-11-26: T4 done (E44).
- Deleted: v1 heads, legacy observation layout, wrapper profiles, continuous training, regression
  profiles and baselines, `promote_best.py`, `exp_run.js`, `eval_paired.py`, `leverage_probe.py`,
  `analyze.py`, the CI workflow (it trained with the old stack and never installed torch) and the v1
  models. `npm run ai:play` refuses to start until T5 promotes a v2 policy; saves that carry a v1
  policy are refused with a message.
- `ai.training` holds `recipe`, `trainer` (17 keys: algorithm hyperparameters and the feature list),
  the two profile overrides and `randomization`: 185 values instead of 772, all read by the v2 stack,
  guarded by `testTrainingConfigSurface` in `scripts/test_recipe_contracts.js`. The ~50 of the plan is
  met without the feature list and the recipe's 20 bank ticks; the scenario catalog is game content
  and moved to the top-level `scenarios` section (the game's scenario templates read it too).
- Stable termination is gone (`ai.termination`, the profile and `recipe.stableTermination`): only
  extinction ends an episode early.
- Tests that needed a policy use a seeded v2 fixture; the old-trainer parity test retired with
  `train.py` (E38 stands as the record).

Where we are (2026-11-27):
- Done: T0-T3 (pushed, e77e8f7 and a797a67) and T4 (E44, a9b5219); E42 run
  and recorded: persistent exploration wins at 8,000 ticks and loses at 20,000, not adopted.
- T5 (1) done: the gate (E45) adds 20k guards on population, extinctions and avoidable deaths to the
  `rpp` guard (all at one SE, the section 6 rule) and refuses every E42 replicate.
- T5 (2) diagnosed (E46): the reward rewards boom-and-bust; candidate fix = drawdown + heavy extinction terms.
- T5 (2) measured (E47, 2026-11-27): with drawdown 1 + extinction 2,000 and `populationToPeak`, the
  persistent-exploration recipe gains +86 dwarves at 8k and +43 at 20k over the council (E42: -28),
  avoidable deaths at or below the council; r2 and r3 pass the gate, r1 fails at 8k after a late KL
  drift (0.06-0.37 from episode 1,320). Extinctions 14/96 vs 12/96: closed only partly.
- T5 (3) diagnosed (E48): the KL drift is a log-probability bug. The PPO ratio rebuilt each action's
  pre-tanh value from the squashed action clamped to +/-0.999 (|pre-tanh| <= 3.8); on real late-foundation
  rollouts r1's final policy saturates the deep lever in 27% of decisions and shows KL 0.286 with
  unchanged weights (r2 0.0045, r3 0.0009). Those samples get a ratio near e^-8, always count as clipped
  and push the gradient toward an action never played. Fix: rollouts store the exact pre-tanh sample and
  the ratio uses it (zero-update ratio exactly 1, `python/test_trainer_v2.py`). E48 (E47 recipe + fix):
  training KL <= 0.025 everywhere; 8k pooled +80 (z 5.4), 20k pooled +13 (z 0.55), avoidable deaths below
  the council in all three, extinctions 13/96 vs 12/96; only r3 passes the gate. Over E47 + E48, 3 of 6
  replicates pass; E47 r3 is the strongest (8k LCB +0.021, 20k population +48, avoidable -5).
- T5 (4) done (2026-11-27): E48 r3 promoted against the council (`npm run ai:promote`; 8k `rpp` LCB
  +0.0079, 20k population +33, extinctions level, avoidable deaths -8.6); `npm run ai:play` loads it
  (cadence 10 ticks). The headless benchmark plays no policy, so its baseline is unaffected (it
  refreshes itself on the config change).
- Next, T5: make `leverNoiseHold` 280 / `leverLogStdInit` 0 the recipe default (6 replicates behind it);
  future candidates face E48 r3 as the incumbent.

### S5. Two-level policy and chained improvement (D3, D4)
- Cadence, snapshot starts and the 20,000-tick gate moved into S4 (S4c, S4d, S4f); what stays here
  is the two-level policy, the snapshot A/B and the chained-run improvement test.
- First (E36): temporally correlated exploration. The trainer draws the lever exploration noise once
  and holds it for K decisions (about a season) instead of redrawing it every 10 ticks, so one
  exploratory choice lasts long enough to change the outcome. Screen K against the per-decision
  control on the E36 recipe, then 3 replicates of the best K against the council at 8,000 and
  20,000 ticks. This is the cheap precursor of the seasonal plan below.
- Try a two-level policy: a seasonal plan chosen at the start of each season (growth, reserves, risk,
  workforce) plus small adjustments at the regular cadence; it shortens credit assignment to a few
  decisions per year. Adopt it only if it beats the flat policy under the same pass criteria.
- Mid-game snapshot starts, so training does not always restart from tick 0: a bank of saved
  states (session graph saves, `src/persistence.js`) taken from games at 2,000-16,000 ticks across
  seeds and scenarios; each training episode starts either from tick 0 or from a bank state, and
  plays a normal-length episode from there. The critic then sees late-game consequences (cohort
  aging, node depletion, deep raids, nemesis sieges) at the cost of a short episode, and the early
  game stops dominating the samples. Rules: the bank mixes steward games with games of the current
  best policy and is refreshed at the start of every chained run, so the policy also learns from the
  states it produces itself; snapshots are deterministic per seed and kept out of `models/`;
  evaluation and the gate still start from tick 0 (8,000 ticks) plus a 20,000-tick check.
  A/B: fresh-start only vs 50% snapshot starts at equal wall-clock, 3 replicates, judged on
  20,000-tick games.
- Pass: training wall-clock per simulated tick down >= 25% at equal episode length; equal or better
  result at equal wall-clock; snapshot starts beat fresh-start-only on 20,000-tick games with z >= 2
  (or are dropped); improvement per run: 3 chained runs where each run is >= the previous minus one SE and
  run 3 beats run 1 by >= 5% population with z >= 2.

### S6. Observation v2, scale and curriculum (D5; S6 and S7 merged on 2026-11-26, one fresh training cycle)
- Observation: age structure and food/water autonomy landed in S4e; add ticks to the next winter,
  reserve per dwarf vs the birth requirement, a births-blocked flag and deep-raid threat vs defense;
  remove features with no permutation importance; keep the vector no larger than today (80).
- Scale: in the same fresh training cycle, dose-response on foundation length (1,920, 3,840 and
  7,680 episodes at cadence 10) and a scenario mix weighted toward scenarios where the policy trails
  the council; 3 replicates at the chosen length.
- Pass: critic explained variance >= 0.95 on 8,000-tick episodes; +5% population vs S5 with z >= 2
  at 20,000 ticks; gain per training minute stays positive up to the chosen budget; the official
  dual-horizon gate promotes (LCB > 0 at 8,000, not worse at 20,000) against the previous best.

### S8. Production hardening (D8)
- Promote through `npm run ai:train:m4pro -- --fresh`, regenerate regression baselines and
  validation reports (`npm run ai:validate`), refresh the benchmark baseline, update README.
- Pass: `npm test` and `npm run ai:validate` green; `npm run ai:play` beats the steward on the
  standard-game benchmark (paired, 4 seeds x 8,000 ticks) with no extinctions.

---

## 6. Measurement protocol

Rules:
- Pair every comparison by seed; report mean delta, SE, z, wins and extinctions.
- Simulation changes: 4 players (`default` = steward, `gov:2` = everything on, `random`, `neglect`), >= 24 games
  (48 after S1), 8,000 ticks; a 20,000-tick check only when a change affects aging or long cycles.
- Training changes: 3 fresh replicates, each evaluated on the same games; adopt when the pooled delta
  on final population (primary) or `rpp` has z >= 2, avoidable deaths and extinctions do not worsen
  beyond one SE, and wall-clock per unit of gain does not grow.
- Report the AI control share (section 1) for every scorecard; S2-S4 must increase it.
- Treat |z| < 1 as no effect. Keep the machine otherwise idle during training and evaluation.
- A new start policy or config means a new session folder; compare only within a session.

Commands (`S=experiments/runs/<session>`):

```bash
node experiments/challenge_probe.js --plan eval --players default,gov:2,random,neglect --episodes 24 --ticks 8000 --workers 8 --out $S/scorecard.json
```

```bash
node experiments/challenge_probe.js --plan standard --players default --ticks 8000 --workers 4 --out $S/standard.json
```

```bash
node experiments/challenge_probe.js --report $S/scorecard.json $S/standard.json
```

One recipe run (any recipe key can be overridden with `--set`; the folder is self-contained):

```bash
npm run ai:train:recipe -- --out $S/<variant>_r1 --set leverNoiseHold=280
```

Scorecard of one policy against the council (or `--against <policy>`), and the promotion gate:

```bash
npm run ai:scorecard -- --policy experiments/runs/<run>/p.json
```

```bash
npm run ai:promote -- --policy experiments/runs/<run>/p.json
```

Replicated recipe runs against the council (training, scorecard, lever readout, pooled paired summary
in `<session>/<name>_summary.json`; resumable, any machine with `npm run ai:bootstrap` done, since
torch and numpy are pinned so runs reproduce across machines):

```bash
node experiments/replicates.js --session experiments/runs/2026-11-27_e42 --name persist --set leverNoiseHold=280 --set leverLogStdInit=0
```

Simulation A/B without code changes: add `--set path=value` (JSON values) to `challenge_probe.js`;
the override applies to the final effective config of every game.

Deterministic regression of the no-AI game: `npm run bench:candidate` then `npm run bench:diff`
(JSON reports in `debug/`, cached baseline in `benchmark_cache/`).

---

## 7. Tuning surface (`config.json`)

| Area | Keys | Current |
|---|---|---|
| Gathering | `jobs.gatherYield` | food 1, water 1, wood 1.15, stone 1.15 (training override aligned) |
| Seasons | `seasons.modifiers.winter`, `.autumn` | winter yield 0.45, regen 0.25, births 0.5, needs 1.12 |
| Drink | `consumption.beerRelief`, `structures.brewery.outputPerTick`, `.foodCostPerTick`, `.stopWhenBeerReserveRatioAbove` | 0.25, beer 0.5, 0.1, 1.5 |
| Births | `population.reproduction.resourcePerCapita` | food 2, water 2 |
| Growth cap | `population.reproduction.growthCap` | on; 25% a year, at least 20 births a year, burst 2 (E29) |
| World variety | `variety.ranges` | on; food 0.7-1.3, water 0.8-1.2, winter 0.5-1.5, needs 0.9-1.1, raids 0.25-1.75 (E31) |
| Lifespan jitter | `population.aging.lifespanJitter` | 0 (E30, not adopted) |
| Reward | `ai.reward.*` | population 1 per 100, deaths 2, distress 1 at 0.6, reserves 0.3 at 2 per dwarf, depth 20, landmark stage 5, prestige 0.2, drawdown 1 per 100 below the cycle peak, extinction 2,000 (T5, E46; was 20 without drawdown) |
| Recipe | `ai.training.recipe` | `v2-base`: 10 ticks per decision, gamma 0.999, 7 workers, noise hold 1, policy lag 1 batch, bank 48 council games at 2,000-40,000 ticks (policy share 0.5 on chained runs); foundation 1,920 episodes x 2,800 ticks, 50% snapshot starts, entropy 0.008 -> 0.002 over 15,000 episodes; finetune 50 x 3,600 ticks (T1) |
| Evaluation and gate | `ai.evaluation` | council at 10 ticks per decision; eval plan = 12 named scenarios (`ai.evaluation.scenarios`); horizons 8k (eval plan, 24 games, seeds from 100,000) and 20k (standard game, 32 games, seeds 101 x i); gate on 8k `rpp`: delta >= 0.005, LCB z 1.96 > 0; 20k guards `rpp`, population, extinctions, avoidable deaths, none worse beyond 1 SE (T3, T5/E45) |
| Trainer | `ai.training.trainer` | algorithm hyperparameters only (clip, KL, GAE, value loss and clipping, normalization, 2x128, log std init) plus the 80-name feature list (T4) |
| Scenarios | `scenarios` (top level) | 19-entry catalog: training weights and difficulty windows, overrides; the game's scenario presets reuse its overrides as test templates (T4 moved it out of `ai.training`) |
| Steward | `ai.steward` | on; decisions every 20 ticks; all 9 governor groups restrained; safe reserve 3 per dwarf and 30 dwarves for future cautious groups |
| Emergency reflex | `population.roles.emergencyMinRatio` | 0.15, last resort (E29) |
| Modifier bounds | `simulation.modifierBounds` | gather yield 0.35-1.6, need decay 0.8-1.4 |
| Core keys | `scripts/audit_config.js` `CORE_KEYS` / `FROZEN_KEYS` | 20 tuned keys: 18 from the R6 screen (E28) plus the growth cap rate and floor (E29); 32 screened keys frozen |

---

## 8. Decision log

| Date | Evidence | Decision |
|---|---|---|
| 2026-11-23 | E5, E7-E9 | `m4-pro` = foundation 640 + finetune 50, no endgame phase; entropy/epochs unchanged |
| 2026-11-24 | E13 | `m4` profile pins 7 workers |
| 2026-11-24 | E14-E16 | Recipe tuning paused; redesign leverage, reward and evaluation |
| 2026-11-24 | E17-E18 | Tight economy: fractional yields 1.0, lean winter, costly capped beer, proportional jobs, births need 2 stock per dwarf |
| 2026-11-24 | E19 | Six-term outcome reward, 8,000-tick `rpp` gate, gamma 0.998 |
| 2026-11-24 | - | Cleanup: legacy 71-term reward, round-robin allocation and integer yields removed (games bit-identical); Markdown reports replaced by JSON; workbook, manual and evidence files folded into this document |
| 2026-11-25 | S0 | Scorecard v1 complete: 3 fresh replicates average 74.6 pop (SD 9.1), +31% vs default, all below gov:0; training changes need >= 3 replicates |
| 2026-11-24 | S0 | Plan reordered: steward (now S2) before simulation changes (now S3) |
| 2026-11-25 | D1 | S4 rewritten around a lever audit: expose growth, reserves, workforce, build priority, risk and defense only if they measurably move outcomes |
| 2026-11-25 | D9-D12 | Added: reflexes move into the steward, widened lever ranges, per-game variety (S3d), rationing/trade/event/scouting levers, seasonal two-level policy, council decrees, AI control share metric |
| 2026-11-25 | S1 | Train/serve skew fixed (E20); speed hypothesis withdrawn (E21); `eval_paired.py` stays the reference evaluator |
| 2026-11-25 | S2 | Steward on by default with every venture group restrained (E23); emergency reflex kept (E22); council decrees and Colony Report row added |
| 2026-11-25 | D13 | Rationalization step R inserted before S3: system ablation, key classification, modifier ledger, one decision chain, three-level config, sensitivity screen |
| 2026-11-25 | R1-R5 | Dead keys removed; systems labelled; 50 core keys; modifier ledger with bounds; one decision chain; overrides profile-only (E24-E27) |
| 2026-11-25 | R6 | Tuning surface cut to 18 measured keys, 32 frozen (E28); step R complete |
| 2026-11-25 | S3-0 | Growth becomes an AI lever in S4 (no birth reward); S5 adds mid-game snapshot starts; S6 adds the age structure |
| 2026-11-25 | S3 | Growth cap 25%/year + floor 20, emergency reflex 0.15, wide per-map variety on; jitter and founder spread rejected; scorecard v3 (E29-E32) |
| 2026-11-26 | S4a | Strategic cadence, snapshot starts, age/water observation and a 20,000-tick gate check move into S4, before the first fresh training: the strongest levers pay at 8,000 ticks and cost at 20,000 (E33) |
| 2026-11-26 | S4a | Levers: growth, reserves, builders, Underrealm share, ventures (E33); housing target and meal thresholds kept at v3 values so the game stays a challenge |
| 2026-11-26 | S6+S7 | Observation v2, scale and curriculum merged into one step and one fresh training cycle |
| 2026-11-26 | S4 | Closed without meeting the pass: the v2 stack is kept, trained policies stay at the council level at 20,000 ticks; entropy schedule identified as the first fix (E35) |
| 2026-11-26 | E36 | Entropy schedule left unchanged: within a run it cannot move the exploration noise; S4 fix replaced by temporally correlated exploration |
| 2026-11-26 | T | Training foundation step inserted before S5: one recipe, one command, policy-owned cadence, no tick ceiling (stable termination off, bank to 40,000 ticks) |
| 2026-11-26 | T0-T1 | Cleanup done; `ai.training.recipe` + `scripts/train_recipe.js`; the old trainer is timing-dependent (E37) |
| 2026-11-26 | T2 | Lean deterministic v2 trainer adopted for recipe runs (E38); episode tick limits count from the episode start; adaptive scenario sampler dropped |
| 2026-11-26 | E39 | Bit-identical simulation optimizations (path-field memo, housing/couple indexes, Underrealm scoring); `sim_fingerprint.js` gates performance changes |
| 2026-11-26 | E40 | Paired branches dropped (no common randomness with one RNG stream); lever exploration at trainer scale carries no measurable signal per episode |
| 2026-11-26 | E41 | Persistent wide lever exploration (`leverNoiseHold`, `leverLogStdInit`) is the lever-learning approach to replicate; not yet the recipe default (1 replicate) |
| 2026-11-26 | T | `experiments/replicates.js` runs replicated recipe runs and their council comparison in one resumable command; `ai:bootstrap` pins torch 2.10.0 and numpy 2.4.3 |
| 2026-11-26 | T3 (E43) | `scripts/scorecard.js` (`npm run ai:scorecard`, `ai:promote`) is the single evaluator and gate for v2 policies, settings in `ai.evaluation`, council cached per game version; same gate rules as before (8k `rpp` LCB, 20k guard), now in ticks at each policy's cadence |
| 2026-11-26 | T4 (E44) | Old training stack deleted (v1 heads, legacy layout, wrapper profiles, continuous training, regression harness, CI workflow, `promote_best.py`, `eval_paired.py`, `exp_run.js`); `ai.training` 772 -> 185 values guarded by a contract; scenario catalog top-level; stable termination removed; games, training weights and scorecards bit-identical |
| 2026-11-26 | E42 | Persistent lever exploration (`leverNoiseHold` 280, `leverLogStdInit` 0) not adopted as the recipe default: pooled 8k +79 (z 4.1) but 20k -28 (z -1.1) with extinctions 23% vs 12.5% and avoidable deaths +17; the recipe default stays noise hold 1 |
| 2026-11-26 | T5 (E45) | Gate: 8k `rpp` primary unchanged; 20k guards extended from `rpp` to population, extinctions and avoidable deaths (one SE each, section 6 rule); every E42 replicate is refused |
| 2026-11-27 | T5 (E46, E47) | Reward gains a drawdown term (1 per 100 dwarves below the cycle peak, per decision) and extinction -2,000 (was -20); observation gains `populationToPeak`; with persistent lever exploration 2 of 3 fresh replicates pass the gate at 8k and 20k (pooled 20k +43, z 1.6) |
| 2026-11-27 | T5 (E48) | PPO ratio computed from stored pre-tanh samples (was the inverted, clamped squashed action): removes a spurious KL of up to 0.29 on saturated levers; training weights change, outcomes measured in E48 |
| 2026-11-27 | T5 | First v2 policy promoted: E48 r3 (passes the gate vs the council; chosen over the slightly stronger E47 r3 because the current trainer reproduces it); `npm run ai:play` runs again |
| next | T5 | Make persistent exploration the recipe default; later candidates are gated against E48 r3; see "Where we are" under T |

### Scorecard v1 (S0, session `experiments/runs/2026-11-24_s0`, commit a5e3998, git-ignored)

Eval plan, 24 games x 8,000 ticks (`challenge_probe.js`, paired with default):

| Player | Pop (SD) | vs default (z) | Wins | Ext. | Avoidable | Starvation | Drawdown | rpp | Depth >= 1 | Landmark stages | Idle | Food autonomy |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| default | 57.0 (35) | - | - | 0 | 8.2 | 1.9 | 0.46 | 0.478 | 10/24 | 11.2 | 4% | 31 ticks |
| gov:0 | 96.0 (40) | +39.0 (5.44) | 23/24 | 0 | 11.0 | 1.5 | 0.23 | 0.566 | 15/24 | 13.8 | 10% | 154 |
| random | 66.4 (36) | +9.4 (1.52) | 15/24 | 0 | 7.3 | 0.0 | 0.36 | 0.488 | 11/24 | 10.9 | 6% | 60 |
| neglect | 22.2 (38) | -34.8 (-4.40) | 4/24 | 11 | 28.2 | 23.9 | 0.71 | 0.259 | 6/24 | 5.4 | 4% | 55 |

Standard game, 4 seeds: at 8,000 ticks default 111, gov:0 189 (4/4 wins), neglect 58 (1 extinction);
at 20,000 ticks default 84 (0 extinctions), gov:0 69 (1 extinction, 39 avoidable deaths), neglect
30 (3 extinctions). Turning every governor off wins short games but loses long ones: no fixed
posture is best, which is the room the steward (S2) and the trained policy must fill.
`eval_paired.py --policy default` on the same 24 games matches the probe (pop 57.0, rpp 0.478).

Current recipe (`m4-pro`, gamma 0.998), 3 fresh replicates, each on the same 24 games
(`eval_paired.py --outcomes`, paired with default and with gov:0 from the probe):

| Replicate | Pop | vs default (z) | Wins vs default | vs gov:0 (z) | Wins vs gov:0 | rpp | Avoidable | Starvation |
|---|---|---|---|---|---|---|---|---|
| 1 | 73.8 | +16.8 (2.52) | 16/24 | -22.2 (-3.80) | 5/24 | 0.509 | 9.9 | 0.5 |
| 2 | 84.0 | +27.0 (3.94) | 19/24 | -12.0 (-1.88) | 9/24 | 0.529 | 12.6 | 0.0 |
| 3 | 65.9 | +8.9 (1.27) | 14/24 | -30.1 (-4.84) | 5/24 | 0.496 | 10.3 | 0.0 |
| mean (SD) | 74.6 (9.1) | +17.6 | - | -21.4 | - | 0.512 (0.017) | 10.9 | 0.2 |

No extinctions in any replicate. Training each took ~5.6 minutes; foundation critic explained
variance 0.94-0.96, finetune 0.95-0.99.

Per scenario (mean pop over 2 games; trained = mean of the 3 replicates): the trained policy beats
default clearly in `full_sim` (113 vs 80), `food_scarce` (114 vs 63), `ruins_focus` (99 vs 72) and
`social_tension_pressure` (58 vs 25), roughly ties in `baseline` (90 vs 98), `underrealm_push` and
`governance_pressure`, and loses in `compound_crisis` (23 vs 34). gov:0 beats the trained mean in 11
of 12 scenarios (all but `baseline`).

What S0 teaches:
- Training outcome varies a lot with the seed: the same recipe and budget give 66-84 dwarves. One
  run proves little; the protocol's 3-replicate rule is necessary, and the mean of 3 still carries
  an SE of ~5 dwarves. Reducing this variance (more episodes, better action design) is itself a goal.
- The recipe reliably beats the no-AI game (+31% pooled) but reliably loses to the fixed gov:0 rule
  (-21 dwarves on average): the trained policy has not learned the governor switches (D1).
- The weakest scenario is `compound_crisis`, where the trained policy is worse than default.

