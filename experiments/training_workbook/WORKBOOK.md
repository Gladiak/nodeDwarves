# Training Workbook: quality per minute on Apple M4 Pro

Living notebook for PPO training-process experiments. It records what was measured on
2026-11-23 and the prioritized tests that remain to raise the quality gained per minute of
training. Fill the result tables and the decision log as tests are run.

- Machine: Apple M4 Pro, 12 cores (8 performance + 4 efficiency), 24 GB.
- Branch at the time of writing: `ai/critic-and-factored-observations`.
- Start policy for the recorded evidence: `models/policy_best.json` at commit `cfd9ac6`
  (canonical score 4.3008, ~28 PPO updates / 1,108 Adam steps after `--fresh`).
- Raw data for every number below: [`evidence/2026-11-23_rounds1-2.json`](evidence/2026-11-23_rounds1-2.json)
  (per-episode scores, timings, final PPO diagnostics).

---

## 1. How to run a test session

All tools live in this folder and never write to `models/`; `exp_run.js` hashes `models/` before
and after each run and fails loudly if anything changed. Session output goes to
`experiments/training_workbook/runs/<session>/` (git-ignored).

1. Pick a session name (one per start policy), e.g. `S=experiments/training_workbook/runs/2026-12-01`.
2. Freeze the configs and the start policy and create the paired baselines:

```bash
node experiments/training_workbook/exp_run.js --out experiments/training_workbook/runs/2026-12-01 --name smoke --rep 1 --foundation-episodes 16 --no-finetune
```

```bash
.venv/bin/python experiments/training_workbook/eval_paired.py --policy experiments/training_workbook/runs/2026-12-01/start.json --config experiments/training_workbook/runs/2026-12-01/configs/config_canonical_promote.json --out experiments/training_workbook/runs/2026-12-01/eval_start.json
```

```bash
.venv/bin/python experiments/training_workbook/eval_paired.py --policy experiments/training_workbook/runs/2026-12-01/start.json --config experiments/training_workbook/runs/2026-12-01/configs/config_endgame.json --max-steps 10000 --episodes 12 --out experiments/training_workbook/runs/2026-12-01/long_start.json
```

3. Run a variant replicate, then evaluate it (repeat for `--rep 1..3`):

```bash
node experiments/training_workbook/exp_run.js --out experiments/training_workbook/runs/2026-12-01 --name f1280 --rep 1 --foundation-episodes 1280
```

```bash
.venv/bin/python experiments/training_workbook/eval_paired.py --policy experiments/training_workbook/runs/2026-12-01/f1280_r1/p.json --config experiments/training_workbook/runs/2026-12-01/configs/config_canonical_promote.json --out experiments/training_workbook/runs/2026-12-01/f1280_r1/eval_final.json
```

4. Summarize (`--ref` gives head-to-head deltas against one variant):

```bash
python3 experiments/training_workbook/analyze.py --out experiments/training_workbook/runs/2026-12-01 --ref f640
```

`exp_run.js` options: `--foundation-episodes`, `--difficulty-ramp` (default 0.75 x episodes),
`--entropy-ramp <n|run>`, `--entropy-final`, `--chain k` (repeat the recipe k times, resuming),
`--no-finetune`, `--set <foundation|finetune|all>:--flag=value`, `--workers` (default 7).
Training seeds are `7000 + rep*1000 + phaseIndex*101 + link*37`, so replicate `r` of different
variants shares seeds (paired training noise).

Rules of thumb:
- Keep the machine otherwise idle; never run `npm test` or benchmarks alongside a session.
- A new start policy means a new session folder: deltas are only comparable within a session.
- Always run the `f640` reference (current `m4-pro`) in the same session as new variants.

## 2. Measurement protocol and decision rules

- Canonical eval: 24 episodes (2 per eval scenario), 1,800 steps x 2 ticks, difficulty 1.0,
  seed base 100000, score `rpt` (reward per tick). Takes ~30 s with 7 parallel workers.
- Long-horizon eval: 12 episodes on the endgame config, 10,000 steps x 2 ticks (20,000 ticks), ~3 min.
- Deltas are paired by eval seed. Replicates are pooled episode-by-episode before pairing.
- Noise reference (E3): per-episode SD 0.23; paired SE of one replicate ~0.03-0.04; between-replicate
  SD of a variant's delta ~0.03-0.05.
- Decision rule used so far: adopt a change when (a) the pooled paired delta vs the reference is
  positive with z >= 1.4, (b) it is positive in every replicate or follows a monotone dose-response,
  and (c) it does not cost more time per unit of gain. Treat |z| < 1 as "no effect".
- Minimum: 3 replicates per variant. Use 5 when the expected effect is below +0.02.

---

## 3. Evidence collected (2026-11-23)

### E1. Throughput bottleneck is the JS simulation
- Before optimization, environment stepping was ~95% of training time; Python<->Node IPC and PPO
  updates were each <1%. PPO on GPU (MPS), JAX or MLX would not help; a 2x128 MLP is faster on CPU.
- Bit-identical optimizations (per-tick config memo, allocation-free path field BFS, Story Director
  repair skip inside a tick): canonical benchmark 35.8 -> 128.6 ticks/s, 0 metric differences on
  4 seeds x 8,000 ticks, matching per-response hashes across scenarios and a 20,000-tick endgame run.
- Remaining per-step cost split (foundation, 7 workers): env ~2.3 ms, Python worker overhead ~0.3 ms
  (~11%).
- A full Rust port was rejected: ~52k lines and two simulations to keep tick-identical.

### E2. Worker scaling on M4 Pro
Aggregate env throughput by parallel simulations: 1: 246, 4: 875, 6: 1,148, 8: 1,230,
10: 1,276 steps/s. Saturation starts around 7 (shared memory bandwidth, slower E-cores).
`m4-pro` uses 7 workers per phase.

### E3. Canonical eval noise
- Start policy: mean 4.2987, per-episode SD 0.2313 over 24 episodes.
- Underrealm scenarios score systematically lower (3.79-4.09) than the rest (~4.2-4.6).
- With 12 episodes (one per scenario) the paired-LCB gate needs roughly +0.08 to promote; with 24
  episodes roughly +0.06. Real per-run gains of +0.03 are usually rejected.

### E4. Decision cadence mismatch is negligible today
The game decides every `ai.stepTicks = 5` ticks; training and promotion use 2. Holding actions for
5 instead of 2 ticks: -0.0199 per-tick score (-0.23%, 95% CI [-0.155, +0.115]). Not significant;
the young policy changes actions slowly. Revisit when the policy matures.

### E5. The 20,000-tick endgame phase did not pay off
- Old `m4-pro` (foundation 160 + finetune 50 + endgame 8x10,000 steps): endgame = ~60% of
  training time (189-227 s of ~320-417 s) for 2 PPO updates.
- Canonical: full run -0.001 vs start (z -0.03); stopping before endgame +0.005 (z 0.15).
- Long horizon (20,000 ticks, 2 replicates): with endgame -0.064 vs start, without -0.024;
  endgame vs no endgame -0.040 (z -1.61), consistent in both replicates.
- Action taken: endgame removed from `m4-pro`; `npm run ai:train -- endgame` remains available.

### E6. Curriculum ramp removal: no effect
Foundation at fixed difficulty 1.0 vs ramp 0.12 -> 1.0: +0.009 vs base (z 0.49); replicates
-0.042, +0.028, +0.038.

### E7. Gains scale with foundation length (dose-response)
| Foundation episodes | Pooled delta vs start | Replicates | Train time |
|---|---|---|---|
| 160 (+ finetune) | +0.005 (z 0.15) | -0.019, -0.015, +0.048 | 2.3 min |
| 320 (+ finetune) | +0.031 (z 1.14) | +0.031, +0.031, +0.030 | 3.6 min |
| 640 (+ finetune) | +0.059 (z 1.67) | +0.070, +0.048, +0.058 | 6.2 min |

640 vs 320: +0.028 (z 1.46). Gain per training minute stays ~0.009 (no saturation yet).
Action taken: `m4-pro` foundation = 640 episodes (difficulty ramp 480).

### E8. Entropy keeps rising; lowering the coefficient did not help
- Final policy entropy grows with foundation length: start ~18.4, 320 eps -> 19.3, 640 eps -> 20.2.
  The foundation entropy coefficient stays ~0.008 because `entropyRampEpisodes` is 15,000.
- Foundation entropy 0.003 -> 0.002 (320 episodes): +0.014 vs start, -0.016 vs 320 baseline (z -0.98);
  replicates +0.057, +0.019, -0.033. Entropy stayed flat (18.7) but scores did not improve.

### E9. More PPO epochs do not help
5 epochs instead of 3 (320 episodes): +0.028 vs start, -0.002 vs baseline (z -0.12); PPO update
time +60%, clip fraction 0.20-0.26, KL 0.013-0.018.

### E10. Short-horizon training slowly erodes long-horizon play
After foundation + finetune only, the long-horizon score drops -0.024 vs start (z -1.4, 2 replicates).
The canonical gate (3,600 ticks) cannot see this; `npm run ai:validate:weekly` is the guard.

### E11. Current `m4-pro` recipe and cost
Foundation 640 + finetune 50, 7 workers each, final 24-episode canonical check with parallel eval
and cached best-policy result. Expected wall time ~6.5-7 min per run (foundation ~5.3 min,
finetune ~0.7 min, promote ~0.5-1 min).

### E12. First production run of the new `m4-pro` (2026-11-23 22:29-22:37)
`npm run ai:train:m4pro` (run folder `debug/run_1795469381305_98869_970601`, git-ignored):
- Wall time ~8 min end to end (foundation 640 at 105 episodes/min, env 2.09 ms/step; finetune 50).
- Canonical (24 episodes): latest 4.3478 vs best 4.2987, paired delta +0.049 (SE 0.039),
  LCB -0.028 -> best retained. Matches E7 (+0.059 expected) and the gate limit in E3
  (~+0.077 needed at this SE). Training continues from `models/policy.json` on the next run.
- First best-policy eval populated `.cache/promote_eval_cache.json`; later runs reuse it while the
  best policy, sources and eval settings are unchanged.

### PPO health snapshot (typical end of phase)
Foundation: KL 0.013-0.017, clip fraction 0.19-0.24, explained variance 0.89-0.98.
Finetune: KL 0.006-0.007, clip fraction 0.07-0.10, explained variance 0.95-0.99. No early stops.

---

## 4. Open hypotheses

- H1. Gains keep growing beyond 640 foundation episodes but with diminishing returns (concave curve).
- H2. In a fixed 30-35 min budget, fewer longer runs beat many 640-episode runs: less fixed overhead
  (~25% -> ~5-7%), one LR annealing instead of a saw-tooth, larger steps that pass the gate.
- H3. In long runs, the rising entropy becomes harmful; tying the entropy ramp to the run length
  (0.008 -> 0.002 over the foundation) recovers the gain lost to exploration noise.
- H4. In long runs, a difficulty ramp proportional to length (75%) wastes data on easy levels;
  a capped ramp (~480 episodes) is at least as good.
- H5. Longer short-horizon training accelerates long-horizon erosion (E10); a small long-horizon
  component will be needed.
- H6. Python worker overhead (~11%) can be removed by batching several envs per Python worker.

## 5. Test backlog (priority order)

Budget estimates assume an idle machine: foundation ~0.5 s per episode at 7 workers, finetune
~45 s, canonical eval ~30 s, long eval ~3 min. Run order: T1 -> T2 -> T3 -> T4.1 ... T4.5 -> T5/T6.

### T1. Scaling curve beyond 640 (H1)
- Variants: `f640` (reference), `f1280`, `f2560`; 3 replicates each.
- Commands: `--name f640 --foundation-episodes 640`, `--name f1280 --foundation-episodes 1280`,
  `--name f2560 --foundation-episodes 2560`; canonical eval each; long eval on replicates 1-2.
- Budget: ~6 + 12 + 23 min per replicate set = ~2.1 h + evals (~25 min).
- Read-out: gain per minute for each length. Concavity starts where gain/min drops >25% vs `f640`.
- Decision: the longest length whose gain/min is within 20% of `f640` becomes the candidate run length.

| Variant | Rep deltas | Pooled delta (z) | vs f640 (z) | Gain/min | Long delta | Entropy |
|---|---|---|---|---|---|---|
| f640 | | | - | | | |
| f1280 | | | | | | |
| f2560 | | | | | | |

### T2. Entropy ramp tied to run length (H3)
- Run at the T1 candidate length L (or 1280 if T1 is not done yet).
- Variants: `fL` (reference) vs `fL_ent` = `--foundation-episodes L --entropy-ramp run --entropy-final 0.002`.
- Budget: 3 replicates x 2 variants x L/2 s.
- Decision: adopt if pooled delta vs `fL` >= 0 with z >= 1.4, or equal score with final entropy
  <= start entropy (stability benefit at no cost).

| Variant | Rep deltas | Pooled delta (z) | vs fL (z) | Final entropy |
|---|---|---|---|---|
| fL | | | - | |
| fL_ent | | | | |

### T3. Capped difficulty ramp (H4)
- At length L with the T2 winner: `--difficulty-ramp 480` vs default (0.75 x L).
- Decision: adopt the cap if not worse (z > -1) and faster convergence is visible in the train log,
  because it puts more data at the eval difficulty.

| Variant | Rep deltas | Pooled delta (z) | vs reference (z) |
|---|---|---|---|
| fL (+T2) | | | - |
| fL_cap480 | | | |

### T4. Equal wall-clock: one long run vs chained runs (H2), in five steps
Question: with ~30 min of training, is it better to chain 640-episode runs (today's habit), run two
1,500-episode runs, or one 3,000-episode run? T4 is split so that every step is useful on its own,
can run on a different day, and can stop the test early.

How the steps fit together:
- All steps use the **same session folder** (the frozen `start.json` keeps them comparable even if
  `models/` changes between days). Create it as in section 1 if it does not exist yet.
- Chained variants save a snapshot after every link (`p_after_c<link>_1.json`, link 0-based, `1` =
  finetune phase). Evaluating each snapshot as `eval_link<k>.json` (k 1-based) turns every chained
  replicate into a learning curve; `analyze.py` prints it with cumulative training minutes and an
  estimated production wall time (+1 min per link for promote and start-up, `--link-overhead-min`).
- Comparisons are made at **matched production minutes** (about 14 and 28 min), not at matched
  episode counts.
- Append the T2/T3 winning flags (for example `--entropy-ramp run --entropy-final 0.002
  --difficulty-ramp 480`) to every `exp_run.js` command of every step; never change them mid-T4.
- Each step may start with replicate 1 only (pilot) and add replicates 2-3 later.

Timing assumptions (idle machine, 7 workers): foundation ~0.5 s per episode, finetune ~0.7 min,
canonical eval ~0.5 min, long eval ~3 min.

#### T4.1 Chained short runs: `short5` (baseline curve)
- Recipe: `--foundation-episodes 640 --chain 5`. Curve points at ~7, 14, 21, 28, 35 production min.
- Cost: ~33 min per replicate (30 train + 5 evals); 3 replicates ~1.7 h.
- Standalone value: shows whether chaining keeps gaining linearly, where the curve bends, and how
  often a single link would pass the promotion gate.

```bash
for r in 1 2 3; do node experiments/training_workbook/exp_run.js --out experiments/training_workbook/runs/2026-12-01 --name short5 --rep $r --foundation-episodes 640 --chain 5; done
```

```bash
for r in 1 2 3; do for k in 1 2 3 4 5; do .venv/bin/python experiments/training_workbook/eval_paired.py --policy experiments/training_workbook/runs/2026-12-01/short5_r$r/p_after_c$((k-1))_1.json --config experiments/training_workbook/runs/2026-12-01/configs/config_canonical_promote.json --out experiments/training_workbook/runs/2026-12-01/short5_r$r/eval_link$k.json; done; done
```

| Link | Prod min | Pooled delta (z) | Gain/prod min | Links passing gate (of 3) |
|---|---|---|---|---|
| 1 | ~7 | | | |
| 2 | ~14 | | | |
| 3 | ~21 | | | |
| 4 | ~28 | | | |
| 5 | ~35 | | | |

#### T4.2 Two medium runs: `long2` (first head-to-head)
- Recipe: `--foundation-episodes 1500 --chain 2`. Curve points at ~14 and ~28 production min.
- Cost: ~28 min per replicate; 3 replicates ~1.4 h.
- Read-out: `long2` link 1 vs `short5` link 2 (~14 min), `long2` link 2 vs `short5` link 4 (~28 min).

```bash
for r in 1 2 3; do node experiments/training_workbook/exp_run.js --out experiments/training_workbook/runs/2026-12-01 --name long2 --rep $r --foundation-episodes 1500 --chain 2; done
```

```bash
for r in 1 2 3; do for k in 1 2; do .venv/bin/python experiments/training_workbook/eval_paired.py --policy experiments/training_workbook/runs/2026-12-01/long2_r$r/p_after_c$((k-1))_1.json --config experiments/training_workbook/runs/2026-12-01/configs/config_canonical_promote.json --out experiments/training_workbook/runs/2026-12-01/long2_r$r/eval_link$k.json; done; done
```

Stop rules after T4.2:
- `long2` worse than `short5` at both matched points (z <= -1): **stop T4**, keep chaining 640-episode
  runs, skip T4.3 and go to T4.4 with `short5` only.
- `long2` better at both points (z >= 1.4): longer runs confirmed; T4.3 decides between 1 and 2 runs.
- Anything else: add 2 replicates to T4.1 and T4.2 before deciding.

| Matched point | short5 pooled (z) | long2 pooled (z) | long2 - short5 (z) |
|---|---|---|---|
| ~14 min | | | |
| ~28 min | | | |

#### T4.3 One long run: `long1` (only if T4.2 favors longer runs)
- Recipe: `--foundation-episodes 3000` (single link). Point at ~27 production min.
- Cost: ~26 min per replicate; 3 replicates ~1.3 h.
- Read-out: `long1` vs `long2` link 2 and vs `short5` link 4 at ~28 min.
- Decision: choose `long1` only if it beats `long2` with z >= 1.4; otherwise prefer `long2`, whose
  intermediate checkpoint protects against a mid-run collapse.

```bash
for r in 1 2 3; do node experiments/training_workbook/exp_run.js --out experiments/training_workbook/runs/2026-12-01 --name long1 --rep $r --foundation-episodes 3000; done
```

```bash
for r in 1 2 3; do .venv/bin/python experiments/training_workbook/eval_paired.py --policy experiments/training_workbook/runs/2026-12-01/long1_r$r/p.json --config experiments/training_workbook/runs/2026-12-01/configs/config_canonical_promote.json --out experiments/training_workbook/runs/2026-12-01/long1_r$r/eval_link1.json; done
```

| Variant at ~28 min | Pooled delta (z) | vs long2 (z) | vs short5 (z) |
|---|---|---|---|
| long1 | | | |
| long2 (link 2) | | - | |
| short5 (link 4) | | | - |

#### T4.4 Long-horizon guard on the finalists
- Long eval (20,000 ticks) of the final policy of the winner and the runner-up, every replicate.
- Cost: ~3 min per policy; up to ~20 min.
- Feeds T5: a finalist whose long delta is <= -0.05 vs start cannot win on canonical score alone.

```bash
for r in 1 2 3; do .venv/bin/python experiments/training_workbook/eval_paired.py --policy experiments/training_workbook/runs/2026-12-01/long2_r$r/p.json --config experiments/training_workbook/runs/2026-12-01/configs/config_endgame.json --max-steps 10000 --episodes 12 --out experiments/training_workbook/runs/2026-12-01/long2_r$r/long_final.json; done
```

(Repeat with `short5` or `long1` in place of `long2` for the other finalist.)

| Finalist | Long delta per replicate | Pooled long delta (z) |
|---|---|---|
| | | |
| | | |

#### T4.5 Decide and apply
- Summarize with `python3 experiments/training_workbook/analyze.py --out experiments/training_workbook/runs/2026-12-01 --ref short5`.
- Winner = best gain per production minute at ~28 min that also passes T4.4.
- Apply: set `M4_PRO_FOUNDATION_EPISODES` (and the matching ramp) in `scripts/train_wrapper.js`,
  update its contract in `scripts/test_training_contracts.js`, README/MANUAL, and the decision log.
- If the winner is a chain of runs, document the recommended number of consecutive runs per session.

### T5. Long-horizon guard for the winning recipe (H5)
- Long eval (20,000 ticks) of the T4 winner vs start.
- Decision: if long delta <= -0.05 (or z <= -2), design T6; otherwise keep the recipe and rely on
  `npm run ai:validate:weekly`.

### T6. Long-horizon component, only if T5 fails
Candidate designs (test one at a time against the T4 winner, 3 replicates, canonical + long eval):
- a short endgame finetune: 2 episodes x 10,000 steps at low LR after the finetune;
- longer foundation episodes for a fraction of the run (`--set foundation:--max-steps=2500`);
- higher discount for the same tick horizon (`--set all:--gamma=0.997`).
Decision: adopt only if the long delta improves by >= +0.03 with a canonical loss within -0.01.

### T7. Gate calibration (cheap, analysis only)
Using T1-T4 data, estimate the gate's power for 24 vs 36 eval episodes; adopt 36 only if the
expected per-run gain is below ~+0.08 and wrong rejections dominate.

### T8. Engineering backlog (no gameplay change; verify bit-identical as in E1)
- Batch several envs per Python worker (H6, expected ~10% throughput).
- Re-profile `ai_server.js` steps after each change; path fields and build placement were the next
  hotspots (~15-18% together).

### T9. Cadence alignment (low priority, E4)
When the policy is clearly stronger than today, repeat the hold test (`eval_paired.py --hold 2` vs
`--hold 5`). If the loss exceeds 1% and is significant, align `ai.stepTicks` in game to 2.

---

## 6. Decision log

| Date | Test | Result | Decision | Commit |
|---|---|---|---|---|
| 2026-11-23 | E5 | Endgame phase: 60% of time, long horizon -0.040 (z -1.61) | Removed from `m4-pro` | |
| 2026-11-23 | E7 | 160/320/640 episodes: +0.005/+0.031/+0.059 | `m4-pro` foundation = 640 | |
| 2026-11-23 | E8, E9 | Lower entropy, 5 epochs: no gain | Not adopted | |
| 2026-11-23 | E12 | First real `m4-pro` run: +0.049, gate retained best | Keep chaining runs; see T4/T7 | |
| | | | | |
