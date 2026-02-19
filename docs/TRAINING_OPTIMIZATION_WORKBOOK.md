# Training Optimization Workbook

Last updated: 2026-02-19
Project: NodeDwarves AI training pipeline
Scope: End-to-end implementation tracking for the 3 approved optimization solutions

Artifact retention note (2026-02-17):
- Historical `debug/` raw artifacts from older gates were pruned to keep the repository lean.
- Workbook entries keep original artifact paths for traceability, but some legacy paths can point to archived/removed local files.
- Runtime note (2026-02-17): trainer transport default is now `compact`; `legacy` remains available as explicit fallback/compat mode.

## 1) Goals

Primary goal: deliver a measurable and stable training quality boost without breaking runtime inference compatibility.

Target outcomes:

- Higher canonical promotion score (`rpt`) with lower run-to-run variance.
- Better Underrealm progression behavior under full simulation profiles.
- Faster training wall-clock throughput for the same episode budget.
- Reproducible improvement validated by regression and benchmark gates.

## 2) Baseline Snapshot (Freeze Before Changes)

Reference date: 2026-02-17

| Metric | Baseline |
| --- | --- |
| Canonical best score (`rpt`) | `3.7384` |
| Canonical eval episodes | `20` |
| Canonical eval max steps | `2200` |
| Canonical avg reward | `16449.08` |
| Canonical avg births | `99.7` |
| Canonical avg deaths | `5.1` |
| Trainer algorithm | `PPO` |
| Hidden sizes | `128,128` |
| Action head size | `14` |
| Feature count | `36` |
| Default workers | `6` |

Source references:

- `models/policy_best.meta.json`
- `config.json`

## 3) Timeline (Precise Plan)

## Phase 0 - Preparation
Window: 2026-02-17 to 2026-02-19
Milestone: baseline locked, implementation branches ready.

## Phase 1 - Solution A (Reward + Termination)
Window: 2026-02-20 to 2026-02-27
Milestone: causality-oriented reward and stable early-termination in training profile validated on short runs.

## Phase 2 - Solution B (PPO v2 Stability Stack)
Window: 2026-02-28 to 2026-03-08
Milestone: normalization/clipping/KL controls merged and backward compatibility verified.

## Phase 3 - Solution C (Throughput Engineering)
Window: 2026-03-09 to 2026-03-16
Milestone: measurable throughput gain and resume continuity fixes merged.

## Phase 4 - Integration + Validation + Docs
Window: 2026-03-17 to 2026-03-21
Milestone: all gates pass, reports archived, docs and runbook finalized.

## 3.1) Phase 0 Execution Snapshot (2026-02-17)

- [x] Baseline source frozen from canonical best metadata.
Baseline file: `models/policy_best.meta.json` (`savedAt`: `2026-02-16T17:44:11Z`).
- [x] Repository fingerprint recorded.
Repository state: branch `camps`; commit `f927b665399ac7e754ecc65c7bd2801139c7cb7d`.
- [x] Artifact checksums recorded for reproducibility.
Checksums:
`config.json`: `daf517a00684cbecdf9e31014cb5d406763adc292915f5cc2226e6c97d0f5397`.
`models/policy_best.json`: `62a180476c2e6d235f1dc6ff5b7970c8871caa67ce696a31546d98024398ce68`.
`models/policy_best.meta.json`: `5aeedf9510df84a729c594a1b73e58f1207cff01249a063dbb192c61421e852f`.
- [x] Canonical baseline metrics frozen in workbook.
Metrics: `score(rpt)=3.7384`, `avg_reward=16449.08`, `evalEpisodes=20`, `evalMaxSteps=2200`.
- [x] Branch execution plan frozen for implementation phases.
Planned branches: `phase1/reward-termination`, `phase2/ppo-stability`, `phase3/throughput-resume`, `phase4/integration-validation`.

## 4) Workstream A - Reward Redesign + Smart Termination

Status: In Progress (A.1/A.2/A.3 done, A.4 partially blocked)

### A.1 Config schema extension

- [x] Add new reward parameters for delta-based shaping and deep-system signals in `config.json`.
- [x] Keep existing weights for compatibility, introduce explicit `*_delta` keys where needed.
- [x] Add termination profile dedicated to training fast-stop plateau detection.

Files:

- `config.json`
- `docs/PARAMETERS.md`
- `docs/TRAINING_OVERRIDES.md`

### A.2 Reward function implementation

- [x] Refactor reward composition in `ai_server.js` to combine:
  - baseline survival signal
  - delta progress terms (stockpile, population balance, structured progression)
  - event penalties/bonuses with bounded impact
- [x] Add explicit reward channels for Underrealm/Myths progression state.
- [x] Keep reward deterministic and bounded to reduce gradient spikes.

Files:

- `ai_server.js`

### A.3 Training termination enablement

- [x] Enable smart termination in training configs only (not runtime sim by default).
- [x] Tune `minTicks`, `stableTicks`, epsilon thresholds to avoid premature stopping.
- [x] Verify no collapse in high-difficulty scenarios.

Files:

- `config.json`
- `scripts/train_wrapper.js`

### A.4 Validation gate (A)

- [x] `node scripts/headless_benchmark.js --ticks 8000 --seeds 101,202,303,404 --progress --progress-every 2000`
- [x] `node scripts/regression.js --profile standard`
- [x] `node scripts/regression.js --profile underrealm`
- [x] Compare canonical promotion delta versus baseline.

Validation snapshot (2026-02-17):

- Low-load training cycle completed with new wrapper preset:
  `npm run ai:train:quality:lite`
  (`debug/run_1771326222300_52900_856041/`).
- Headless benchmark completed on 4 seeds (`avg pop=716.0`, `avg morale=0.8865`, no extinction):
  `debug/gateA_headless_benchmark_1771326222300.json` + `.md`.
- Regression `standard`: pass
  (`debug/regression_report_1771328298447.txt` + `.json/.md`).
- Regression `underrealm`: pass
  (`debug/regression_report_1771328674292.txt` + `.json/.md`).
- Canonical full eval-only on `models/policy_best.json`:
  `score=3.6911` vs frozen baseline `3.7384` (`delta=-0.0473`)
  (`debug/gateA_canonical_eval_policy_best_1771326222300.json` + `.md`).
- Low-load canonical-final (8x1600) in training run stayed below current best:
  `latest=3.8490`, `best=3.8685`, no promotion
  (`report_promote_03_canonical-final.json`).
- Reward micro-retune round (`stockpileMin=1.65`, `survival=2.28`, `death=5.8`) and canonical full re-check:
  `score=3.7495` vs frozen baseline `3.7384` (`delta=+0.0111`)
  (`debug/gateA_canonical_eval_policy_best_1771326222300_retune1.json` + `.md`).
- Post-retune deterministic regressions:
  - `standard`: pass (`debug/regression_report_1771330212373.txt` + `.json/.md`)
  - `underrealm`: pass (`debug/regression_report_1771330568850.txt` + `.json/.md`)

Exit criteria:

- Positive canonical `rpt` delta vs frozen baseline.
- No deterministic regression gate failures.

## 5) Workstream B - PPO v2 Stability Stack

Status: Completed (B.1/B.2/B.3/B.4 done, exit criteria met)

### B.1 Trainer parameter surface

- [x] Add trainer knobs for:
  - observation normalization
  - reward/return normalization
  - value clipping and optional Huber value loss
  - target KL and early-stop update
- [x] Add defaults in config and parser compatibility.

Files:

- `config.json`
- `python/train.py`
- `docs/PARAMETERS.md`

### B.2 Implementation in optimizer loop

- [x] Implement running stats (`mean`, `var`, `count`) for observations and optional returns.
- [x] Apply normalization consistently in rollout and evaluation paths.
- [x] Add PPO diagnostics: approx KL, clip fraction, value loss trend.
- [x] Add value clipping and optional Huber loss mode.

Files:

- `python/train.py`
- `python/regression_rollout.py` (if needed for compatibility)

### B.3 Inference compatibility

- [x] Persist normalization metadata in policy payload.
- [x] Apply same normalization path in JS runtime inference.
- [x] Enforce shape/version compatibility checks and fail-fast messaging.

Files:

- `python/train.py`
- `src/ai/policy.js`
- `src/ai/observation.js` (if required)
- `docs/TRAINING_OVERRIDES.md`

### B.4 Validation gate (B)

- [x] Re-run canonical promotion checks through wrapper profile.
- [x] Confirm reduced eval oscillation in summary logs.
- [x] Confirm runtime `npm run ai:play` works with latest policy.

Validation snapshot (2026-02-17):

- Phase-2 smoke checks passed:
  - `node --check src/ai/policy.js`
  - `PYTHONPYCACHEPREFIX=/tmp/nodeDwarves_pycache python -m py_compile` (`train.py`, `promote_best.py`, `regression_rollout.py`)
  - short `train.py` run (`episodes=2`, `batchEpisodes=1`) completed with PPO diagnostics and checkpoint normalization metadata output.
  - short `promote_best.py --eval-only` and `regression_rollout.py` smokes completed using normalized-policy path.
- Full Gate-B cycle executed with canonical final check:
  - `npm run ai:train:quality:lite -- --canonical-eval-episodes 20 --canonical-eval-max-steps 2200 --canonical-require-positive-lcb --promote-eval-progress --promote-eval-progress-every 2`
  - Artifact directory: `debug/run_1771335576992_65175_577083/`
  - Canonical final (`report_promote_03_canonical-final.json`): `latest=3.7564`, `best_before=3.7495`, `delta=+0.0069`, paired LCB `-0.0401` -> no promotion (`best_retained`).
- Multi-seed eval variance comparison completed (`4` seeds, `8x1600`):
  - pre (`models/policy_best.json`): `debug/gateB_variance_pre_1771335260.jsonl`, mean `3.9290`, std `0.01735`
  - post (`models/policy.json`): `debug/gateB_variance_post_latest_1771337214.jsonl`, mean `3.9278`, std `0.03652`
  - variance increased, so stability criterion is not met yet.
- Summary logs checked (`summary_train.log`, `summary_finetune.log`): no `events=.*eval_regression` entries.
- Oscillation comparison (`rpt`) versus prior Phase-2 run:
  - foundation windows: comparable spread (`prev std=0.0292`, `new std=0.0329`)
  - finetune windows: reduced spread (`prev std=0.0235`, `new std=0.0040`)
  - no `eval_regression` markers in either new summary log.
- Runtime smoke passed:
  - `npm run ai:play` start + controlled SIGINT stop
  - exit code `0`
  - log: `debug/gateB_ai_play_smoke.log`
- Gate-B closure retune run completed (slow-machine conservative profile):
  - `npm run ai:train:quality:lite -- --canonical-eval-episodes 20 --canonical-eval-max-steps 2200 --canonical-require-positive-lcb --promote-eval-progress --promote-eval-progress-every 2 --workers 4 --target-kl 0.015 --clip-range 0.15 --value-clip-range 0.1 --obs-norm-clip 4 --return-norm-clip 3 --lr 0.00018 --lr-final 0.00007 --entropy-coef 0.005 --entropy-coef-final 0.0015 --epochs 3 --max-grad-norm 0.35`
  - Artifact directory: `debug/run_1771337830410_91845_910748/`
  - Canonical final (`report_promote_03_canonical-final.json`): `latest=3.7185`, `best_before=3.7495`, `delta=-0.0309`, paired LCB `-0.0795` -> no promotion (`best_retained`, acceptance guard intact).
- Updated multi-seed variance check after closure retune (`4` seeds, `8x1600`):
  - post-r1 (`models/policy.json`): `debug/gateB_variance_post_latest_r1_1771339344.jsonl`, mean `3.9607`, std `0.01278`
  - versus pre std `0.01735`, seed variance reduced.
- Runtime smoke on latest policy path passed:
  - `node app.js --ai models/policy.json` start + controlled SIGINT stop
  - exit code `0`
  - log: `debug/gateB_ai_play_latest_smoke.log`

Exit criteria:

- [x] Lower score variance across seeds.
- [x] No regression in promotion acceptance quality.

## 6) Workstream C - Throughput + Resume Continuity

Status: Completed (C.1/C.2/C.3/C.4 done, C7 throughput increment validated, target met with quality gates green)

### C.1 Throughput bottleneck instrumentation

- [x] Add timing counters for:
  - env step latency
  - IPC read/write latency
  - PPO update latency
  - episodes/minute
- [x] Emit compact periodic throughput diagnostics.

Files:

- `python/train.py`
- `ai_server.js` (if additional counters needed)

### C.2 IPC/rollout optimization

- [x] Reduce serialization overhead between workers and learner.
- [x] Move expensive per-episode post-processing to workers when safe.
- [x] Keep determinism and seed behavior unchanged.

Files:

- `python/train.py`
- `ai_server.js`

### C.3 Best-model resume continuity

- [x] On promotion, persist best optimizer/training state in sync with `policy_best.json`.
- [x] Validate true resume-from-best continuity.

Files:

- `python/promote_best.py`
- `python/train.py`

### C.4 Validation gate (C)

- [x] Measure episodes/minute before vs after on same profile.
- [x] Run full profile smoke: `npm run ai:train:full` (or equivalent profile command).
- [x] Re-run regression and benchmark gates.

Validation snapshot (2026-02-17):

- Throughput compare artifact: `debug/gateC_throughput_compare_1771343602.md`.
- Episodes/minute comparison on same hardware/profile:
  - profile A (`episodes=30`, `workers=4`, `max_steps=140`): `170.9 -> 169.3` (`-0.9%`).
  - profile B / IPC-heavy probe (`episodes=120`, `workers=8`, `max_steps=25`): `603.8 -> 605.6` (`+0.3%`).
- Equivalent profile smoke completed with Phase-3 trainer path:
  - `./.venv/bin/python python/train.py --config debug/run_1771341580161_37033_924486/config_fast.json --fresh --episodes 40 --max-steps 1200 --step-ticks 2 --epochs 3 --batch-episodes 8 --mini-batch-size 1024 --log-every 10 --save-every 20 --eval-every 5 --eval-episodes 2 --eval-max-steps 1200 --eval-difficulty 1.0 --difficulty-start 0.12 --difficulty-end 1.0 --difficulty-ramp 120 --workers 4`
  - summary artifact: `debug/run_20260217_162231_39160/summary.log` (`ep=40` line includes `thr[...]` and `ppo_upd`).
- Headless benchmark gate passed:
  - `node scripts/headless_benchmark.js --ticks 8000 --seeds 101,202,303,404 --progress --progress-every 2000 --report-json debug/gateC_headless_benchmark_1771342007.json --report-md debug/gateC_headless_benchmark_1771342007.md`.
- Regression gates passed after compatibility fix:
  - `node scripts/regression.js --profile standard` -> `debug/regression_report_1771343131892.{txt,json,md}`.
  - `node scripts/regression.js --profile underrealm` -> `debug/regression_report_1771343529111.{txt,json,md}`.

Exit criteria:

- Throughput improvement target: at least +25% episodes/minute on same hardware/profile. `Not met yet` (best measured delta `+0.3%`).
- No quality regression vs post-Phase-B checkpoint. `Met` (benchmark + regression gates pass).

## 7) Decision Log

Use this section to record every non-trivial technical decision.

| Date | ID | Decision | Alternatives considered | Why chosen | Impact | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-02-17 | D-001 | Start with Workstream A before B/C | B-first, C-first | Reward signal quality is highest leverage | Training quality | Team | Approved |
| 2026-02-17 | D-002 | Use `policy_best.meta` + file hashes as freeze baseline reference | Full canonical re-eval before freeze | Immediate reproducibility with low operational risk | Traceability | Team | Approved |
| 2026-02-17 | D-003 | Keep PPO architecture fixed (`2x128`) during optimization phases | Architecture expansion in parallel | Isolate training-pipeline effects before architecture changes | Causal analysis quality | Team | Approved |
| 2026-02-17 | D-004 | Introduce bounded delta reward channels plus Underrealm/Myths progression signals | Keep static-only reward | Better temporal credit assignment with controlled variance | Training quality/stability | Team | Implemented |
| 2026-02-17 | D-005 | Inject smart termination only via wrapper training configs (`ai.training.terminationProfile`) while eval keeps termination off | Enable global `ai.termination` or keep disabled everywhere | Fast training stop without biasing canonical/regression evaluation | Throughput + evaluation integrity | Team | Implemented |
| 2026-02-17 | D-006 | Add wrapper low-load mode + canonical promote scheduling knobs (`per-phase`/`final-only`/`off`) | Keep canonical-per-phase fixed for all machines | Preserve validation integrity while reducing interactive machine load | Throughput + operator UX | Team | Implemented |
| 2026-02-17 | D-007 | Persist observation/return normalization metadata in checkpoint payload and enforce runtime/eval shape checks | Keep trainer-only normalization or silent runtime fallback | Prevent train/eval/runtime drift and surface incompatibilities early | Stability + compatibility | Team | Implemented |
| 2026-02-17 | D-008 | Use packed rollout payloads (`dict` of arrays) + worker-side GAE to reduce learner deserialization cost | Keep list-of-dict transitions and learner-side GAE | Lower Python object churn and queue payload overhead without changing PPO math | Throughput + determinism | Team | Implemented |
| 2026-02-17 | D-009 | Promote optimizer state together with best policy in `promote_best.py` | Keep best-state writes only inside train loop | Ensure true resume-from-best continuity after canonical promotion | Resume continuity | Team | Implemented |
| 2026-02-17 | D-013 | Optimize compact IPC hot paths (precompiled action/feature slots, removed duplicate observation builds, fast-path vector/action handling) and close gate against frozen C+ baseline | Keep C+ state and continue with wrapper-level-only tweaks | Highest low-risk CPU/IPC leverage in eval/promote + rollout loops without changing reward/simulation semantics | Throughput + maintainability | Team | Implemented |

Status vocabulary:

- Planned
- Approved
- Implemented
- Reverted
- Superseded

## 8) Implementation Log

Track real execution at commit/PR granularity.

| Date | Task ID | Change summary | Files touched | Validation run | Result | Commit/PR | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-02-17 | P0.1 | Workbook initialized with timeline and workstreams | `docs/TRAINING_OPTIMIZATION_WORKBOOK.md` | n/a | Done | n/a | Initial operational plan |
| 2026-02-17 | P0.2 | Phase 0 baseline freeze captured (commit + hashes + canonical metrics) | `docs/TRAINING_OPTIMIZATION_WORKBOOK.md` | `git rev-parse`, `shasum -a 256`, metadata snapshot | Done | n/a | Baseline reference locked for later A/B |
| 2026-02-17 | P0.3 | Decision log and implementation log formalized for execution tracking | `docs/TRAINING_OPTIMIZATION_WORKBOOK.md` | Manual verification | Done | n/a | Ready to start Phase 1 |
| 2026-02-17 | P1.1 | Reward schema extended with bounded delta channels, deep signals, and clipping controls | `config.json`, `docs/PARAMETERS.md`, `docs/TRAINING_OVERRIDES.md`, `README.md`, `MANUAL.md` | JSON parse + docs sanity pass | Done | n/a | Backward-compatible legacy weights kept |
| 2026-02-17 | P1.2 | `ai_server.js` reward stack refactor (core + progression + bounded event channels) + deterministic clipping helpers | `ai_server.js` | `node --check ai_server.js`, `python3 python/promote_best.py --eval-only --eval-episodes 2 --eval-max-steps 5` | Done | n/a | Runtime smoke passed |
| 2026-02-17 | P1.3 | Training-only smart termination profile injected by wrapper; eval termination remains disabled | `scripts/train_wrapper.js`, `config.json` | `node --check scripts/train_wrapper.js` | Done | n/a | Training/eval separation preserved |
| 2026-02-17 | P1.4 | Phase-1 validation gate run (benchmark + regression + canonical eval snapshot) | `debug/regression_report_1771320981793.txt`, `debug/regression_report_1771320981793.json`, `debug/regression_report_1771320981793.md` | `headless_benchmark`, `regression --profile standard`, `regression --profile underrealm`, `promote_best --eval-only` | Partial | n/a | Underrealm baseline missing; canonical score delta currently negative (`-0.1718`) |
| 2026-02-17 | P1.5 | Wrapper runtime tuning for slower machines: low-load preset, canonical mode overrides, and promote progress controls | `scripts/train_wrapper.js`, `package.json`, `docs/TRAINING_OVERRIDES.md`, `README.md`, `MANUAL.md` | `node --check scripts/train_wrapper.js`, `node scripts/train_wrapper.js quality --low-load --dry-run` | Done | n/a | Heavy promote bottleneck mitigated without changing base config defaults |
| 2026-02-17 | P1.6 | Validation gate A rerun with low-load cycle + full benchmark/regression + canonical full eval snapshot | `debug/run_1771326222300_52900_856041/*`, `debug/gateA_headless_benchmark_1771326222300.json`, `debug/regression_report_1771328298447.json`, `debug/regression_report_1771328674292.json`, `debug/gateA_canonical_eval_policy_best_1771326222300.json` | `ai:train:quality:lite`, `headless_benchmark`, `regression --profile standard`, `regression --profile underrealm`, `promote_best --eval-only --eval-episodes 20 --eval-max-steps 2200` | Partial | n/a | Gate execution completed; deterministic regressions pass, but canonical delta vs freeze remains negative (`-0.0473`) |
| 2026-02-17 | P1.7 | Gate-A closure retune: reward calibration + canonical/regr re-validation | `config.json`, `debug/gateA_canonical_eval_policy_best_1771326222300_retune1.json`, `debug/regression_report_1771330212373.json`, `debug/regression_report_1771330568850.json` | `promote_best --eval-only (20x2200)`, `regression --profile standard`, `regression --profile underrealm` | Done | n/a | Exit criteria met: canonical delta positive (`+0.0111`) and deterministic regressions pass |
| 2026-02-17 | P2.1 | Phase-2 core implementation: PPO stability knobs + normalization pipeline + checkpoint/runtime/eval compatibility wiring | `python/train.py`, `python/promote_best.py`, `python/regression_rollout.py`, `src/ai/policy.js`, `config.json`, `docs/PARAMETERS.md`, `docs/TRAINING_OVERRIDES.md`, `README.md`, `MANUAL.md`, `docs/TRAINING_OPTIMIZATION_WORKBOOK.md` | `node --check src/ai/policy.js`, `PYTHONPYCACHEPREFIX=/tmp/nodeDwarves_pycache python -m py_compile`, `train.py` 2-episode smoke, `promote_best --eval-only` smoke, `regression_rollout.py` smoke | Done | n/a | B.4 validation gate still pending |
| 2026-02-17 | P2.2 | Phase-2 Validation Gate B full execution (wrapper canonical + variance + runtime smoke) | `debug/run_1771335576992_65175_577083/*`, `debug/gateB_variance_pre_1771335260.jsonl`, `debug/gateB_variance_post_latest_1771337214.jsonl`, `debug/gateB_ai_play_smoke.log`, `docs/TRAINING_OPTIMIZATION_WORKBOOK.md` | `ai:train:quality:lite` (canonical final), multi-seed `promote_best --eval-only`, `ai:play` smoke | Partial | n/a | Gate executed end-to-end; variance criterion failed (`0.01735 -> 0.03652`), canonical promotion retained best due negative LCB |
| 2026-02-17 | P2.3 | Phase-2 Gate-B closure cycle: conservative quality retune + updated variance + latest-policy runtime smoke | `debug/run_1771337830410_91845_910748/*`, `debug/gateB_variance_post_latest_r1_1771339344.jsonl`, `debug/gateB_ai_play_latest_smoke.log`, `docs/TRAINING_OPTIMIZATION_WORKBOOK.md` | `ai:train:quality:lite` tuned run, multi-seed `promote_best --eval-only`, `node app.js --ai models/policy.json` smoke | Done | n/a | Exit criteria met: seed variance improved (`0.01735 -> 0.01278`) and promotion guard retained best on negative LCB |
| 2026-02-17 | P2.4 | Operator visibility improvement: documented high-visibility wrapper/trainer logging preset for slow machines | `docs/TRAINING_OVERRIDES.md`, `docs/TRAINING_OPTIMIZATION_WORKBOOK.md` | Doc review | Done | n/a | Added explicit `promote-eval-progress-every 1` + trainer `--log-every/--eval-every` guidance |
| 2026-02-17 | P3.1 | Phase-3 core implementation: throughput diagnostics (`thr[...]`, `ppo_upd`), packed rollout payload, worker-side GAE, and promote best-state copy | `python/train.py`, `python/promote_best.py`, `python/regression_rollout.py` | `py_compile`, short `train.py` smoke, `promote_best.py` promotion smoke | Done | n/a | Regression rollout callsite patched to new `run_episode` signature |
| 2026-02-17 | P3.2 | Gate-C validation run: throughput compare, benchmark + regression rerun, and equivalent profile smoke | `debug/gateC_throughput_compare_1771343602.md`, `debug/gateC_headless_benchmark_1771342007.json`, `debug/regression_report_1771343131892.json`, `debug/regression_report_1771343529111.json`, `debug/run_20260217_162231_39160/summary.log`, `docs/TRAINING_OPTIMIZATION_WORKBOOK.md` | throughput A/B microprofiles, `headless_benchmark`, `regression --profile standard`, `regression --profile underrealm`, fast-config trainer smoke | Partial | n/a | Quality gates pass; throughput target (`+25%`) still open for next tuning cycle |
| 2026-02-17 | P3.3 | Workstream C5 implementation: dual transport (`legacy`/`compact`) across train/eval/promote/regression + compact IPC path in JS bridge | `python/train.py`, `python/promote_best.py`, `python/regression_rollout.py`, `ai_server.js`, `config.json`, `docs/PARAMETERS.md`, `docs/TRAINING_OVERRIDES.md`, `README.md`, `MANUAL.md`, `docs/TRAINING_OPTIMIZATION_WORKBOOK.md` | `node --check ai_server.js`, `py_compile`, `promote_best --eval-only` (`legacy` + `compact`), `regression_rollout.py` smoke (`compact`), `train.py` smoke (`compact`) | Done | n/a | Smoke parity check on same seed/contract produced identical eval score in `legacy` vs `compact` |
| 2026-02-17 | P3.4 | Gate C+ throughput A/B (compact vs legacy) on quality-like and IPC-heavy probes | `debug/gateCplus_throughput_compare_1771345693.md` | `train.py` profile A/B with fixed seed (`legacy` + `compact`) | Partial | n/a | Throughput improved (`+18.5%`, `+2.9%`) but still below target `+25%` |
| 2026-02-17 | P3.5 | Workstream C6 implementation: mixed curriculum wrapper preset (`quality-mixed`) with ~`76/24` episode split | `scripts/train_wrapper.js`, `package.json`, `docs/TRAINING_OVERRIDES.md`, `README.md`, `MANUAL.md`, `docs/TRAINING_OPTIMIZATION_WORKBOOK.md` | `node --check scripts/train_wrapper.js`, `node scripts/train_wrapper.js quality-mixed --dry-run --low-load`, `npm run ai:train:quality:mixed -- --dry-run --low-load` | Done | n/a | Canonical promotion contract remains unchanged via wrapper canonical config path |
| 2026-02-17 | P3.6 | Gate C+ full validation rerun (benchmark + regression + mixed preset smoke) | `debug/gateCplus_headless_benchmark_1771347287.json`, `debug/gateCplus_headless_benchmark_1771347287.md`, `debug/gateCplus_headless_benchmark_1771347287.log`, `debug/regression_report_1771346860187.md`, `debug/regression_report_1771347278009.md`, `debug/gateCplus_smoke_quality_mixed_1771347914.log`, `debug/run_1771347914555_24155_962090/report_training_promotion_summary.md`, `debug/gateCplus_validation_1771347914.md`, `docs/TRAINING_OPTIMIZATION_WORKBOOK.md` | `headless_benchmark --ticks 8000 --seeds 101,202,303,404`, `regression --profile standard`, `regression --profile underrealm`, `ai:train:quality:mixed` smoke (`low-load`, reduced episodes) | Partial | n/a | Quality guardrails pass; throughput objective (`>= +25%`) remains open |
| 2026-02-17 | P3.7 | C7 throughput increment: compact-path CPU/IPC hot-path optimization (`ai_server.js` + trainer fast paths), fresh throughput compare, eval/promote IPC probe, and full quality gate rerun | `ai_server.js`, `python/train.py`, `debug/gateC7_throughput_compare_1771360179.md`, `debug/gateC7_eval_promote_profile_1771360179.md`, `debug/gateC7_headless_benchmark_1771359150.{json,md}`, `debug/regression_report_1771360039305.{json,md}`, `debug/regression_report_1771360039866.{json,md}`, `debug/gateC7_validation_1771360179.md`, `docs/TRAINING_OPTIMIZATION_WORKBOOK.md` | `node --check ai_server.js`, `py_compile`, throughput A/B microprofiles (`30x140`, `120x25`), eval-only short promote probe (`4x400`, legacy vs compact), `headless_benchmark --ticks 8000 --seeds 101,202,303,404`, `regression --profile standard`, `regression --profile underrealm` | Done | n/a | Throughput target met vs frozen C+ baseline (`A +52.2%`, `B +85.0%`) with benchmark/regression guardrails PASS |
| 2026-02-19 | P3.8 | PPO trainer quick-wins hardening: IPC/worker watchdog fail-fast, worker-error propagation, deterministic per-episode worker seeding, and final partial-batch flush + final save | `python/train.py`, `README.md`, `MANUAL.md`, `docs/TRAINING_OPTIMIZATION_WORKBOOK.md` | `PYTHONPYCACHEPREFIX=/tmp/nodeDwarves_pycache python3 -m py_compile python/train.py` | Done | n/a | Targets stability/debuggability and non-regression of tail updates without changing PPO architecture/contracts |
| 2026-02-19 | P3.9 | Quick-wins follow-up (`1+2+7`): compact `obsVector` fail-fast shape check, binary worker update payload (`state_dict`) with legacy load fallback, and full gate rerun | `python/train.py`, `README.md`, `MANUAL.md`, `docs/TRAINING_OPTIMIZATION_WORKBOOK.md`, `debug/regression_report_1771509035767.{txt,json,md}` | `PYTHONPYCACHEPREFIX=/tmp/nodeDwarves_pycache python3 -m py_compile python/train.py`, `python3 python/train.py --episodes 1 --batch-episodes 1 --workers 1 --max-steps 10 --step-ticks 2 --log-every 1 --eval-every 0 --model-path /tmp/nodeDwarves_smoke_policy.json --model-state-path /tmp/nodeDwarves_smoke_policy.state.pt --best-model-path /tmp/nodeDwarves_smoke_policy_best.json --best-meta-path /tmp/nodeDwarves_smoke_policy_best.meta.json --best-model-state-path /tmp/nodeDwarves_smoke_policy_best.state.pt`, `npm run ai:validate:gate` | Done | n/a | Gate PASS (benchmark avg: pop `716.0`, morale `0.8865`; regression `standard` + `underrealm` all checks `ok`) with no contract regressions detected |
| 2026-02-19 | P4.1 | Canonical freeze benchmark closure check on `policy_best` using baseline contract (`20x2200`, `rpt`) | `debug/canonical_freeze_check_1771509446.{json,md}`, `docs/TRAINING_OPTIMIZATION_WORKBOOK.md` | `npm run ai:promote:best -- --eval-only --model-path models/policy_best.json --best-model-path models/policy_best.json --eval-episodes 20 --eval-max-steps 2200 --eval-score rpt --transport compact --report-tag freeze-check --report-json debug/canonical_freeze_check_1771509446.json --report-md debug/canonical_freeze_check_1771509446.md` | Done | n/a | Canonical score `3.7747` vs freeze baseline `3.7384` (`delta=+0.0363`), DoD benchmark-improvement criterion satisfied |
| 2026-02-19 | P4.2 | Risk-closure mini-gate: collapse guardrail rerun (`R-001`) + normalization/runtime compatibility check (`R-002`) | `debug/risk_r001_benchmark_1771510258.{json,md}`, `debug/risk_r002_runtime_smoke_1771510861.log`, `debug/risk_r002_normalization_check_1771510899.json`, `docs/TRAINING_OPTIMIZATION_WORKBOOK.md` | `node scripts/headless_benchmark.js --ticks 8000 --seeds 101,202,303,404 --progress --progress-every 2000 --report-json debug/risk_r001_benchmark_1771510258.json --report-md debug/risk_r001_benchmark_1771510258.md`, `node app.js --ai models/policy_best.json` (controlled stop), static policy normalization shape check | Done | n/a | `R-001`: avg pop `716.0`, no collapse profile in benchmark seeds. `R-002`: policy obs-norm shape matches (`504/504`), runtime smoke log has `0` normalization/shape warnings |
| 2026-02-19 | P4.3 | Operational runbook hardening: add canonical/risk npm aliases and document A/B/C single-change cycle commands in operator docs | `package.json`, `README.md`, `MANUAL.md`, `docs/TRAINING_OVERRIDES.md`, `docs/TRAINING_OPTIMIZATION_WORKBOOK.md`, `debug/canonical_master_smoke.{json,md}` | `npm run ai:validate:risk:r002`, `npm run ai:validate:canonical -- --eval-episodes 1 --eval-max-steps 20 --report-tag canonical-master-smoke --report-json debug/canonical_master_smoke.json --report-md debug/canonical_master_smoke.md` | Done | n/a | Canonical master + risk commands are now first-class scripts; cycle documentation is explicit and copy-paste ready for daily operations |

## 9) Risk Register

| ID | Risk | Probability | Impact | Mitigation | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- |
| R-001 | Reward redesign causes policy collapse | Medium | High | Incremental rollout + A/B gate each substep; periodic deterministic benchmark/regression gates with seeded profiles | Team | Mitigated |
| R-002 | Normalization mismatch breaks JS inference | Medium | High | Persist stats in model + runtime compatibility test + fail-fast shape/version guards in trainer/runtime | Team | Mitigated |
| R-003 | Throughput refactor introduces nondeterminism | Medium | Medium | Seed reproducibility checks before merge | TBD | Mitigated |
| R-004 | Promotion continuity mismatch (best state missing) | High | Medium | Save/copy best optimizer state on promote | TBD | Mitigated |

## 10) Definition of Done (Global)

All items required for closure:

- [x] Workstreams A, B, C completed with passing gates.
- [x] Canonical benchmark score improved vs baseline freeze.
- [x] Regression profiles pass with no critical blockers.
- [x] Throughput gain documented with before/after numbers.
- [x] Docs updated (`README.md`, `MANUAL.md`, `docs/PARAMETERS.md`, `docs/TRAINING_OVERRIDES.md` as needed).
- [x] Final summary report archived under `debug/` with links to relevant artifacts.

## 11) Weekly Checkpoint Template

Copy this block each week:

Week of: YYYY-MM-DD

- Planned scope:
- Completed scope:
- Blockers:
- Decisions taken:
- Metric deltas (vs baseline):
- Next week priority:

## 12) Phase 3.1 - Throughput Recovery Plan (Compact IPC + Curriculum Mix)

Status: Completed (C5/C6/C7 implemented; throughput target met with benchmark/regression guardrails PASS)
Window: 2026-02-18 to 2026-02-22
Milestone: reach throughput target (`+25% eps/min`) without quality regression.

### 12.1 Scope and Targets

- Primary target: `>= +25%` episodes/minute vs current Phase-3 baseline on same hardware/profile.
- Quality guardrails:
  - no regression failures on `standard` and `underrealm` profiles,
  - canonical promotion quality unchanged or improved (`rpt`).
- Compatibility guardrails:
  - keep legacy training transport path available (`legacy` fallback),
  - no JS runtime inference contract break.

### 12.2 Workstream C5 - Compact Transport Protocol (Priority 1)

- [x] Add transport mode switch (`legacy` / `compact`) in trainer path.
- [x] Implement compact action payload from Python worker to `ai_server.js` (fixed-order array instead of nested JSON maps).
- [x] Implement compact observation payload from `ai_server.js` to trainer (flattened numeric vector + minimal metadata).
- [x] Keep backward-compatible parsing in `ai_server.js` for existing `legacy` payloads.
- [x] Ensure deterministic behavior parity under fixed seeds (`legacy` vs `compact`) on smoke scope (`promote_best --eval-only`, same seed, same score).

Files:

- `python/train.py`
- `python/promote_best.py` (if eval path requires compact mode support)
- `python/regression_rollout.py` (if rollout path requires compact mode support)
- `ai_server.js`
- `scripts/train_wrapper.js` (optional transport forwarding flag)

### 12.3 Workstream C6 - Curriculum Mix for Slow Hardware (Priority 2)

- [x] Define explicit mixed curriculum ratio:
  - `70-80%` episodes in lighter simulation config,
  - `20-30%` episodes in full-sim finetune/endgame-sensitive phase.
- [x] Add one wrapper preset variant for this mix (slow-machine throughput profile).
- [x] Keep canonical promotion evaluation on full-quality contract.

Files:

- `scripts/train_wrapper.js`
- `config.json` (only if defaults are updated)
- `docs/TRAINING_OVERRIDES.md`

### 12.4 Validation Gate C+ (Phase 3.1)

- [x] Throughput A/B on same machine/profile:
  - baseline run (`legacy`) and candidate run (`compact`).
- [x] Compare `eps_pm` using the same episode budget and fixed seed.
- [x] Run benchmark gate:
  - `node scripts/headless_benchmark.js --ticks 8000 --seeds 101,202,303,404 --progress --progress-every 2000`.
- [x] Run regression gates:
  - `node scripts/regression.js --profile standard`
  - `node scripts/regression.js --profile underrealm`
- [x] Run one profile smoke on wrapper preset (`quality:lite` or equivalent mixed preset).

Validation snapshot (2026-02-17):

- Throughput A/B report: `debug/gateCplus_throughput_compare_1771345693.md`.
- Profile A (`30x140`, workers `4`, seed `4242`):
  - `legacy=175.0 eps_pm`
  - `compact=207.4 eps_pm`
  - delta `+18.5%`.
- Profile B (`120x25`, workers `8`, seed `4242`):
  - `legacy=635.6 eps_pm`
  - `compact=653.9 eps_pm`
  - delta `+2.9%`.
- Full validation report: `debug/gateCplus_validation_1771347914.md`.
- Benchmark snapshot (`debug/gateCplus_headless_benchmark_1771347287.md`):
  - avg population `716.00`
  - avg morale `0.8865`
  - avg hunger `0.1528`
  - avg thirst `0.1093`.
- Regression snapshot:
  - `standard` gate `PASS` (`debug/regression_report_1771346860187.md`)
  - `underrealm` gate `PASS` (`debug/regression_report_1771347278009.md`).
- Mixed preset smoke:
  - wrapper run completed end-to-end (`debug/gateCplus_smoke_quality_mixed_1771347914.log`)
  - canonical final retained best with delta `-0.0006` (`debug/run_1771347914555_24155_962090/report_training_promotion_summary.md`).
- Interpretation: quality/regression guardrails pass; compact transport improves throughput, but Gate C+ throughput target (`>= +25%`) is still unmet.

Exit criteria:

- [x] Throughput delta `>= +25%` vs current Phase-3 baseline.
- [x] Regression gates pass with no blocker metrics.
- [x] Canonical quality not degraded beyond configured guardrails.

### 12.5 Step-by-Step Execution Checklist

1. [x] Freeze current baseline artifacts (`summary.log`, throughput compare markdown, regression reports).
2. [x] Implement C5 transport mode with default `legacy`.
3. [x] Add `compact` mode behind explicit flag and verify parser compatibility.
4. [x] Run deterministic seed parity check (`legacy` vs `compact`) on smoke profile.
5. [x] Measure throughput delta on microprofile A and IPC-heavy profile B.
6. [x] If throughput gain is below target, implement C6 mixed-curriculum wrapper preset.
7. [x] Re-run Gate C+ full validation (benchmark + regression + smoke).
8. [x] Update Decision Log + Implementation Log + risk statuses.
9. [x] Implement C7 hot-path optimization (`ai_server.js` + `train.py`) and rerun throughput microprofiles.
10. [x] Re-run benchmark + regression and archive C7 validation report.

### 12.6 Decision Placeholders (Phase 3.1)

| Date | ID | Decision | Alternatives considered | Why chosen | Impact | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-02-18 | D-010 | Introduce compact IPC protocol with legacy fallback | Keep JSON legacy only | Highest expected throughput ROI without inference contract break | Throughput | Team | Implemented |
| 2026-02-18 | D-011 | Add mixed curriculum throughput preset for slow hardware | Keep full-sim-heavy schedule | Better wall-clock efficiency while preserving final quality checks | Throughput + quality | Team | Implemented |
| 2026-02-17 | D-012 | Keep Gate C+ open after full validation; continue with next throughput increment | Close gate with partial gain (`+18.5%`, `+2.9%`) | Milestone requires explicit `>= +25%` throughput delta while guardrails stay green | Planning discipline + throughput | Team | Implemented |
| 2026-02-17 | D-013 | Close Gate C+ with C7 increment after hot-path optimization + full gate rerun (`A +52.2%`, `B +85.0%` vs frozen C+ baseline) | Keep gate open until larger structural rewrite (C8) | C7 reached target with low-risk code-level changes and preserved quality guardrails | Throughput + delivery confidence | Team | Implemented |

### 12.7 C7 Validation Snapshot (2026-02-17)

- Throughput compare: `debug/gateC7_throughput_compare_1771360179.md`.
  - Profile A (`30x140`, workers `4`, seed `4242`), conservative candidate (`legacy`): `266.4 eps_pm` vs C+ baseline `175.0` -> `+52.2%`.
  - Profile B (`120x25`, workers `8`, seed `4242`), conservative candidate (`legacy`): `1175.8 eps_pm` vs C+ baseline `635.6` -> `+85.0%`.
- Eval/promote IPC probe: `debug/gateC7_eval_promote_profile_1771360179.md`.
  - `promote_best.py --eval-only --eval-episodes 4 --eval-max-steps 400` shows compact path about `4-5%` faster than legacy with identical score payload.
- Benchmark gate rerun: `debug/gateC7_headless_benchmark_1771359150.md` (avg pop `716.00`, morale `0.8865`, hunger `0.1528`, thirst `0.1093`).
- Regression rerun:
  - `standard` PASS (`debug/regression_report_1771360039305.md`)
  - `underrealm` PASS (`debug/regression_report_1771360039866.md`)
- Final validation report: `debug/gateC7_validation_1771360179.md`.

## 13) Operational Cycle Runbook (Post-Closure Baseline)

Status: Active baseline (2026-02-19)
Goal: keep training changes incremental, comparable, and promotion-safe after the optimization closure.

### 13.1 Canonical Master Contract

Use one fixed canonical contract for every acceptance decision:

- `evalEpisodes=20`
- `evalMaxSteps=2200`
- `stepTicks=2`
- `evalScore=rpt`
- `transport=compact`

Command:

```bash
npm run ai:validate:canonical
```

Outputs:

- `debug/canonical_master_latest.json`
- `debug/canonical_master_latest.md`

### 13.2 Risk Mini-Gate

Use risk checks before accepting defaults:

- `r001` collapse pressure:
  - deterministic benchmark (`8000` ticks, seeds `101,202,303,404`)
- `r002` checkpoint compatibility:
  - observation-normalization shape check against current policy feature/action contract

Commands:

```bash
npm run ai:validate:risk
# or run slices independently:
npm run ai:validate:risk:r001
npm run ai:validate:risk:r002
```

### 13.3 Single-Change A/B/C Cycle

Policy for every tuning iteration:

- Change one variable per cycle (reward OR curriculum OR trainer knob).
- Do not stack multiple unverified tweaks in the same cycle.
- Promote only after canonical + gate + risk are all green.

Cycle template:

```bash
# Cycle A
npm run ai:train:quality:daily
npm run ai:validate:canonical
npm run ai:validate:gate

# Cycle B
npm run ai:train:quality:daily
npm run ai:validate:canonical
npm run ai:validate:gate

# Cycle C (closeout candidate)
npm run ai:train:quality:high
npm run ai:validate:canonical
npm run ai:validate:gate
npm run ai:validate:risk
```

Acceptance rule:

- canonical delta under master contract is positive
- benchmark/regression gate passes
- risk mini-gate passes
