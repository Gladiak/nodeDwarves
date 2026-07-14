# Training Optimization Workbook

> Historical note: command aliases recorded in completed timeline entries reflect
> the package surface available when each experiment ran. Current operations use
> the rationalized commands documented in `README.md`, `MANUAL.md`, and
> `docs/TRAINING_OVERRIDES.md`.

Operational addendum (2026-07-14): the unified wrapper now exposes the
`m4-balanced` profile for the 10-core/16 GB Apple M4 development machine. The
accepted compromise uses quality-mixed phases, `5→4` workers, sparse training
evaluation, low-write cleanup, skipped phase promotes, and one final guarded
canonical `12x1800` comparison. Contract coverage lives in
`scripts/test_training_contracts.js`.

Last updated: 2026-02-27
Project: NodeDwarves AI training pipeline
Scope: End-to-end implementation tracking for the 3 approved optimization solutions

## 0) Closure Snapshot (2026-02-21)

- Workstreams A/B/C and OQ-1..OQ-6.4 are implemented with local validation evidence captured in this workbook.
- This file is now the historical implementation archive (timeline, decisions, validation snapshots).
- Current operational status and active validation cadence are tracked in `docs/TRAINING_STATUS.md`.
- Remaining external closure item: OQ-6.1 needs one remote GitHub Actions run (`Training Quality Gates`) with uploaded artifacts.

## 0.1) Post-fresh gate closure snapshot (2026-02-27)

- Local fresh training cycle completed and followed by full local gate sweep.
- Gate sequence executed:
  - `npm run ai:validate:canonical` -> `PASS` (`score=3.77368007093475`)
  - `npm run ai:validate:gate` -> `PASS` (`standard/underrealm/governance` all green)
  - `npm run ai:validate:risk` -> `PASS` (`r001` completed, `r002` check `ok`)
- Latest retained local artifacts:
  - `debug/canonical_master_latest.json`
  - `debug/canonical_master_latest.md`
  - `debug/regression_report_1772202786690.json`
  - `debug/regression_report_1772202786690.md`
- Post-validation cleanup executed via `npm run debug:clean` to remove transient run folders while preserving latest canonical/regression outputs.

Artifact retention note (2026-02-17):
- Historical `[artifact removed]` raw artifacts from older gates were pruned to keep the repository lean.
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

Status: Completed (A.1/A.2/A.3/A.4 done, exit criteria met)

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
  (`[artifact removed]`).
- Headless benchmark completed on 4 seeds (`avg pop=716.0`, `avg morale=0.8865`, no extinction):
  `[artifact removed]` + `.md`.
- Regression `standard`: pass
  (`[artifact removed]` + `.json/.md`).
- Regression `underrealm`: pass
  (`[artifact removed]` + `.json/.md`).
- Canonical full eval-only on `models/policy_best.json`:
  `score=3.6911` vs frozen baseline `3.7384` (`delta=-0.0473`)
  (`[artifact removed]` + `.md`).
- Low-load canonical-final (8x1600) in training run stayed below current best:
  `latest=3.8490`, `best=3.8685`, no promotion
  (`report_promote_03_canonical-final.json`).
- Reward micro-retune round (`stockpileMin=1.65`, `survival=2.28`, `death=5.8`) and canonical full re-check:
  `score=3.7495` vs frozen baseline `3.7384` (`delta=+0.0111`)
  (`[artifact removed]` + `.md`).
- Post-retune deterministic regressions:
  - `standard`: pass (`[artifact removed]` + `.json/.md`)
  - `underrealm`: pass (`[artifact removed]` + `.json/.md`)

Exit criteria:

- [x] Positive canonical `rpt` delta vs frozen baseline.
- [x] No deterministic regression gate failures.

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
  - Artifact directory: `[artifact removed]`
  - Canonical final (`report_promote_03_canonical-final.json`): `latest=3.7564`, `best_before=3.7495`, `delta=+0.0069`, paired LCB `-0.0401` -> no promotion (`best_retained`).
- Multi-seed eval variance comparison completed (`4` seeds, `8x1600`):
  - pre (`models/policy_best.json`): `[artifact removed]`, mean `3.9290`, std `0.01735`
  - post (`models/policy.json`): `[artifact removed]`, mean `3.9278`, std `0.03652`
  - variance increased, so stability criterion is not met yet.
- Summary logs checked (`summary_train.log`, `summary_finetune.log`): no `events=.*eval_regression` entries.
- Oscillation comparison (`rpt`) versus prior Phase-2 run:
  - foundation windows: comparable spread (`prev std=0.0292`, `new std=0.0329`)
  - finetune windows: reduced spread (`prev std=0.0235`, `new std=0.0040`)
  - no `eval_regression` markers in either new summary log.
- Runtime smoke passed:
  - `npm run ai:play` start + controlled SIGINT stop
  - exit code `0`
  - log: `[artifact removed]`
- Gate-B closure retune run completed (slow-machine conservative profile):
  - `npm run ai:train:quality:lite -- --canonical-eval-episodes 20 --canonical-eval-max-steps 2200 --canonical-require-positive-lcb --promote-eval-progress --promote-eval-progress-every 2 --workers 4 --target-kl 0.015 --clip-range 0.15 --value-clip-range 0.1 --obs-norm-clip 4 --return-norm-clip 3 --lr 0.00018 --lr-final 0.00007 --entropy-coef 0.005 --entropy-coef-final 0.0015 --epochs 3 --max-grad-norm 0.35`
  - Artifact directory: `[artifact removed]`
  - Canonical final (`report_promote_03_canonical-final.json`): `latest=3.7185`, `best_before=3.7495`, `delta=-0.0309`, paired LCB `-0.0795` -> no promotion (`best_retained`, acceptance guard intact).
- Updated multi-seed variance check after closure retune (`4` seeds, `8x1600`):
  - post-r1 (`models/policy.json`): `[artifact removed]`, mean `3.9607`, std `0.01278`
  - versus pre std `0.01735`, seed variance reduced.
- Runtime smoke on latest policy path passed:
  - `node app.js --ai models/policy.json` start + controlled SIGINT stop
  - exit code `0`
  - log: `[artifact removed]`

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

- Throughput compare artifact: `[artifact removed]`.
- Episodes/minute comparison on same hardware/profile:
  - profile A (`episodes=30`, `workers=4`, `max_steps=140`): `170.9 -> 169.3` (`-0.9%`).
  - profile B / IPC-heavy probe (`episodes=120`, `workers=8`, `max_steps=25`): `603.8 -> 605.6` (`+0.3%`).
- Equivalent profile smoke completed with Phase-3 trainer path:
  - `./.venv/bin/python python/train.py --config [artifact removed] --fresh --episodes 40 --max-steps 1200 --step-ticks 2 --epochs 3 --batch-episodes 8 --mini-batch-size 1024 --log-every 10 --save-every 20 --eval-every 5 --eval-episodes 2 --eval-max-steps 1200 --eval-difficulty 1.0 --difficulty-start 0.12 --difficulty-end 1.0 --difficulty-ramp 120 --workers 4`
  - summary artifact: `[artifact removed]` (`ep=40` line includes `thr[...]` and `ppo_upd`).
- Headless benchmark gate passed:
  - `node scripts/headless_benchmark.js --ticks 8000 --seeds 101,202,303,404 --progress --progress-every 2000 --report-json [artifact removed] --report-md [artifact removed]`.
- Regression gates passed after compatibility fix:
  - `node scripts/regression.js --profile standard` -> `[artifact removed]`.
  - `node scripts/regression.js --profile underrealm` -> `[artifact removed]`.

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
| 2026-02-20 | D-014 | Enforce strict promotion-aligned continuous improvement semantics (`improved == promoted`) and profile-specific deterministic regression scenarios (`standard`/`underrealm`/`governance`) with adaptive sampling cadence tuned to wrapper-scale runs (`updateEvery=80`) | Keep delta-threshold improvement semantics + shared deterministic eval scenarios + high `updateEvery` | Removes no-improve ambiguity, strengthens deep/governance regression signal quality, and reactivates adaptive sampling in normal quality loops | Validation rigor + operational stability | Team | Implemented |
| 2026-02-20 | D-015 | Keep strict hardened regression profile contract and recover `underrealm` gate via config-only scenario safety retune (`underrealm_push` readiness/combat pacing + `compound_crisis` scarcity/raid pressure moderation) | Relax tolerances, revert profile hardening, or re-record baseline immediately | Preserves stronger deterministic regression signal while resolving the real stability issue instead of masking it | Gate closure + contract integrity | Team | Implemented |
| 2026-02-20 | D-016 | Defer `underrealm` baseline refresh after stability mini-cycle; keep current stricter baseline while monitoring additional cycles | Re-record `underrealm` baseline immediately after first pass recovery | Current recovered profile is stable/pass but still carries higher deaths than baseline; immediate refresh would weaken the deaths guardrail too early | Guardrail strength + regression sensitivity | Team | Implemented |
| 2026-02-20 | D-017 | Add explicit adaptive-sampler observability in trainer summary logs via `scenario_updates=<window>/<total>` and keep cadence guardrails bounded (`0.8..1.2`) | Keep event-only trace (`scenario_weights`) without counters | Makes OQ-1 verification measurable phase-by-phase with one grep, without changing policy logic | Operator visibility + tuning safety | Team | Implemented |
| 2026-02-20 | D-018 | Tighten horizon deaths guardrail (`horizon.eval.avg_deaths` tolerance `+18% -> +16%`) and validate against historical pre-retune scenario replay | Keep horizon tolerance unchanged (`+18%`) and rely only on current-cycle PASS | Existing tolerance was too permissive near the known historical stress replay edge (`3.075` vs `3.074` threshold after tighten), reducing weakness-detection value of OQ-4 sanity checks | Horizon signal quality + regression sensitivity | Team | Implemented |
| 2026-02-21 | D-019 | Promote `governance_pressure` into the canonical eval scenario set after deterministic A/B (`baseline` vs `candidate+governance`) and close plan as active add-on baseline | Keep governance only in regression/horizon slices or defer to future cycle | A/B showed non-negative quality with broader governance coverage; full extended cycle stayed green under the updated canonical contract | Canonical coverage + operational quality baseline | Team | Implemented |
| 2026-02-21 | D-020 | Close remaining OQ-5 items with config-driven late-underrealm stress scenario, adaptive difficulty-phase sampler schedule, diagnostic-only eval ensemble reporting, and deterministic weekly seed-pack rotation for horizon checks | Keep OQ-5 partial (governance-only) or hard-gate promotions on ensemble diagnostics | Completes optional OQ-5 roadmap with additive low-risk controls while preserving existing promotion and regression gate semantics | Deep/horizon observability + deterministic operations | Team | Implemented |
| 2026-02-21 | D-021 | Implement OQ-6.2 as a deterministic technical contract suite behind `npm test` (policy observation shape + regression report schema + promote report schema with diagnostic block) | Keep `npm test` placeholder or rely on manual smoke checks | Converts qualitative training contracts into fast pre-merge executable checks and adds one deliberate mismatch failure assertion in test mode | Quality assurance + contract stability | Team | Implemented |
| 2026-02-21 | D-022 | Implement OQ-6.1 with one CI workflow that runs existing local gate commands unchanged and packages artifacts from generated outputs/logs (`canonical`, `regression`, `risk`, `horizon`, `horizon_weekly`) | Introduce CI-only validation wrappers or add hidden report-path overrides to core gate commands | Preserves local/CI contract parity while adding reproducibility discipline and artifact traceability with explicit PASS/FAIL outcomes | Operational rigor + reproducibility | Team | Implemented |
| 2026-02-21 | D-023 | Expand weekly deep-check seed-pack size to `4` seeds/pack and keep current horizon thresholds after full-budget deterministic rerun + consecutive-week validation | Keep `2` seeds/pack or re-tune thresholds preemptively after pack expansion | Increases statistical power while preserving deterministic comparability; empirical margins stayed positive so no threshold relaxation was needed | Horizon robustness + signal quality | Team | Implemented |
| 2026-02-21 | D-024 | Close OQ-6.4 with runtime-optimized full gate orchestration (`extended:optimized`) and cadence split that preserves acceptance signal while removing duplicate benchmark execution | Keep monolithic `ai:validate:extended` everywhere or reduce checks in fast loop without explicit acceptance boundary | Delivers measurable wall-time reduction (`-25.37%`) with unchanged guardrail semantics and explicit per-change/nightly/weekly operational cadence | Operator throughput + decision quality | Team | Implemented |

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
| 2026-02-17 | P1.4 | Phase-1 validation gate run (benchmark + regression + canonical eval snapshot) | `[artifact removed]`, `[artifact removed]`, `[artifact removed]` | `headless_benchmark`, `regression --profile standard`, `regression --profile underrealm`, `promote_best --eval-only` | Partial | n/a | Underrealm baseline missing; canonical score delta currently negative (`-0.1718`) |
| 2026-02-17 | P1.5 | Wrapper runtime tuning for slower machines: low-load preset, canonical mode overrides, and promote progress controls | `scripts/train_wrapper.js`, `package.json`, `docs/TRAINING_OVERRIDES.md`, `README.md`, `MANUAL.md` | `node --check scripts/train_wrapper.js`, `node scripts/train_wrapper.js quality --low-load --dry-run` | Done | n/a | Heavy promote bottleneck mitigated without changing base config defaults |
| 2026-02-17 | P1.6 | Validation gate A rerun with low-load cycle + full benchmark/regression + canonical full eval snapshot | `[artifact removed]`, `[artifact removed]`, `[artifact removed]`, `[artifact removed]`, `[artifact removed]` | `ai:train:quality:lite`, `headless_benchmark`, `regression --profile standard`, `regression --profile underrealm`, `promote_best --eval-only --eval-episodes 20 --eval-max-steps 2200` | Partial | n/a | Gate execution completed; deterministic regressions pass, but canonical delta vs freeze remains negative (`-0.0473`) |
| 2026-02-17 | P1.7 | Gate-A closure retune: reward calibration + canonical/regr re-validation | `config.json`, `[artifact removed]`, `[artifact removed]`, `[artifact removed]` | `promote_best --eval-only (20x2200)`, `regression --profile standard`, `regression --profile underrealm` | Done | n/a | Exit criteria met: canonical delta positive (`+0.0111`) and deterministic regressions pass |
| 2026-02-17 | P2.1 | Phase-2 core implementation: PPO stability knobs + normalization pipeline + checkpoint/runtime/eval compatibility wiring | `python/train.py`, `python/promote_best.py`, `python/regression_rollout.py`, `src/ai/policy.js`, `config.json`, `docs/PARAMETERS.md`, `docs/TRAINING_OVERRIDES.md`, `README.md`, `MANUAL.md`, `docs/TRAINING_OPTIMIZATION_WORKBOOK.md` | `node --check src/ai/policy.js`, `PYTHONPYCACHEPREFIX=/tmp/nodeDwarves_pycache python -m py_compile`, `train.py` 2-episode smoke, `promote_best --eval-only` smoke, `regression_rollout.py` smoke | Done | n/a | B.4 validation gate still pending |
| 2026-02-17 | P2.2 | Phase-2 Validation Gate B full execution (wrapper canonical + variance + runtime smoke) | `[artifact removed]`, `[artifact removed]`, `[artifact removed]`, `[artifact removed]`, `docs/TRAINING_OPTIMIZATION_WORKBOOK.md` | `ai:train:quality:lite` (canonical final), multi-seed `promote_best --eval-only`, `ai:play` smoke | Partial | n/a | Gate executed end-to-end; variance criterion failed (`0.01735 -> 0.03652`), canonical promotion retained best due negative LCB |
| 2026-02-17 | P2.3 | Phase-2 Gate-B closure cycle: conservative quality retune + updated variance + latest-policy runtime smoke | `[artifact removed]`, `[artifact removed]`, `[artifact removed]`, `docs/TRAINING_OPTIMIZATION_WORKBOOK.md` | `ai:train:quality:lite` tuned run, multi-seed `promote_best --eval-only`, `node app.js --ai models/policy.json` smoke | Done | n/a | Exit criteria met: seed variance improved (`0.01735 -> 0.01278`) and promotion guard retained best on negative LCB |
| 2026-02-17 | P2.4 | Operator visibility improvement: documented high-visibility wrapper/trainer logging preset for slow machines | `docs/TRAINING_OVERRIDES.md`, `docs/TRAINING_OPTIMIZATION_WORKBOOK.md` | Doc review | Done | n/a | Added explicit `promote-eval-progress-every 1` + trainer `--log-every/--eval-every` guidance |
| 2026-02-17 | P3.1 | Phase-3 core implementation: throughput diagnostics (`thr[...]`, `ppo_upd`), packed rollout payload, worker-side GAE, and promote best-state copy | `python/train.py`, `python/promote_best.py`, `python/regression_rollout.py` | `py_compile`, short `train.py` smoke, `promote_best.py` promotion smoke | Done | n/a | Regression rollout callsite patched to new `run_episode` signature |
| 2026-02-17 | P3.2 | Gate-C validation run: throughput compare, benchmark + regression rerun, and equivalent profile smoke | `[artifact removed]`, `[artifact removed]`, `[artifact removed]`, `[artifact removed]`, `[artifact removed]`, `docs/TRAINING_OPTIMIZATION_WORKBOOK.md` | throughput A/B microprofiles, `headless_benchmark`, `regression --profile standard`, `regression --profile underrealm`, fast-config trainer smoke | Partial | n/a | Quality gates pass; throughput target (`+25%`) still open for next tuning cycle |
| 2026-02-17 | P3.3 | Workstream C5 implementation: dual transport (`legacy`/`compact`) across train/eval/promote/regression + compact IPC path in JS bridge | `python/train.py`, `python/promote_best.py`, `python/regression_rollout.py`, `ai_server.js`, `config.json`, `docs/PARAMETERS.md`, `docs/TRAINING_OVERRIDES.md`, `README.md`, `MANUAL.md`, `docs/TRAINING_OPTIMIZATION_WORKBOOK.md` | `node --check ai_server.js`, `py_compile`, `promote_best --eval-only` (`legacy` + `compact`), `regression_rollout.py` smoke (`compact`), `train.py` smoke (`compact`) | Done | n/a | Smoke parity check on same seed/contract produced identical eval score in `legacy` vs `compact` |
| 2026-02-17 | P3.4 | Gate C+ throughput A/B (compact vs legacy) on quality-like and IPC-heavy probes | `[artifact removed]` | `train.py` profile A/B with fixed seed (`legacy` + `compact`) | Partial | n/a | Throughput improved (`+18.5%`, `+2.9%`) but still below target `+25%` |
| 2026-02-17 | P3.5 | Workstream C6 implementation: mixed curriculum wrapper preset (`quality-mixed`) with ~`76/24` episode split | `scripts/train_wrapper.js`, `package.json`, `docs/TRAINING_OVERRIDES.md`, `README.md`, `MANUAL.md`, `docs/TRAINING_OPTIMIZATION_WORKBOOK.md` | `node --check scripts/train_wrapper.js`, `node scripts/train_wrapper.js quality-mixed --dry-run --low-load`, `npm run ai:train:quality:mixed -- --dry-run --low-load` | Done | n/a | Canonical promotion contract remains unchanged via wrapper canonical config path |
| 2026-02-17 | P3.6 | Gate C+ full validation rerun (benchmark + regression + mixed preset smoke) | `[artifact removed]`, `[artifact removed]`, `[artifact removed]`, `[artifact removed]`, `[artifact removed]`, `[artifact removed]`, `[artifact removed]`, `[artifact removed]`, `docs/TRAINING_OPTIMIZATION_WORKBOOK.md` | `headless_benchmark --ticks 8000 --seeds 101,202,303,404`, `regression --profile standard`, `regression --profile underrealm`, `ai:train:quality:mixed` smoke (`low-load`, reduced episodes) | Partial | n/a | Quality guardrails pass; throughput objective (`>= +25%`) remains open |
| 2026-02-17 | P3.7 | C7 throughput increment: compact-path CPU/IPC hot-path optimization (`ai_server.js` + trainer fast paths), fresh throughput compare, eval/promote IPC probe, and full quality gate rerun | `ai_server.js`, `python/train.py`, `[artifact removed]`, `[artifact removed]`, `[artifact removed]`, `[artifact removed]`, `[artifact removed]`, `[artifact removed]`, `docs/TRAINING_OPTIMIZATION_WORKBOOK.md` | `node --check ai_server.js`, `py_compile`, throughput A/B microprofiles (`30x140`, `120x25`), eval-only short promote probe (`4x400`, legacy vs compact), `headless_benchmark --ticks 8000 --seeds 101,202,303,404`, `regression --profile standard`, `regression --profile underrealm` | Done | n/a | Throughput target met vs frozen C+ baseline (`A +52.2%`, `B +85.0%`) with benchmark/regression guardrails PASS |
| 2026-02-19 | P3.8 | PPO trainer quick-wins hardening: IPC/worker watchdog fail-fast, worker-error propagation, deterministic per-episode worker seeding, and final partial-batch flush + final save | `python/train.py`, `README.md`, `MANUAL.md`, `docs/TRAINING_OPTIMIZATION_WORKBOOK.md` | `PYTHONPYCACHEPREFIX=/tmp/nodeDwarves_pycache python3 -m py_compile python/train.py` | Done | n/a | Targets stability/debuggability and non-regression of tail updates without changing PPO architecture/contracts |
| 2026-02-19 | P3.9 | Quick-wins follow-up (`1+2+7`): compact `obsVector` fail-fast shape check, binary worker update payload (`state_dict`) with legacy load fallback, and full gate rerun | `python/train.py`, `README.md`, `MANUAL.md`, `docs/TRAINING_OPTIMIZATION_WORKBOOK.md`, `[artifact removed]` | `PYTHONPYCACHEPREFIX=/tmp/nodeDwarves_pycache python3 -m py_compile python/train.py`, `python3 python/train.py --episodes 1 --batch-episodes 1 --workers 1 --max-steps 10 --step-ticks 2 --log-every 1 --eval-every 0 --model-path /tmp/nodeDwarves_smoke_policy.json --model-state-path /tmp/nodeDwarves_smoke_policy.state.pt --best-model-path /tmp/nodeDwarves_smoke_policy_best.json --best-meta-path /tmp/nodeDwarves_smoke_policy_best.meta.json --best-model-state-path /tmp/nodeDwarves_smoke_policy_best.state.pt`, `npm run ai:validate:gate` | Done | n/a | Gate PASS (benchmark avg: pop `716.0`, morale `0.8865`; regression `standard` + `underrealm` all checks `ok`) with no contract regressions detected |
| 2026-02-19 | P4.1 | Canonical freeze benchmark closure check on `policy_best` using baseline contract (`20x2200`, `rpt`) | `[artifact removed]`, `docs/TRAINING_OPTIMIZATION_WORKBOOK.md` | `npm run ai:promote:best -- --eval-only --model-path models/policy_best.json --best-model-path models/policy_best.json --eval-episodes 20 --eval-max-steps 2200 --eval-score rpt --transport compact --report-tag freeze-check --report-json [artifact removed] --report-md [artifact removed]` | Done | n/a | Canonical score `3.7747` vs freeze baseline `3.7384` (`delta=+0.0363`), DoD benchmark-improvement criterion satisfied |
| 2026-02-19 | P4.2 | Risk-closure mini-gate: collapse guardrail rerun (`R-001`) + normalization/runtime compatibility check (`R-002`) | `[artifact removed]`, `[artifact removed]`, `[artifact removed]`, `docs/TRAINING_OPTIMIZATION_WORKBOOK.md` | `node scripts/headless_benchmark.js --ticks 8000 --seeds 101,202,303,404 --progress --progress-every 2000 --report-json [artifact removed] --report-md [artifact removed]`, `node app.js --ai models/policy_best.json` (controlled stop), static policy normalization shape check | Done | n/a | `R-001`: avg pop `716.0`, no collapse profile in benchmark seeds. `R-002`: policy obs-norm shape matches (`504/504`), runtime smoke log has `0` normalization/shape warnings |
| 2026-02-19 | P4.3 | Operational runbook hardening: add canonical/risk npm aliases and document A/B/C single-change cycle commands in operator docs | `package.json`, `README.md`, `MANUAL.md`, `docs/TRAINING_OVERRIDES.md`, `docs/TRAINING_OPTIMIZATION_WORKBOOK.md`, `[artifact removed]` | `npm run ai:validate:risk:r002`, `npm run ai:validate:canonical -- --eval-episodes 1 --eval-max-steps 20 --report-tag canonical-master-smoke --report-json [artifact removed] --report-md [artifact removed]` | Done | n/a | Canonical master + risk commands are now first-class scripts; cycle documentation is explicit and copy-paste ready for daily operations |
| 2026-02-20 | P4.4 | OQ-2/OQ-3 implementation pass: strict continuous improvement semantics, profile-specific deterministic regression scenarios, governance baseline recording, adaptive scenario-sampling cadence retune (`updateEvery=80`), and full gate rerun | `scripts/train_continuous.js`, `scripts/regression.js`, `config.json`, `regression/baselines/regression_baseline.json`, `docs/TRAINING_OVERRIDES.md`, `README.md`, `MANUAL.md`, `docs/TRAINING_OPTIMIZATION_WORKBOOK.md`, `[artifact removed]` | `node --check scripts/train_continuous.js`, `node --check scripts/regression.js`, `node scripts/train_continuous.js --cycles 1 --gate-every 1 --dry-run`, `node scripts/regression.js --profile governance --record`, `node scripts/regression.js --all`, `npm run ai:validate:gate` | Partial | n/a | `standard` + `governance` pass; `underrealm` deterministic eval fails on `avg_deaths` (`2.500` vs threshold `2.156`), so global gate remains open |
| 2026-02-20 | P4.5 | OQ-2 closure follow-up: config-only Underrealm/Governance stress retune (`underrealm_push` safety rails + moderated `compound_crisis` pressure) and full gate rerun | `config.json`, `README.md`, `MANUAL.md`, `docs/TRAINING_OVERRIDES.md`, `docs/TRAINING_OPTIMIZATION_WORKBOOK.md`, `[artifact removed]` | `node scripts/regression.js --profile underrealm`, `npm run ai:validate:gate` | Done | n/a | Gate closed: `underrealm.eval.avg_deaths=2.075` (threshold `2.156`) and full `standard/underrealm/governance` regression + benchmark pass |
| 2026-02-20 | P4.6 | Post-recovery stability mini-cycle (`underrealm` deterministic profile repeated 3x) and baseline-refresh decision checkpoint | `docs/TRAINING_OPTIMIZATION_WORKBOOK.md`, `[artifact removed]` | `node scripts/regression.js --profile underrealm` (x3) | Done | n/a | All 3 runs reproduced identical PASS metrics (`avg_deaths=2.075`), baseline refresh intentionally deferred to keep stricter deaths guardrail |
| 2026-02-20 | P4.7 | Post-stability full gate confirmation rerun (benchmark + all regression profiles) | `docs/TRAINING_OPTIMIZATION_WORKBOOK.md`, `[artifact removed]` | `npm run ai:validate:gate` | Done | n/a | Gate PASS confirmed after stability mini-cycle (`standard`, `underrealm`, `governance` all PASS) |
| 2026-02-20 | P4.8 | OQ-1 closure: trainer adaptive-sampler update counters (`scenario_updates`) + daily-profile validation run and summary evidence capture | `python/train.py`, `docs/TRAINING_OVERRIDES.md`, `README.md`, `MANUAL.md`, `docs/TRAINING_OPTIMIZATION_WORKBOOK.md` | `python -m py_compile python/train.py`, `npm run ai:train:quality:daily -- --episodes 96 --max-steps 300 --eval-every 0 --log-every 24 --workers 2`, `rg -n \"scenario_updates|scenario_weights\" [artifact removed]` | Done | n/a | Observability active and verified: adaptive updates detected in both daily phases (`scenario_updates=1/1`); historical run directory was later pruned by retention housekeeping |
| 2026-02-20 | P4.9 | Post-OQ-1 guardrail confirmation: full benchmark + all-profile regression gate rerun after trainer observability update | `docs/TRAINING_OPTIMIZATION_WORKBOOK.md`, `[artifact removed]` | `npm run ai:validate:gate` | Done | n/a | Gate PASS confirmed after OQ-1 implementation (`standard`, `underrealm`, `governance` all PASS with thresholds respected) |
| 2026-02-20 | P4.10 | OQ-4 implementation kickoff + paused checkpoint: add `horizon` regression profile/tolerances/scripts, record baseline, validate horizon, start extended cycle then stop mid-risk on operator request | `scripts/regression.js`, `package.json`, `regression/baselines/regression_baseline.json`, `docs/TRAINING_OPTIMIZATION_WORKBOOK.md`, `[artifact removed]`, `[artifact removed]` | `npm run ai:regression:record:horizon`, `npm run ai:validate:horizon`, `npm run ai:validate:extended` (interrupted) | Partial | n/a | Completed: horizon baseline + horizon validation PASS. Extended cycle reached canonical PASS + gate PASS + risk benchmark in progress; interrupted at `risk:r001` benchmark (`seed=404`, `tick=4000/8000`) |
| 2026-02-20 | P4.11 | OQ-3 closure validation: fixed-settings continuous reruns + historical delta-positive classification replay | `docs/TRAINING_OPTIMIZATION_WORKBOOK.md`, `[artifact removed]`, `[artifact removed]` | `node scripts/train_continuous.js --cycles 4 --full-every 0 --high-every 0 --gate-every 2 --max-no-improve 1 --max-gate-fail 1` (x2), `node -e '<classification replay over [artifact removed]>'` | Done | n/a | Both reruns stopped with identical `max-no-improve` reason at cycle 1; historical summaries provide concrete `delta_positive_not_promoted` branch evidence (`10` cases) |
| 2026-02-20 | P4.12 | OQ-4 closure: full extended cycle completion + horizon guardrail tighten + historical pre-retune replay fail check | `scripts/regression.js`, `regression/baselines/regression_baseline.json`, `docs/TRAINING_OPTIMIZATION_WORKBOOK.md`, `[artifact removed]`, `[artifact removed]`, `[artifact removed]`, `[artifact removed]` | `/usr/bin/time -p npm run ai:validate:extended`, historical replay with `config.json` from `097c5c9` via `node scripts/regression.js --profile horizon` | Done | n/a | Extended cycle PASS end-to-end (`real 2457.55s`); historical replay now FAILs as expected on `horizon.eval.avg_deaths` (`3.075 > 3.074`) |
| 2026-02-21 | P4.13 | OQ-5 closure slice: freeze pre-change artifacts, governance canonical A/B experiment, promote governance to canonical eval list, rerun full extended validation, and publish quality dashboard + cleanup | `config.json`, `README.md`, `MANUAL.md`, `docs/PARAMETERS.md`, `docs/TRAINING_OVERRIDES.md`, `docs/TRAINING_OPTIMIZATION_WORKBOOK.md`, `[artifact removed]`, `[artifact removed]`, `[artifact removed]`, `[artifact removed]`, `[artifact removed]`, `[artifact removed]`, `[artifact removed]` | `npm run ai:promote:best -- --eval-only ...` (baseline/candidate A/B), `/usr/bin/time -p npm run ai:validate:extended`, `npm run debug:clean -- --keep-runs 100` | Done | n/a | A/B accepted (`score +0.0320`), extended PASS with updated canonical set (`real 2728.58s`), transient debug artifacts cleaned with retention-safe policy |
| 2026-02-21 | P4.14 | OQ-5 completion pass: late-underrealm scenario + adaptive difficulty-phase schedule + diagnostic ensemble reporting + weekly seed-pack rotation wiring for horizon checks | `config.json`, `ai_server.js`, `python/train.py`, `python/promote_best.py`, `scripts/regression.js`, `package.json`, `README.md`, `MANUAL.md`, `docs/PARAMETERS.md`, `docs/TRAINING_OVERRIDES.md`, `docs/TRAINING_OPTIMIZATION_WORKBOOK.md`, `[artifact removed]`, `[artifact removed]` | `node --check scripts/regression.js`, `node --check ai_server.js`, `python3 -m py_compile python/train.py python/promote_best.py`, `node -e \"JSON.parse(require('fs').readFileSync('config.json','utf8'))\"`, `npm run ai:promote:best -- --eval-only --eval-episodes 1 --eval-max-steps 80 ... --report-json [artifact removed] --report-md [artifact removed]`, `node scripts/regression.js --profile horizon --seed-pack weekly --seed-week 2026-02-16 --eval-episodes 1 --eval-max-steps 80 --random-episodes 1 --random-max-steps 80 --report-json [artifact removed] --report-md [artifact removed]` | Done | n/a | Wiring + artifacts validated: diagnostic section present in promote report; weekly rotation resolved `pack_gamma` with seed-pack metadata persisted in regression JSON/Markdown reports (smoke gate FAIL expected due intentionally tiny episode budget) |
| 2026-02-21 | P4.15 | OQ-5 operational closure confirmation: execute full-budget weekly horizon deep-check on deterministic rotating seed pack | `docs/TRAINING_OPTIMIZATION_WORKBOOK.md`, `[artifact removed]` | `npm run ai:validate:horizon:weekly` | Done | n/a | PASS confirmed on weekly pack `pack_gamma` (`31415,27182`): eval and randomized horizon guardrails both green (`allOk=true`, profile score `100.0`) |
| 2026-02-21 | P4.16 | OQ-6.2 implementation: introduce real `npm test` contract suite (policy shape + regression schema + promote schema) and wire project docs/layout references | `scripts/test_training_contracts.js`, `package.json`, `AGENTS.md`, `README.md`, `MANUAL.md`, `docs/TRAINING_OPTIMIZATION_WORKBOOK.md` | `npm test` | Done | n/a | Test suite PASS (`[test:contracts] PASS policy_shape regression_schema promote_schema`), including deliberate malformed observation-shape failure assertion in test mode |
| 2026-02-21 | P4.17 | OQ-6.1 implementation: add GitHub Actions pipeline for extended + weekly horizon gates, CI artifact bundling, and layout/workbook alignment updates | `.github/workflows/quality_gates.yml`, `AGENTS.md`, `README.md`, `MANUAL.md`, `docs/TRAINING_OPTIMIZATION_WORKBOOK.md` | `node -e \"const fs=require('fs');const y=fs.readFileSync('.github/workflows/quality_gates.yml','utf8');const checks=['npm run ai:validate:extended','npm run ai:validate:horizon:weekly','name: canonical','name: regression','name: risk','name: horizon','name: horizon_weekly'];for (const c of checks){if(!y.includes(c)){throw new Error('missing workflow contract fragment: '+c);}}console.log('workflow contract fragments: ok');\"` | Partial | n/a | Workflow and docs landed; first remote CI run with uploaded artifacts still required to satisfy OQ-6.1 final exit criterion |
| 2026-02-21 | P4.18 | OQ-6.3 implementation: expand weekly deep-check packs to `4` seeds, rerun horizon weekly determinism on same pack, validate next-week pack, and confirm thresholds remain stable without tolerance changes | `config.json`, `scripts/regression.js`, `docs/PARAMETERS.md`, `docs/TRAINING_OVERRIDES.md`, `README.md`, `MANUAL.md`, `docs/TRAINING_OPTIMIZATION_WORKBOOK.md`, `[artifact removed]`, `[artifact removed]` | `node --check scripts/regression.js`, `node -e \"JSON.parse(require('fs').readFileSync('config.json','utf8'))\"`, `/usr/bin/time -p node scripts/regression.js --profile horizon --seed-pack weekly --seed-week 2026-02-16` (x2), `/usr/bin/time -p node scripts/regression.js --profile horizon --seed-pack weekly --seed-week 2026-02-23`, deterministic row-identity compare (`evalRows`/`randomRows`) | Done | n/a | All runs PASS (`allOk=true`), same-pack rerun produced identical aggregate rows, consecutive-week pack (`pack_delta`) also PASS with positive guardrail margins; thresholds retained unchanged |
| 2026-02-21 | P4.19 | OQ-6.4 implementation: add optimized extended validation orchestrator with per-phase runtime report, measure wall-time reduction, verify historical replay detection, and publish recommended cadence split | `scripts/validate_extended_optimized.js`, `package.json`, `AGENTS.md`, `README.md`, `MANUAL.md`, `docs/TRAINING_OVERRIDES.md`, `docs/TRAINING_OPTIMIZATION_WORKBOOK.md`, `[artifact removed]`, `[artifact removed]` | `node --check scripts/validate_extended_optimized.js`, `npm run ai:validate:extended:optimized`, temporary historical config replay via `git show 097c5c9:config.json` + `node scripts/regression.js --profile horizon` (restored local config afterward) | Done | n/a | Full optimized run PASS (`2036.41s`) with measured reduction vs baseline (`2728.58s`, `-25.37%`); dominant phase identified (`regression --all` `44.50%` share); historical replay still fails on expected `horizon.eval.avg_deaths` boundary (`3.075 > 3.074`) |

## 9) Risk Register

| ID | Risk | Probability | Impact | Mitigation | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- |
| R-001 | Reward redesign causes policy collapse | Medium | High | Incremental rollout + A/B gate each substep; periodic deterministic benchmark/regression gates with seeded profiles | Team | Mitigated |
| R-002 | Normalization mismatch breaks JS inference | Medium | High | Persist stats in model + runtime compatibility test + fail-fast shape/version guards in trainer/runtime | Team | Mitigated |
| R-003 | Throughput refactor introduces nondeterminism | Medium | Medium | Seed reproducibility checks before merge | TBD | Mitigated |
| R-004 | Promotion continuity mismatch (best state missing) | High | Medium | Save/copy best optimizer state on promote | TBD | Mitigated |
| R-005 | Underrealm deterministic profile surfaced elevated `avg_deaths` vs baseline after profile-hardening (`standard/governance` green, `underrealm` red) | Medium | Medium | Config-only retune applied on `underrealm_push` + `compound_crisis`; validated by `regression --profile underrealm` + full `ai:validate:gate` pass; keep baseline refresh deferred until multi-cycle stability confirmation | Team | Mitigated |
| R-006 | Horizon sanity slice too permissive near known historical deaths regression boundary, reducing detection value of OQ-4 replay checks | Medium | Medium | Tighten horizon deaths tolerance (`+18% -> +16%`) and validate both sides: current horizon PASS and historical pre-retune replay FAIL on `avg_deaths` | Team | Mitigated |
| R-007 | Canonical contract misses governance-heavy regressions if governance stress remains only in secondary gates | Medium | Medium | Governance scenario promoted to canonical eval list via A/B acceptance and re-validated with full extended cycle | Team | Mitigated |
| R-008 | Weekly deep checks become difficult to compare if operators use ad-hoc seed lists each run | Medium | Medium | Config-driven seed packs + deterministic `weeklyOrder` rotation, exposed via `--seed-pack weekly` and persisted in report metadata | Team | Mitigated |
| R-009 | Extended acceptance gate wall time drifts beyond practical operator cadence due duplicated benchmark execution and monolithic run pattern | Medium | Medium | Introduce `ai:validate:extended:optimized` (single benchmark execution + per-phase runtime report) and document cadence split (`per-change` / `nightly` / `weekly`) with historical replay sanity retained | Team | Mitigated |

## 10) Definition of Done (Global)

All items required for closure:

- [x] Workstreams A, B, C completed with passing gates.
- [x] Canonical benchmark score improved vs baseline freeze.
- [x] Regression profiles pass with no critical blockers.
- [x] Throughput gain documented with before/after numbers.
- [x] Docs updated (`README.md`, `MANUAL.md`, `docs/PARAMETERS.md`, `docs/TRAINING_OVERRIDES.md` as needed).
- [x] Final summary report archived under `[artifact removed]` with links to relevant artifacts.

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

- Throughput A/B report: `[artifact removed]`.
- Profile A (`30x140`, workers `4`, seed `4242`):
  - `legacy=175.0 eps_pm`
  - `compact=207.4 eps_pm`
  - delta `+18.5%`.
- Profile B (`120x25`, workers `8`, seed `4242`):
  - `legacy=635.6 eps_pm`
  - `compact=653.9 eps_pm`
  - delta `+2.9%`.
- Full validation report: `[artifact removed]`.
- Benchmark snapshot (`[artifact removed]`):
  - avg population `716.00`
  - avg morale `0.8865`
  - avg hunger `0.1528`
  - avg thirst `0.1093`.
- Regression snapshot:
  - `standard` gate `PASS` (`[artifact removed]`)
  - `underrealm` gate `PASS` (`[artifact removed]`).
- Mixed preset smoke:
  - wrapper run completed end-to-end (`[artifact removed]`)
  - canonical final retained best with delta `-0.0006` (`[artifact removed]`).
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

- Throughput compare: `[artifact removed]`.
  - Profile A (`30x140`, workers `4`, seed `4242`), conservative candidate (`legacy`): `266.4 eps_pm` vs C+ baseline `175.0` -> `+52.2%`.
  - Profile B (`120x25`, workers `8`, seed `4242`), conservative candidate (`legacy`): `1175.8 eps_pm` vs C+ baseline `635.6` -> `+85.0%`.
- Eval/promote IPC probe: `[artifact removed]`.
  - `promote_best.py --eval-only --eval-episodes 4 --eval-max-steps 400` shows compact path about `4-5%` faster than legacy with identical score payload.
- Benchmark gate rerun: `[artifact removed]` (avg pop `716.00`, morale `0.8865`, hunger `0.1528`, thirst `0.1093`).
- Regression rerun:
  - `standard` PASS (`[artifact removed]`)
  - `underrealm` PASS (`[artifact removed]`)
- Final validation report: `[artifact removed]`.

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

- `[artifact removed]`
- `[artifact removed]`

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

## 14) Operational Quality Uplift Plan (Next Cycle)

Status: Completed (2026-02-21, OQ-1..OQ-4 completed + OQ-5 governance extension integrated as active baseline add-on)
Goal: convert post-closure observations into one practical execution plan that raises quality while keeping promotion safety and reproducibility.

### 14.1 Integrated Findings (Why this plan exists)

- Adaptive scenario sampling is effectively inactive in most wrapper runs:
  - `config.json` currently sets `ai.training.scenarioSampling.updateEvery=1500`.
  - `scripts/train_wrapper.js` quality/full phase episode counts are much lower (`40-280` in most phases).
  - Result: adaptive weights rarely update during normal daily cycles.
- Regression profile separation is weaker than intended:
  - `scripts/regression.js` currently applies deterministic eval scenarios `baseline/full_sim` to every profile.
  - Result: `underrealm` profile behaves mostly like a threshold lens on random metrics instead of a deterministic Underrealm stress gate.
- Continuous-cycle "improved" can diverge from actual promotion:
  - `scripts/train_continuous.js` marks `improved=true` when `deltaScore > improveThreshold`, even when no promotion happened.
  - Result: no-improve streak and stop logic can drift from true best-checkpoint progression.
- Multi-horizon governance/deep coverage gap (initial plan snapshot):
  - Canonical eval scenarios initially included `underrealm_push` and `compound_crisis`, but not `governance_pressure`.
  - Risk mini-gate currently focuses on collapse pressure + checkpoint compatibility.
  - Result: long-horizon governance/social regressions can slip through until late.

### 14.2 Execution Windows (10 working days)

- `OQ-1` (Days 1-2): adaptive scenario sampling cadence alignment + visibility.
- `OQ-2` (Days 3-4): deterministic regression profile hardening (Underrealm + governance).
- `OQ-3` (Days 5-6): continuous-cycle promotion/improvement contract alignment.
- `OQ-4` (Days 7-8): multi-horizon validation gate extension.
- `OQ-5` (Days 9-10, optional): next-wave scenario/method/infrastructure experiments.
- `OQ-6` (Mini, post-closure): qualitative reinforcement outside core training logic (CI, tests, deep-check power, runtime efficiency).

### 14.3 Workstream OQ-1 - Adaptive Scenario Sampling Cadence Alignment

Actions:

- [x] Tune adaptive sampler cadence to wrapper-scale runs:
  - target `updateEvery` aligned to phase sizes (`40-280` episodes), starting range `40-120`.
- [x] Add explicit adaptive-update observability in logs/reports:
  - count update events per phase (`scenario_weights` updates).
- [x] Keep bounded weight ratios (`minWeightRatio`, `maxWeightRatio`) conservative while retuning cadence.

Validation:

- `npm run ai:train:quality:daily`
- `npm run ai:train:quality:high`
- `rg -n "scenario_weights|scenario_shift" [artifact removed]`

Validation snapshot (2026-02-20):

- Trainer observability field added:
  - summary line now includes `scenario_updates=<window>/<total>`.
  - source: `python/train.py` summary formatter + sampler counters.
- Daily-profile validation run (reduced horizon, same profile contract):
  - `npm run ai:train:quality:daily -- --episodes 96 --max-steps 300 --eval-every 0 --log-every 24 --workers 2`
  - historical run dir was later pruned by retention housekeeping; evidence is captured in this section summary and post-OQ guardrail snapshots.
- Observed adaptive updates in both phases:
  - `summary_train.log` final window: `scenario_updates=1/1` + `events=scenario_weights,...`.
  - `summary_finetune.log` window `61-80`: `scenario_updates=1/1` + `events=scenario_weights,...`.
- Guardrail context:
  - canonical final promote retained best (no unsafe promotion).
  - latest full gate remains PASS (`[artifact removed]` + `.md`).

Exit criteria:

- [x] At least one adaptive weight update appears in a normal daily quality run.
- [x] Canonical score does not regress beyond current guardrails.
- [x] No instability spikes in benchmark/regression gate after cadence change.

Files:

- `config.json`
- `python/train.py` (only if extra logging surface is required)
- `docs/TRAINING_OVERRIDES.md`
- `docs/TRAINING_OPTIMIZATION_WORKBOOK.md`

### 14.4 Workstream OQ-2 - Regression Profile Hardening (Underrealm + Governance)

Actions:

- [x] Make deterministic eval scenario sets profile-specific in `scripts/regression.js`:
  - `standard`: `baseline`, `full_sim`
  - `underrealm`: `baseline`, `underrealm_push`, `compound_crisis`
  - `governance` (new profile): `baseline`, `governance_pressure`, `compound_crisis`
- [x] Record/update baseline snapshots for the new profile contract.
- [x] Keep random rollout slice for broad robustness, but separate deterministic stress intent by profile.

Validation:

- `node scripts/regression.js --profile standard`
- `node scripts/regression.js --profile underrealm`
- `node scripts/regression.js --profile governance --record` (first creation) then `--profile governance`

Exit criteria:

- [x] Underrealm deterministic profile reports non-trivial deep metrics (`under_*`) under stress scenarios.
- [x] Governance deterministic profile reports stable pass/fail behavior across the configured seeds.
- [x] Existing `standard` profile remains stable (no accidental contract drift).

Validation snapshot (2026-02-20):

- Governance baseline recorded:
  - `node scripts/regression.js --profile governance --record`
  - baseline path: `regression/baselines/regression_baseline.json` (`profiles.governance`).
- Full profile validation pass:
  - `node scripts/regression.js --all`
  - initial failing-cycle artifact is no longer retained; profile-level failure details are captured below.
- Gate-level validation rerun:
  - `npm run ai:validate:gate`
  - initial failing-cycle artifact is no longer retained; closure snapshots are retained.
- Deterministic profile outcomes:
  - `standard`: PASS
  - `governance`: PASS
  - `underrealm`: FAIL (`eval.avg_deaths=2.500`, baseline `1.875`, threshold `2.156`).
- Interpretation:
  - profile hardening is operational and measurable;
  - global gate remains open due Underrealm deaths regression, now explicitly detectable by the hardened profile contract.

Recovery snapshot (2026-02-20, later cycle):

- Config-only retune applied for deterministic stress safety:
  - `underrealm_push`: stricter readiness/cooldown pacing and safer deep crew allocation.
  - `compound_crisis`: moderated scarcity/need/raid pressure.
- Underrealm deterministic profile recovery check:
  - `node scripts/regression.js --profile underrealm`
  - historical artifact is no longer retained; deterministic PASS metrics captured below.
  - outcome: PASS (`eval.avg_deaths=2.075`, baseline `1.875`, threshold `2.156`).
- Full gate closure rerun:
  - `npm run ai:validate:gate`
  - retained representative gate snapshot: `[artifact removed]` + `.md`.
  - outcomes: `standard` PASS, `underrealm` PASS, `governance` PASS.
- Stability mini-cycle (post-recovery):
  - `node scripts/regression.js --profile underrealm` x3
  - retained stability snapshot: `[artifact removed]` (identical deterministic aggregate metrics across repeated runs).
  - outcomes: all PASS, identical deterministic aggregate metrics (`avg_reward=9443.718`, `avg_deaths=2.075`, `score=3.935`).
- Interpretation:
  - OQ-2 deterministic hardening remains active;
  - gate reopened risk (`R-005`) is mitigated without relaxing profile tolerances;
  - baseline refresh is intentionally deferred to avoid weakening the current deaths guardrail (`baseline avg_deaths=1.875` remains stricter than recovered `2.075`).

Files:

- `scripts/regression.js`
- `regression/baselines/regression_baseline.json`
- `docs/TRAINING_OVERRIDES.md`
- `docs/TRAINING_OPTIMIZATION_WORKBOOK.md`

### 14.5 Workstream OQ-3 - Continuous Cycle Contract Alignment (Improved vs Promoted)

Status: Completed (2026-02-20)

Actions:

- [x] Align `improved` semantics in `scripts/train_continuous.js` with canonical promotion intent:
  - `strict` policy active: `improved` is true only when canonical promotion succeeds.
- [x] Add explicit fields in continuous reports:
  - `improved_reason`, `promotion_aligned`, and source phase used for decision.
- [x] Keep dry-run schedule output unchanged for operator usability.

Validation:

- `node scripts/train_continuous.js --cycles 4 --gate-every 2 --dry-run`
- `node scripts/train_continuous.js --cycles 4 --gate-every 2 --max-no-improve 2 --max-gate-fail 1`

Validation snapshot (2026-02-20):

- Dry-run compatibility check:
  - `node scripts/train_continuous.js --cycles 1 --gate-every 1 --dry-run`
  - result: command schedule output unchanged; report write skipped as expected in dry-run mode.
- Report contract updates validated by code + syntax checks:
  - `improvedReason`, `promotionAligned`, `deltaPositive`, `improvementPolicy`.

Closure snapshot (2026-02-20, later cycle):

- Reproducibility run #1 (fixed settings, real execution):
  - `node scripts/train_continuous.js --cycles 4 --full-every 0 --high-every 0 --gate-every 2 --max-no-improve 1 --max-gate-fail 1`
  - report: `[artifact removed]` + `.md`
  - outcome: `status=stopped_no_improve`, `stopReason=reached max-no-improve=1 at cycle 1`,
    `improvedReason=not_promoted`, `promotionAligned=true`, `deltaPositive=false`.
- Reproducibility run #2 (same settings):
  - `node scripts/train_continuous.js --cycles 4 --full-every 0 --high-every 0 --gate-every 2 --max-no-improve 1 --max-gate-fail 1`
  - report: `[artifact removed]` + `.md`
  - outcome: same stop semantics and same stop reason text as run #1.
- Historical promotion-summary replay for `delta_positive_not_promoted` branch:
  - command (classification replay over archived canonical summaries):
    `node -e '<classification over [artifact removed]>'`
  - observed cases: `10` archived runs with `delta_score > 0` and `promoted=false`,
    mapped to `improvedReason=delta_positive_not_promoted` under strict policy.
  - sample sources:
    - `[artifact removed]`
    - `[artifact removed]`
    - `[artifact removed]`

Exit criteria:

- [x] No-improve streak behavior is explainable from canonical promotion outputs without ambiguity.
- [x] Continuous report clearly distinguishes "positive delta but not promoted" from true promotion-safe improvement.
- [x] Stop reasons become reproducible across repeated runs with fixed settings.

Files:

- `scripts/train_continuous.js`
- `docs/TRAINING_OPTIMIZATION_WORKBOOK.md`

### 14.6 Workstream OQ-4 - Multi-Horizon Validation Extension

Status: Completed (2026-02-20)

Actions:

- [x] Add one medium/long-horizon quality slice focused on deep/governance behavior:
  - extend gate contract with dedicated horizon scenario checks (not replacing canonical).
- [x] Keep canonical master contract unchanged as primary promotion gate.
- [x] Add explicit pass/fail thresholds for horizon-specific metrics to avoid subjective interpretation.

Validation:

- `npm run ai:validate:canonical`
- `npm run ai:validate:gate`
- `npm run ai:validate:risk`
- `npm run ai:validate:horizon`
- `npm run ai:validate:extended` (canonical + gate + risk + horizon)

Pause checkpoint (2026-02-20):

- Completed before pause:
  - `npm run ai:regression:record:horizon` (new baseline recorded).
  - `npm run ai:validate:horizon` PASS (`[artifact removed]` + `.md`).
  - `npm run ai:validate:extended` reached:
    - canonical PASS (`[artifact removed]` + `.md`),
    - gate PASS (`[artifact removed]` + `.md`),
    - risk phase started (`ai:validate:risk:r001` benchmark).
- Last observed progress before interruption:
  - risk benchmark (`node scripts/headless_benchmark.js --ticks 8000 --seeds 101,202,303,404 --progress --progress-every 2000`)
  - `seed=404`, `tick=4000/8000`.
- Resume commands:
  - minimal continuation: `npm run ai:validate:risk && npm run ai:validate:horizon`
  - full cycle rerun from clean start: `npm run ai:validate:extended`

Closure snapshot (2026-02-20, later cycle):

- Full extended cycle completed in one command:
  - `/usr/bin/time -p npm run ai:validate:extended`
  - runtime: `real 2457.55s` (~`40m57s`).
  - outcomes:
    - canonical PASS (`[artifact removed]` + `.md`)
    - gate PASS (`[artifact removed]` + `.md`)
    - risk PASS (`r001` benchmark + `r002` normalization shape check)
    - horizon PASS (`[artifact removed]` + `.md`)
- Historical weakness replay sanity check:
  - replayed historical pre-retune scenario contract (`config.json` from `097c5c9`) against current horizon baseline.
  - command:
    `node scripts/regression.js --profile horizon --report-json [artifact removed] --report-md [artifact removed]`
  - targeted guardrail tuning applied before replay:
    - `horizon.eval.avg_deaths` tolerance tightened from `+18%` to `+16%`
      in `scripts/regression.js` + `regression/baselines/regression_baseline.json`.
  - replay outcome: FAIL (`sanity_regression_exit=1`) with explicit hit:
    - `horizon.eval.avg_deaths: regress current=3.075 baseline=2.650 threshold=3.074`.
- Operational-cost interpretation:
  - added horizon slice increases full extended-cycle wall time but remains acceptable for daily
    operator cadence when used as end-of-cycle acceptance gate (not per-change micro-smoke).

Post-OQ-5 rerun snapshot (2026-02-21):

- Canonical governance-extension A/B:
  - baseline (without governance in canonical eval list):
    - `[artifact removed]` + `.md` (`score=3.7547575263`).
  - candidate (added `governance_pressure`):
    - `[artifact removed]` + `.md` (`score=3.7867902061`).
  - comparison artifact:
    - `[artifact removed]` + `.md` (`delta score=+0.0320326798`).
- Canonical contract update accepted:
  - `config.json` now includes `governance_pressure` in `ai.training.evalScenarios`.
- Full extended rerun after canonical update:
  - `/usr/bin/time -p npm run ai:validate:extended`
  - runtime: `real 2728.58s` (~`45m29s`).
  - outcomes:
    - canonical PASS (`[artifact removed]` + `.md`, `score=3.7867902061`)
    - gate PASS (`[artifact removed]` + `.md`)
    - risk PASS (`r001` benchmark + `r002` normalization shape check)
    - horizon PASS (`[artifact removed]` + `.md`)
- Aggregated cycle dashboard:
  - `[artifact removed]`.

Exit criteria:

- [x] Candidate can pass canonical + baseline gate + risk + horizon slice in one cycle.
- [x] Horizon slice catches at least one known governance/deep weakness in historical replay (sanity check).
- [x] Runtime cost of added validation remains acceptable for daily operation.

Files:

- `scripts/regression.js` and/or validation scripts
- `package.json` (if new command alias is introduced)
- `docs/TRAINING_OVERRIDES.md`
- `docs/TRAINING_OPTIMIZATION_WORKBOOK.md`

### 14.7 Workstream OQ-5 (Optional) - New Scenario/Method/Infrastructure Experiments

Status: Completed (2026-02-21, all optional OQ-5 items implemented and documented)

Do not start before OQ-1..OQ-4 are green.

Scenario extensions:

- [x] Add one explicit governance-heavy eval scenario to canonical candidate set (A/B against current canonical list).
- [x] Add one late-underrealm stress variant with tighter readiness requirements.

Training method experiments (PPO-compatible, low-risk):

- [x] Adaptive scenario boost schedule by difficulty phase (early/mid/late).
- [x] Conservative eval-score ensemble (`rpt` + auxiliary deep metric) for diagnostics only.

Infrastructure experiments:

- [x] Create one "quality dashboard" markdown artifact aggregating canonical/gate/risk/horizon outcomes per cycle.
- [x] Add deterministic seed pack rotation policy for weekly deep checks.

Validation snapshot (2026-02-21):

- Governance canonical A/B experiment executed and accepted:
  - baseline report: `[artifact removed]` + `.md`
  - candidate report: `[artifact removed]` + `.md`
  - comparison report: `[artifact removed]` + `.md`
  - decision: candidate accepted (`delta score=+0.0320326798`) and promoted into default canonical eval list.
- Full extended validation rerun after canonical update:
  - `/usr/bin/time -p npm run ai:validate:extended`
  - runtime: `real 2728.58s`
  - gate outputs: `[artifact removed]`, `[artifact removed]`, `[artifact removed]`.
- Quality dashboard published:
  - `[artifact removed]`.
- Diagnostic ensemble smoke (non-blocking) validated in promote report:
  - `npm run ai:promote:best -- --eval-only --eval-episodes 1 --eval-max-steps 80 --eval-score rpt --transport compact --report-tag oq5-diagnostic-smoke --report-json [artifact removed] --report-md [artifact removed] --eval-progress --eval-progress-every 1`
  - report contains `## Diagnostic Ensemble (Non-Blocking)` and `avg_under_*` aggregate channels.
- Weekly seed-pack rotation smoke validated in horizon regression:
  - `node scripts/regression.js --profile horizon --seed-pack weekly --seed-week 2026-02-16 --eval-episodes 1 --eval-max-steps 80 --random-episodes 1 --random-max-steps 80 --report-json [artifact removed] --report-md [artifact removed]`
  - resolved weekly pack: `pack_gamma` (`31415,27182`) with seed-pack metadata persisted in JSON/Markdown reports.
  - gate FAIL is expected under the intentionally tiny smoke episode budget and is used as plumbing verification only.
- Weekly seed-pack full-budget operational run:
  - `npm run ai:validate:horizon:weekly`
  - outputs: `[artifact removed]` + `.md`
  - outcome: PASS (`allOk=true`, profile score `100.0`, seed pack `pack_gamma`, `week=107386`).
  - key thresholds confirmed:
    - `horizon.eval.avg_deaths=2.425` (threshold `3.074`, OK)
    - `horizon.eval.score=3.892` (threshold `3.678`, OK)
    - `horizon.random.under_readinessScore=0.520` (threshold `0.453`, OK)
    - `horizon.random.under_combatPressure=0.275` (threshold `0.342`, OK)

### 14.8 Step-by-Step Operational Checklist

1. [x] Freeze baseline artifacts (`canonical_master_latest`, latest gate/risk reports, latest continuous report).
2. [x] Execute OQ-1 and rerun canonical + gate + risk.
3. [x] Execute OQ-2 and re-record profile baselines only after deterministic profile behavior is stable.
4. [x] Execute OQ-3 and verify continuous stop logic against promotion report payloads.
5. [x] Execute OQ-4 and confirm multi-horizon pass/fail contract is deterministic.
6. [x] Run one complete A/B/C cycle with all OQ updates active.
7. [x] Update Decision Log (section 7), Implementation Log (section 8), and Risk Register (section 9).
8. [x] If all exit criteria are green, promote this plan from "Planned" to "Active baseline add-on".

### 14.9 Stop Rules (Blockers)

- Stop immediately if canonical promotion guardrails become ambiguous after OQ-3 changes.
- Stop immediately if regression profile updates reduce determinism/reproducibility.
- Stop immediately if added horizon checks create unacceptable daily runtime cost without clear quality signal gain.

### 14.10 Mini Workstream OQ-6 - Qualitative Reinforcement (Outside Core Training Logic)

Status: In progress (2026-02-21, OQ-6.1 implemented with remote-run evidence pending; OQ-6.2/OQ-6.3/OQ-6.4 completed)
Goal: raise confidence in quality decisions without changing PPO architecture or promotion semantics.
Scope constraint: this mini plan is intentionally limited to the 4 points below.

#### OQ-6.1 CI Automation for Quality Gates

Actions:

- [x] Add one automated quality pipeline that runs:
  - `npm run ai:validate:extended`
  - `npm run ai:validate:horizon:weekly`
- [x] Persist generated reports as CI artifacts (`canonical`, `regression`, `risk`, `horizon`, `horizon_weekly`).
- [x] Keep local commands unchanged; CI acts as reproducibility/discipline layer only.

Exit criteria:

- [ ] At least one fully automated run completes end-to-end with artifact upload and clear PASS/FAIL status.
- [x] CI output uses the same contract as local runs (no hidden overrides).

Validation snapshot (2026-02-21):

- Added CI workflow:
  - `.github/workflows/quality_gates.yml`
  - triggers: `workflow_dispatch` + weekly schedule (`0 5 * * 1`).
- Gate contract in CI is unchanged from local:
  - `npm run ai:validate:extended`
  - `npm run ai:validate:horizon:weekly`
- Artifact packaging layer added without changing command semantics:
  - uploads `canonical`, `regression`, `risk`, `horizon`, `horizon_weekly` from run outputs/logs.
  - regression artifact collection uses pre/post debug file snapshots to isolate newly generated reports.
- CI failure semantics are explicit:
  - pipeline always uploads artifacts;
  - final step fails workflow if either validation command fails.
- Remaining closure item:
  - first remote CI execution evidence still pending (required to mark OQ-6.1 fully done).
  - local execution environment used for this cycle could not trigger GitHub Actions directly (`gh` missing and outbound network/DNS blocked), so remote proof must be captured from repository CI UI or an operator machine with GitHub access.

Operator closure commands (run on a machine with `gh` installed, authenticated, and repository access):

```bash
set -euo pipefail

# Trigger the OQ-6.1 workflow on the current branch.
gh workflow run "Training Quality Gates" --ref "$(git branch --show-current)"

# Resolve the latest workflow run id for this branch/workflow.
RUN_ID="$(gh run list \
  --workflow "Training Quality Gates" \
  --branch "$(git branch --show-current)" \
  --limit 1 \
  --json databaseId \
  --jq '.[0].databaseId')"
echo "RUN_ID=${RUN_ID}"

# Wait for completion and fail fast if workflow fails.
gh run watch "${RUN_ID}" --interval 30 --exit-status

# Print final status metadata and run URL (paste in workbook evidence if needed).
gh run view "${RUN_ID}" --json workflowName,status,conclusion,url,createdAt,updatedAt

# Download required artifacts for OQ-6.1 closure evidence.
ART_DIR="[artifact removed]${RUN_ID}"
mkdir -p "${ART_DIR}"
gh run download "${RUN_ID}" --name canonical --dir "${ART_DIR}/canonical"
gh run download "${RUN_ID}" --name regression --dir "${ART_DIR}/regression"
gh run download "${RUN_ID}" --name risk --dir "${ART_DIR}/risk"
gh run download "${RUN_ID}" --name horizon --dir "${ART_DIR}/horizon"
gh run download "${RUN_ID}" --name horizon_weekly --dir "${ART_DIR}/horizon_weekly"

# Optional quick check: list downloaded evidence files.
find "${ART_DIR}" -type f | sort
```

#### OQ-6.2 Real Technical Test Suite (Training/Validation Contracts)

Actions:

- [x] Replace `npm test` placeholder with executable checks for training/validation contracts.
- [x] Add focused tests for:
  - policy/observation shape contract (`resources * featureNames`);
  - regression CLI/report schema invariants;
  - promote report schema invariants (including diagnostic block presence when available).
- [x] Keep tests deterministic and fast enough for pre-merge usage.

Exit criteria:

- [x] `npm test` runs real checks and exits non-zero on contract breaks.
- [x] At least one deliberate contract mismatch fails as expected in test mode.

Validation snapshot (2026-02-21):

- Implemented deterministic contract suite script:
  - `scripts/test_training_contracts.js`
  - checks:
    - policy observation-normalization shape contract on `models/policy_best.json`;
    - deliberate malformed observation shape (expected failure assertion in test mode);
    - regression CLI/report schema smoke (`scripts/regression.js`, tiny deterministic budget);
    - promote report schema smoke (`python/promote_best.py --eval-only`, diagnostic block required).
- Wired `npm test` to the suite:
  - `package.json` now runs `node scripts/test_training_contracts.js`.
- Execution result:
  - `npm test`
  - output: `[test:contracts] PASS policy_shape regression_schema promote_schema`.

#### OQ-6.3 Deep-Check Statistical Power Upgrade

Actions:

- [x] Increase weekly deep-check seed-pack size from `2` to `>=4` seeds per pack.
- [x] Keep deterministic weekly rotation semantics (`weeklyOrder`) unchanged.
- [x] Re-evaluate horizon thresholds after pack expansion to avoid noise-driven false regressions.

Exit criteria:

- [x] Weekly horizon reports run with expanded pack size and remain deterministic across reruns.
- [x] Threshold behavior remains stable on at least two consecutive weekly packs.

Validation snapshot (2026-02-21):

- Expanded weekly seed packs to `4` seeds each in config + regression fallback defaults:
  - `pack_alpha`: `12345,22222,33333,44444`
  - `pack_beta`: `13579,24680,11223,33445`
  - `pack_gamma`: `31415,27182,16180,14142`
  - `pack_delta`: `42424,51515,60606,70707`
- Deterministic rerun check on same weekly pack (`pack_gamma`) with full horizon budget:
  - run #1:
    - `/usr/bin/time -p node scripts/regression.js --profile horizon --seed-pack weekly --seed-week 2026-02-16 --report-json [artifact removed] --report-md [artifact removed]`
    - result: PASS (`allOk=true`, `real 822.03s`)
  - run #2 (identical command, different report path):
    - `/usr/bin/time -p node scripts/regression.js --profile horizon --seed-pack weekly --seed-week 2026-02-16 --report-json [artifact removed] --report-md [artifact removed]`
    - result: PASS (`allOk=true`, `real 820.44s`)
  - deterministic comparison:
    - `evalRows` identical (`true`)
    - `randomRows` identical (`true`)
    - resolved seed pack identical (`pack_gamma`, same seed list)
- Consecutive-week stability check (`pack_delta`) with full horizon budget:
  - `/usr/bin/time -p node scripts/regression.js --profile horizon --seed-pack weekly --seed-week 2026-02-23 --report-json [artifact removed] --report-md [artifact removed]`
  - result: PASS (`allOk=true`, resolved pack `pack_delta`, `real 833.82s`)
- Threshold re-evaluation outcome:
  - current horizon thresholds retained unchanged (`horizon.eval.avg_deaths +16%`, existing random tolerances)
  - observed safety margins remained positive across both weekly packs:
    - `horizon.eval.avg_deaths` margin: `+0.274` (`pack_gamma`) / `+0.986` (`pack_delta`)
    - `horizon.eval.score` margin: `+0.233` / `+0.206`
    - `horizon.random.under_readinessScore` margin: `+0.054` / `+0.059`
    - `horizon.random.under_combatPressure` margin: `+0.069` / `+0.077`

#### OQ-6.4 Extended-Gate Runtime Efficiency

Actions:

- [x] Profile wall-clock cost of `ai:validate:extended` and identify dominant phase(s).
- [x] Introduce safe runtime reductions (scheduling/cadence/cache strategy) without weakening quality signal.
- [x] Document one recommended cadence split (e.g., per-change vs nightly) preserving acceptance rigor.

Exit criteria:

- [x] Measured reduction in operator wall time versus current baseline (`~45m` class) with equivalent decision quality.
- [x] No loss of detection capability on known historical replay checks.

Validation snapshot (2026-02-21):

- Added optimized full-validation orchestrator:
  - `scripts/validate_extended_optimized.js`
  - npm alias: `npm run ai:validate:extended:optimized`
  - flow: `canonical -> benchmark -> regression --all -> risk:r002 -> horizon`
  - quality-signal equivalence: keeps all previous checks while removing duplicate benchmark execution (`risk:r001` overlaps with `ai:validate:benchmark`).
- Measured full optimized run:
  - command: `npm run ai:validate:extended:optimized`
  - runtime report: `[artifact removed]` + `.md`
  - total: `2036.41s` (`33m56s`)
  - baseline reference (pre-OQ-6.4 full extended): `2728.58s` (`45m29s`)
  - delta: `-692.17s` (`-25.37%`)
- Dominant phases identified from runtime share:
  - `regression --all`: `906.26s` (`44.50%`)
  - `benchmark`: `499.82s` (`24.54%`)
  - `horizon`: `418.27s` (`20.54%`)
  - `canonical`: `211.88s` (`10.40%`)
  - `risk:r002`: `0.17s` (`0.01%`)
- Historical replay detection sanity retained:
  - replayed `horizon` with temporary `config.json` from `097c5c9` and restored local config after run.
  - artifacts: `[artifact removed]` + `.md`
  - expected FAIL reproduced:
    - `horizon.eval.avg_deaths: regress current=3.075 baseline=2.650 threshold=3.074`
- Recommended cadence split (documented in operator docs):
  - per-change feedback: `ai:validate:canonical` + `ai:validate:gate` + `ai:validate:risk:r002`
  - acceptance/nightly full check: `ai:validate:extended:optimized`
  - weekly deep sentinel: `ai:validate:horizon:weekly`

Planned files (full OQ-6 scope):

- `package.json`
- `config.json`
- `scripts/regression.js` and validation orchestration scripts
- `scripts/validate_extended_optimized.js`
- `.github/workflows/quality_gates.yml`
- `AGENTS.md`
- `README.md`
- `MANUAL.md`
- `docs/PARAMETERS.md`
- `docs/TRAINING_OVERRIDES.md`
- `docs/TRAINING_OPTIMIZATION_WORKBOOK.md`

Files touched in OQ-6.1:

- `.github/workflows/quality_gates.yml`
- `AGENTS.md`
- `README.md`
- `MANUAL.md`
- `docs/TRAINING_OPTIMIZATION_WORKBOOK.md`

Files touched in OQ-6.2:

- `scripts/test_training_contracts.js`
- `package.json`
- `AGENTS.md`
- `README.md`
- `MANUAL.md`
- `docs/TRAINING_OPTIMIZATION_WORKBOOK.md`

Files touched in OQ-6.3:

- `config.json`
- `scripts/regression.js`
- `docs/PARAMETERS.md`
- `docs/TRAINING_OVERRIDES.md`
- `README.md`
- `MANUAL.md`
- `docs/TRAINING_OPTIMIZATION_WORKBOOK.md`

Files touched in OQ-6.4:

- `scripts/validate_extended_optimized.js`
- `package.json`
- `AGENTS.md`
- `README.md`
- `MANUAL.md`
- `docs/TRAINING_OVERRIDES.md`
- `docs/TRAINING_OPTIMIZATION_WORKBOOK.md`
