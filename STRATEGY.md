# NodeDwarves Strategy: State of the Art, Evidence and Plan

The single source of truth for simulation quality, training quality, measurements and the step plan.
Every change to difficulty, reward, action/observation design or the training recipe is measured
with the protocol in section 6 and recorded here (section 8). `README.md` describes the product;
`AGENTS.md` holds contributor rules. No other Markdown is kept in the repository.

Status date: 2026-11-24.

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
- Observation: 73 named features in a 79-value factored vector (`src/ai/observation_layout.js`),
  including clan shares, social and warrior signals; no direct signal for food autonomy, time to
  winter, birth gating or the age structure.
- Decisions every 2 ticks in training and promotion (5 in the interactive game).

### 2.3 Training

- PPO, 2x128 MLP, JSON weights for JS inference (`src/ai/policy.js`).
- Reward (`src/ai/outcome_reward.js`, weights in `ai.reward`): population per 100 dwarves every step,
  -2 per avoidable death (starvation, raids, deep raids, ruins, hunts, Warrior League; not old age),
  -1 x share of dwarves with hunger or thirst >= 0.6, +0.3 x food/water reserve per dwarf (2 units =
  full), +20 per Underrealm depth, +5 per landmark stage, +0.2 per prestige point, -20 on extinction.
- Recipe `m4-pro`: foundation 640 episodes of 1,400 steps x 2 ticks (2,800 ticks) with a difficulty
  ramp, finetune 50 episodes, 7 workers, gamma 0.998 (~1,000-tick horizon), ~6 minutes on an M4 Pro.
- Promotion gate: 24 games x 8,000 ticks, `rpp` score (reward per planned tick, so an early
  extinction scores zero for the ticks it did not live), paired lower confidence bound > 0.
- Production artifacts are stale: `models/policy_best.json` and `models/policy.json` were trained
  on the old, easy game; `regression/baselines/` describes that game too. Model-quality reports were
  removed and are regenerated in S8.

### 2.4 Measurement tooling (`experiments/`, outputs in git-ignored `experiments/runs/`)

| Tool | Purpose | Cost |
|---|---|---|
| `challenge_probe.js` | In-process scorecard: synthetic players (`default`, `const:X`, `random`, `neglect`, `gov:X`) and trained ones (`policy:<file>`, the game's JS inference), stock flows, reserve autonomy, labor mix, deaths, outcome-reward score, progress (max Underrealm depth, landmark stages, prestige); `--set path=value` A/B on the effective config; `--plan eval` or `standard` | 48 games x 8,000 ticks in ~3 min |
| `eval_paired.py` | Paired evaluation of real policies through `ai_server.js` (`--outcomes` adds population, deaths by cause, `rpp`) | 24 games x 8,000 ticks in ~3 min |
| `exp_run.js` | Isolated training variants (`--fresh-start`, `--chain k`, `--set phase:--flag=value`, `--freeze-only`); never writes `models/` | ~6 min per run |
| `leverage_probe.py` | One governor group at an extreme vs default | ~1 h |
| `analyze.py` | Paired summary of `exp_run.js` variants | seconds |

Bit-identity checks (E17-E19): `challenge_probe.js` reproduces `eval_paired.py` for default and
constant players and the cached benchmark rows for the standard game.

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
model (R) so the next changes land on a small, visible core, settle the game (S3), then rebuild the learning stack (S4-S6), scale (S7) and ship (S8). The steward comes first
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

S4b action space v2. Expose the levers that pass S4a as a handful of heads at strategic cadence
(S5), discrete where the decision is discrete (Bernoulli or ordinal heads) and initialized to the
steward posture; the policy may act as a residual on top of the steward. Remove the heads that are
not levers (festival, building weights, contracts, warriors, social and the inert governor biases).

Pass: every exposed lever moves an outcome with |z| >= 2 in the leverage probe; trained policy beats
steward by >= 10% final population with z >= 2 (48 games, 3 replicates); worse than steward in at
most 3 of 12 scenarios; fewer action heads than today (29).

### S5. Decision cadence and full-horizon training (D3, D4, fresh training)
- One cadence for training, gate and game; sweep 10, 20 and 40 ticks per decision; foundation
  episodes of 8,000 ticks; gamma per decision set for a ~1,000-1,500-tick horizon.
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

### S6. Observation v2 (D5, fresh training)
- Add food/water autonomy in ticks, ticks to the next winter, reserve per dwarf vs the birth
  requirement, a births-blocked flag, the age structure (child, fertile-adult and old-age shares,
  mean age of fertile adults, births in the last year, growth budget), deep-raid threat vs defense.
  Remove features with no permutation importance; keep the vector no larger than today (79).
- Pass: critic explained variance >= 0.95 on 8,000-tick episodes; +5% population vs S5 with z >= 2.

### S7. Scale and curriculum
- Dose-response on foundation length (640, 1,280, 2,560 episodes) and a scenario mix weighted toward
  scenarios where the policy trails the steward.
- Pass: gain per training minute stays positive up to the chosen budget; the official gate promotes
  (LCB > 0) against the previous best.

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
node experiments/exp_run.js --out experiments/runs/<session> --freeze-only
```

```bash
node experiments/challenge_probe.js --plan eval --config $S/configs/config_endgame.json --players default,gov:0,random,neglect --episodes 24 --ticks 8000 --workers 8 --out $S/scorecard.json
```

```bash
node experiments/challenge_probe.js --plan standard --players default --ticks 8000 --workers 4 --out $S/standard.json
```

```bash
node experiments/challenge_probe.js --report $S/scorecard.json $S/standard.json
```

```bash
node experiments/exp_run.js --out $S --name <variant> --rep 1 --fresh-start --chain 2 --set all:--gamma=0.998
```

```bash
.venv/bin/python experiments/eval_paired.py --policy $S/<variant>_r1/p.json --outcomes --config $S/configs/config_endgame.json --max-steps 4000 --episodes 24 --workers 8 --out $S/eval_<variant>.json
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
| Reward | `ai.reward.*` | population 1 per 100, deaths 2, distress 1 at 0.6, reserves 0.3 at 2 per dwarf, depth 20, landmark stage 5, prestige 0.2, extinction 20 |
| Gate | `ai.training.promotion.canonical` | 24 games, 4,000 steps x 2 ticks, `rpp`, LCB z 1.96 |
| Trainer | `ai.training.trainer` | gamma 0.998, 2 ticks per step, 2x128 |
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
| next | S4a | Lever audit with growth rate and guard share first; every lever judged at 8,000 and 20,000 ticks |

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

