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
`neglect` < `default` < `steward` (S3) < trained policy, with the trained-minus-steward gap
growing run after run.

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
| `challenge_probe.js` | In-process scorecard: synthetic players (`default`, `const:X`, `random`, `neglect`, `gov:X`), stock flows, reserve autonomy, labor mix, deaths, outcome-reward score; `--set path=value` A/B on the effective config; `--plan eval` or `standard` | 48 games x 8,000 ticks in ~3 min |
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
tick, 7 workers); the same simulation in-process costs ~0.48 ms per tick (8 workers). About half of
the env time is per-decision work (metrics, observation, reward, JSON), not simulation.

---

## 4. Diagnosis: what limits quality today

Ranked by expected impact.

- **D1. Inert and binary action space (E15, E16, E19).** 29 heads, 4 groups with no measured
  leverage. Most governor intents are on/off thresholds whose default is "on", while a continuous
  Gaussian head starts near the middle of the range. The policy beats the no-AI game by ~45% but not
  the trivial "all governors off" rule (83 vs 96 dwarves): it has not learned the main switches.
- **D2. Weak reference strategy.** The no-AI posture (every governor on) is worse than random under
  scarcity (default 57 vs gov:0 96). Gains are measured against a strawman, and `npm start` players
  watch a needlessly poor colony.
- **D3. Decision cadence and credit assignment.** One decision every 2 ticks means 4,000 decisions in
  a gate game, while consequences (famines, aging, raids) unfold over hundreds to thousands of ticks.
  The per-decision overhead also costs about half of the env time.
- **D4. Horizon mismatch.** Foundation episodes last 2,800 ticks; the gate judges 8,000. Founder
  infertility (from ~4,300 ticks) and old age (5,200-7,600) are never seen in training (E10).
- **D5. Observation misses the signals that predict outcomes.** No food/water autonomy, time to
  winter, reserve vs birth requirement, birth gating or age structure; many low-value features
  (clan shares, social, warrior details).
- **D6. Simulation fairness and depth.** Founders share one age window (180-700 ticks), so the
  colony hits a synchronized demographic cliff; progress systems were tuned for 600+ dwarves and
  now rarely fire; deep raids kill without a decision that can prevent them.
- **D7. Evaluation cost and noise.** Real policies are evaluated through Python IPC; the paired SE
  of a population delta is ~7 dwarves at 24 games, so gains below ~15% are hard to confirm. The JS
  inference path used by the game is not used for evaluation.
- **D8. Stale production state.** Production policy, regression baselines and model reports refer to
  the old game.

---

## 5. Step plan

Order: measure (S0-S1), settle the game (S2) because every simulation change invalidates trained
policies, define "good" with a strong rule (S3), then rebuild the learning stack (S4-S6), scale
(S7) and ship (S8). Each step changes one thing, uses the protocol in section 6, and is accepted
only when its pass criteria hold. If a step fails its criteria twice, revert it and record why.

### S0. Freeze scorecard v1 (measurement only, ~1 h)
- Freeze a session from the current config; run the scorecard for `default`, `gov:0`, `random`,
  `neglect` on 24 games x 8,000 ticks, the standard game (4 seeds x 8,000 and x 20,000 ticks), and
  3 fresh training replicates of the current recipe, each evaluated on the same 24 games.
- Pass: scorecard v1 recorded in section 8 with means and replicate SD (current guess: replicate
  spread ~4 dwarves, paired SE ~7).

### S1. Fast native policy evaluation (D7)
- Add a `policy:<file>` player to `challenge_probe.js` using `src/ai/policy.js` (the game's own
  inference), so real policies run in-process like synthetic players.
- Pass: on the S0 games, mean population within one paired SE of `eval_paired.py` and the same
  win/loss sign vs default in >= 80% of games; >= 3x faster. Afterwards every decision uses 48 games
  (seeds 100000-100047), cutting SE by ~30%.

### S2. Simulation fairness and earned progress (D6)
One sub-change at a time, each A/B'd with `--set` before it becomes a default:
- S2a founders: spread founding ages and fertility windows (config-driven jitter) so the colony
  ages continuously.
- S2b progress pacing: Underrealm depth and landmark stages reachable by good play in the tight
  economy (requirements scaled to the colony, not to 600-dwarf settlements).
- S2c deep-raid counterplay: a defense or guard decision with measurable effect on deep-raid deaths.
- Pass (scorecard, 48 games): default median drawdown between 4,000 and 8,000 ticks <= 25%
  (today ~37%); default extinctions <= 1/48 at 8,000 ticks and <= 3/48 at 20,000; neglect at least
  50% below default; good play (gov:0 or steward) reaches median Underrealm depth >= 1 by 8,000
  ticks; the leverage probe shows the new defense decision moving deep-raid deaths with |z| >= 2.

### S3. Steward reference strategy (D2)
- A config-driven, state-aware no-AI posture: risky governors (ruins dispatch, Underrealm push,
  external camps, trade contests) switch on only when food and water autonomy and population pass
  thresholds; job weights lean toward stockpiling before winter.
- Pass: steward >= gov:0 on final population and avoidable deaths (paired, 48 games), no extinctions
  at 8,000 ticks, standard game not worse than today's default. It becomes the `npm start` default
  and the reference every trained policy must beat.

### S4. Action space v2 (D1, fresh training)
- Keep only heads with leverage: 4 job weights, Underrealm allocation, ruins dispatch, external
  camps, trade. Delegate festival, building, contracts, warriors and social to steward rules.
- Make on/off intents discrete (Bernoulli heads) initialized to the steward posture; optionally act
  as a residual on top of the steward so the untrained policy already plays well.
- Pass: every kept head moves an outcome with |z| >= 2 in the leverage probe; trained policy beats
  steward by >= 10% final population with z >= 2 (48 games, 3 replicates); worse than steward in at
  most 3 of 12 scenarios.

### S5. Decision cadence and full-horizon training (D3, D4, fresh training)
- One cadence for training, gate and game; sweep 10, 20 and 40 ticks per decision; foundation
  episodes of 8,000 ticks; gamma per decision set for a ~1,000-1,500-tick horizon.
- Pass: Node env time per simulated tick down >= 40% (from ~1.15 ms); equal or better result at equal
  wall-clock; improvement per run: 3 chained runs where each run is >= the previous minus one SE and
  run 3 beats run 1 by >= 5% population with z >= 2.

### S6. Observation v2 (D5, fresh training)
- Add food/water autonomy in ticks, ticks to the next winter, reserve per dwarf vs the birth
  requirement, a births-blocked flag, old-age and fertile-adult shares, deep-raid threat vs defense.
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
- Simulation changes: 4 players (`default`, `gov:0` or steward, `random`, `neglect`), >= 24 games
  (48 after S1), 8,000 ticks; a 20,000-tick check only when a change affects aging or long cycles.
- Training changes: 3 fresh replicates, each evaluated on the same games; adopt when the pooled delta
  on final population (primary) or `rpp` has z >= 2, avoidable deaths and extinctions do not worsen
  beyond one SE, and wall-clock per unit of gain does not grow.
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
| Reward | `ai.reward.*` | population 1 per 100, deaths 2, distress 1 at 0.6, reserves 0.3 at 2 per dwarf, depth 20, landmark stage 5, prestige 0.2, extinction 20 |
| Gate | `ai.training.promotion.canonical` | 24 games, 4,000 steps x 2 ticks, `rpp`, LCB z 1.96 |
| Trainer | `ai.training.trainer` | gamma 0.998, 2 ticks per step, 2x128 |

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
| next | S0 | Freeze scorecard v1 |
