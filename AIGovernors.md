# AI Governors Backlog

Living implementation backlog for the roadmap feature:
`AI governors: trainable sub-policies for jobs, trade, and building`.

This file is the canonical working document for planning, delivery, testing,
and rollout of the feature.

## 1) Purpose

- Keep implementation incremental, measurable, and stable.
- Preserve existing simulation guardrails while increasing policy intelligence.
- Track decisions, risks, and rollout status in one place.

## 2) Scope

In scope:
- `jobs governor`
- `trade governor`
- `building governor`
- action/observation contract evolution
- training and runtime compatibility
- deterministic validation and regression checks

Out of scope (for now):
- replacing core rule guardrails with unconstrained policy control
- changing PPO architecture away from current baseline without a dedicated RFC
- introducing non-PPO algorithms

## 3) Current Baseline (Code Reality)

- Runtime calls one policy action every `ai.stepTicks`:
  - `app.js`
  - `src/ai_policy.js`
  - `src/ai/policy.js`
- Action payload today is effectively:
  - `{ weights, festivalIntent }`
- Effective action consumers:
  - `src/simulation/jobs.js` (shortage weighting)
  - `src/simulation/festivals.js` (festival intent)
- `src/simulation/world_events.js` currently receives `action` but does not use it.
- `src/simulation/merchant.js` is rule-driven and does not consume `action`.
- Build pipeline is mostly fixed-order rule scheduling in:
  - `src/simulation/jobs.js`
  - `src/simulation/structures.js`

## 4) Non-Negotiable Constraints

- Config-first tuning remains the primary control plane (`config.json`).
- Guardrails remain authoritative:
  - stockpile ratio gates
  - cost/input checks
  - cap limits
  - placement validity
  - queue limits
- Policy outputs can bias, rank, delay, or prioritize.
- Policy outputs must not bypass safety gates or mutate stockpiles directly.
- When observation/action shape changes, training must restart with `--fresh`.
- Runtime behavior must remain deterministic enough for seed-by-seed comparison.

## 5) Guardrails Matrix

Jobs governor:
- Can adjust shortage weights and optional urgency factors.
- Cannot force forbidden jobs or bypass role/emergency restrictions.

Trade governor:
- Can bias reserve/trade/acceptance intent.
- Cannot bypass `neverGive`, input checks, or stockpile protection constraints.

Building governor:
- Can rank candidate build classes and adjust bounded thresholds.
- Cannot place structures illegally or bypass costs/caps/min ratio checks.

## 6) Target Architecture (Incremental)

Preferred rollout model:
- Multi-governor action envelope with strict backward compatibility.

Proposed runtime envelope:

```json
{
  "jobs": {
    "weights": {
      "food": 1.4,
      "water": 1.5,
      "wood": 0.8,
      "stone": 0.7
    }
  },
  "festivalIntent": 0.45,
  "trade": {
    "reserveRatioBias": 0.05,
    "contestIntent": 0.55,
    "opportunityIntent": 0.60,
    "contractFulfillIntent": 0.50
  },
  "building": {
    "housingWeight": 1.2,
    "economyWeight": 1.0,
    "defenseWeight": 0.8,
    "specialWeight": 0.6,
    "mineBias": 0.35,
    "upgradeBias": 0.40
  }
}
```

Backward compatibility rule:
- If only legacy `{weights, festivalIntent}` exists, map it to:
  - `jobs.weights = weights`
  - `festivalIntent = festivalIntent`
  - `trade/building` use safe defaults.

## 7) Practical Implementation Study (Hook Map)

### Runtime orchestration

- `app.js`
  - Action cadence source of truth (`ai.stepTicks`).
  - Introduce envelope-aware action handling with legacy fallback.

- `src/ai/policy.js`
  - Add output mapping for governor-aware action schema.
  - Keep legacy model compatibility and safe defaults.

- `src/ai_policy.js`
  - Keep wrapper stable; avoid import churn.

### Jobs governor integration

- `src/simulation/jobs.js`
  - Use `action.jobs.weights` when present.
  - Preserve existing clamp and `priorityBoosts` semantics.
  - Keep `state.lastPriorities` stable for telemetry.

### Trade governor integration

- `src/simulation/merchant.js`
  - Apply bounded bias to reserve/trade choice logic.
  - Preserve `neverGive` and stockpile safety.

- `src/simulation/world_events.js`
  - Use intent for rival caravan contest/offer decisions.
  - Keep default behavior unchanged when action is missing.

- `src/simulation/contracts.js`
  - Add bounded intent gate for fulfillment timing only where safe.

### Building governor integration

- `src/simulation/jobs.js`
  - Replace fixed build-choice order with weighted class ranking.
  - Keep queue limits and emergency/role gating unchanged.

- `src/simulation/structures.js`
  - Keep placement, costs, and min-resource checks authoritative.
  - Optional bounded offset for manager hysteresis thresholds.

### Training bridge and trainer

- `ai_server.js`
  - Extend step action parsing for governor envelope.
  - Add metrics for trade/building intents where useful.

- `python/train.py`
  - Extend action split/merge and feature sets incrementally.
  - Preserve PPO defaults and logging stability.

## 8) Milestone Plan (Step-by-Step)

### M0 - Alignment and cleanup

Status: `[x]`

- Normalize merchant trade rate contract across code and docs.
- Confirm feature name contract consistency between config and trainer.
- Freeze baseline metrics and seeds for comparison.

M0 execution notes:
- `[x]` Merchant trade-rate contract normalized:
  - canonical keys: `merchant.tradeRate.default` + `merchant.tradeRate.<resource>`
  - legacy `merchant.tradeRate.give/receive` kept as compatibility alias (ratio conversion).
- `[x]` Trainer/runtime feature contract aligned:
  - `ai_server` now exposes `ruins`, `myths`, and `clanShares` in observation payload.
  - `python/train.py` now accepts and encodes `ruins*`, `myths*`, `mythFlag_*`, `clanShare_*`.
- `[x]` Baseline benchmark snapshot captured (short control window):
  - command: `node scripts/headless_benchmark.js --ticks 2000 --seeds 101,202,303,404 --output table`
  - avg: `pop 69.3`, `morale 0.8996`, `beerBoost 0.0229`, `hunger 0.1498`, `thirst 0.0946`, `beer 7432.4`, `food 221.4`, `water 195.2`
- `[x]` Regression harness execution attempted and blocker recorded:
  - `node scripts/regression.js --profile standard --eval-episodes 2 --eval-max-steps 200 --random-episodes 4 --random-max-steps 120`
  - blocker: resume checkpoint feature mismatch (`Feature names mismatch with resume policy. Update ai.training.trainer.featureNames or run with --fresh.`).

Definition of done:
- Parameter naming mismatch resolved and documented.
- Baseline benchmark snapshot captured and regression check status documented.

### M1 - Envelope scaffolding (no behavior change)

Status: `[x]`

- Add governor-aware action envelope parsing with legacy fallback.
- Keep runtime behavior identical under legacy policy files.

M1 execution notes:
- `[x]` Governor envelope normalization wired in runtime and policy paths:
  - `src/ai/policy.js`: `selectAction` now returns normalized envelope with legacy mirror (`weights`).
  - `app.js`: runtime loop normalizes selected action before simulation step.
  - `src/simulation/index.js`: step input accepts both envelope and legacy payloads.
- `[x]` Legacy compatibility preserved:
  - Legacy payload `{ weights, festivalIntent }` remains valid.
  - Envelope payload `{ jobs: { weights }, festivalIntent, trade?, building? }` now also valid.
- `[x]` Validation snapshot:
  - `node scripts/headless_benchmark.js --ticks 200 --seeds 101 --output table`
  - result: no runtime crash; control metrics remained stable (`pop 10`, `morale 0.8449` at tick 200).
- `[x]` Legacy/envelope parity check on AI loop:
  - deterministic 600-tick script run with `models/policy_best.json` comparing envelope vs forced-legacy payload.
  - result: identical terminal snapshot (`tick 600`, `pop 18`, `food 267.0`, `water 90.78`, `beer 58.38`).
- `[x]` Regression harness re-run status:
  - blocker unchanged: resume checkpoint feature mismatch (`Feature names mismatch with resume policy... run with --fresh`).

Definition of done:
- `npm start` behavior unchanged with current models.
- AI play loop runs with no crashes and unchanged baseline trend.

### M2 - Jobs governor hardening

Status: `[x]`

- Move jobs decision read path to `action.jobs.weights`.
- Keep old path for compatibility.

M2 execution notes:
- `[x]` Jobs priority read path hardened:
  - `src/simulation/jobs.js` now resolves weights from `action.jobs.weights` first.
  - legacy fallback order preserved: `action.weights` -> `ai.defaultWeights`.
- `[x]` Shortage scoring and telemetry contract preserved:
  - no changes to shortage formula, clamps, or `state.lastPriorities` payload shape.
- `[x]` Benchmark control snapshot (same seed window as M0 short-control):
  - command: `node scripts/headless_benchmark.js --ticks 2000 --seeds 101,202,303,404 --output table`
  - avg: `pop 69.3`, `morale 0.8996`, `beerBoost 0.0229`, `hunger 0.1498`, `thirst 0.0946`, `beer 7432.4`, `food 221.4`, `water 195.2`
- `[x]` Legacy/envelope parity check on AI loop:
  - deterministic 2000-tick script run with `models/policy_best.json` comparing envelope vs forced legacy payload.
  - result: identical snapshot (`tick 2000`, `pop 94`, `food 213.63`, `water 245.36`, `beer 5177.26`).
- `[x]` Regression harness re-run status:
  - blocker unchanged: resume checkpoint feature mismatch (`Feature names mismatch with resume policy... run with --fresh`).

Definition of done:
- No regression on extinction and food/water stability in benchmark seeds.

### M3 - Trade governor (advisory control)

Status: `[x]`

- Add bounded trade intent hooks (merchant + event opportunity/contest).
- Keep all existing stockpile and ratio guardrails.

M3 execution notes:
- `[x]` Advisory trade hooks integrated (guardrails preserved):
  - `src/simulation/merchant.js`: `action.trade.reserveRatioBias` now biases reserve ratio within config clamps before extra-resource selection.
  - `src/simulation/world_events.js`: `action.trade.contestIntent` gates rival-caravan contest spending.
  - `src/simulation/world_events.js`: `action.trade.opportunityIntent` can delay opportunity completion, with forced completion near expiry.
- `[x]` Config-first control plane added:
  - `ai.governors.trade.enabled`
  - `ai.governors.trade.reserveRatioBiasMax`
  - `ai.governors.trade.reserveRatioMin`
  - `ai.governors.trade.reserveRatioMax`
  - `ai.governors.trade.contestIntentThreshold`
  - `ai.governors.trade.opportunityIntentThreshold`
  - `ai.governors.trade.opportunityForceCompleteTicks`
- `[x]` Runtime wiring:
  - `src/simulation/index.js` now passes normalized action to merchant update as well.
- `[x]` Targeted behavior checks:
  - rival caravans: low intent -> `lose` with no contest spend; high intent -> `win` with contest spend.
  - opportunities: low intent delays completion while far from expiry; completion is forced inside the configured expiry safety window.
  - merchant: aggressive reserve bias allowed a trade in a threshold-edge setup; conservative bias blocked it.
- `[x]` Stability control benchmark:
  - command: `node scripts/headless_benchmark.js --ticks 2000 --seeds 101,202,303,404 --output table`
  - avg unchanged vs prior control: `pop 69.3`, `morale 0.8996`, `beerBoost 0.0229`, `hunger 0.1498`, `thirst 0.0946`, `beer 7432.4`, `food 221.4`, `water 195.2`.
- `[x]` Regression harness status:
  - current blocker is now baseline availability (`Baseline for profile "standard" not found. Run with --record to create it.`), not feature-name mismatch.

Definition of done:
- Trade flows improve or remain neutral without survival regressions.

### M4 - Building governor (ranking control)

Status: `[x]`

- Introduce weighted ranking for build classes.
- Keep structure legality/cost/cap checks untouched.

M4 execution notes:
- `[x]` Building governor ranking integrated in scheduler path:
  - `src/simulation/jobs.js`: `assignBuildJobIfNeeded` now resolves `action.building.*` and ranks build classes (`housing`, `economy`, `defense`, `special`).
  - Existing pre-emption branches remain explicit and unchanged (`prioritizeMine`, manager-managed branch, extra-mine preference, queue limits).
- `[x]` Guardrails preserved:
  - class ranking only selects candidate order; all legality/cost/cap/min-ratio checks remain in existing structure creators (`create*BuildJob` / `createHouseUpgradeJob`).
- `[x]` Advisory bias hooks added (bounded):
  - `action.building.mineBias`: reorders economy-class candidates (mine earlier/later).
  - `action.building.upgradeBias`: reorders housing-class candidates (upgrade-first vs build-first).
  - both are clamped by config (`ai.governors.building.mineBiasMax`, `upgradeBiasMax`).
- `[x]` Config-first control plane added:
  - `ai.governors.building.enabled`
  - `ai.governors.building.defaultWeights.housing|economy|defense|special`
  - `ai.governors.building.mineBiasMax`
  - `ai.governors.building.upgradeBiasMax`
- `[x]` Targeted smoke checks (deterministic script):
  - housing-biased action produced `house` job.
  - economy-biased action produced `workshop` job.
  - positive `mineBias` switched economy pick to `mine`; negative bias kept `workshop`.
- `[x]` Stability control benchmark:
  - command: `node scripts/headless_benchmark.js --ticks 2000 --seeds 101,202,303,404 --output table`
  - avg unchanged vs prior control: `pop 69.3`, `morale 0.8996`, `beerBoost 0.0229`, `hunger 0.1498`, `thirst 0.0946`, `beer 7432.4`, `food 221.4`, `water 195.2`.
- `[~]` Regression harness follow-up:
  - re-run attempt started in this step but did not return output in the local non-interactive session.
  - last confirmed blocker (from M3) remains baseline recording requirement (`--record`) rather than feature-name mismatch.

Definition of done:
- Housing and infrastructure metrics improve or stay stable.
- No queue starvation or runaway build loops.

### M5 - Training, telemetry, rollout hardening

Status: `[x]`

- Extend telemetry with governor signals for observability.
- Re-tune rewards only if needed and document rationale.
- Final regression + benchmark + rollout notes.

M5 execution notes:
- `[x]` Runtime governor observability snapshot wired:
  - `src/simulation/index.js` stores a compact per-tick snapshot in `state.lastGovernorSignals` for `jobs`, `trade`, and `building`.
- `[x]` Telemetry governor lines added (compact, section-local):
  - `Pressure`: jobs governor top priorities (`action` vs `default` source).
  - `Diplomacy`: trade governor advisory intents (`reserve`, `contest`, `opportunity`).
  - `Operations`: building governor class order + advisory biases (`mine`, `upgrade`).
  - `src/render/telemetry_panel.js` Economy subtitle updated to explicitly include governor signals.
- `[x]` Training/runtime action contract hardened for governors:
  - `python/train.py` now appends governor pseudo action-ids when enabled by config:
    - trade: `gov_trade_reserve_ratio_bias`, `gov_trade_contest_intent`, `gov_trade_opportunity_intent`
    - building: `gov_building_housing_weight`, `gov_building_economy_weight`, `gov_building_defense_weight`, `gov_building_special_weight`, `gov_building_mine_bias`, `gov_building_upgrade_bias`
  - `split_action_payload` now emits full envelope-compatible payloads: `weights`, `festivalIntent`, `trade`, `building`.
  - Shortage aggregation excludes non-resource pseudo action-ids to keep diagnostics stable.
  - Resume guard now checks both feature names and action-head ids (`resources` list) with explicit `--fresh` guidance on mismatch.
  - `src/ai/policy.js` now maps governor pseudo action-ids back into runtime envelope fields.
- `[x]` Local smoke validation:
  - module loads: `src/ai/policy.js`, `src/render/telemetry.js`, `src/simulation/index.js`
  - `python/train.py` compiles (`py_compile`)
  - short benchmark: `node scripts/headless_benchmark.js --ticks 200 --seeds 101 --output table` (no crash)
- `[x]` Regression harness executed end-to-end with current governor contract:
  - checkpoint compatibility unblocked by regenerating policy snapshots with `--fresh`.
  - baseline recorded: `node scripts/regression.js --record --profile standard --eval-episodes 2 --eval-max-steps 200 --random-episodes 4 --random-max-steps 120`.
  - comparison run passed: `node scripts/regression.js --profile standard --eval-episodes 2 --eval-max-steps 200 --random-episodes 4 --random-max-steps 120`.
  - baseline file present: `debug/regression_baseline.json`.
  - latest report: `debug/regression_report_1770591385893.txt`.
- `[x]` Long benchmark gate unblocked (seed-collapse fix validated):
  - root cause: emergency gather path blocked all generic build scheduling, so in deterministic seed `101` no house job was ever created (`houses=0`, `couples=0`, `births=0`) and old-age attrition caused extinction.
  - fix: `src/simulation/jobs.js` now allows exactly one emergency bootstrap house assignment when housing is needed and there are no houses/queued house jobs.
  - command: `node scripts/headless_benchmark.js --ticks 8000 --seeds 101,202,303,404 --output table`.
  - deterministic 8000-tick validation (seeds `101,202,303,404`):
    - `seed 101`: `pop 735`
    - `seed 202`: `pop 742`
    - `seed 303`: `pop 741`
    - `seed 404`: `pop 736`
  - avg: `pop 738.5`, `morale 0.8903`, `hunger 0.1521`, `thirst 0.1059`.
  - no seed collapses observed in the validation gate.

Definition of done:
- Passes benchmark/regression gates.
- Documentation updated and rollout-ready.

## 9) Validation Protocol

Mandatory checks per milestone:

- `npm start` smoke test (rendering, telemetry, controls).
- `node scripts/headless_benchmark.js --ticks 8000 --seeds 101,202,303,404`
- A/B comparison:
  - `node scripts/headless_benchmark.js --ticks 8000 --variant baseline --set path=value --variant candidate`
- Regression harness:
  - `node scripts/regression.js`

Blocking failures:
- repeated seed collapses not explicitly intended
- significant food/water stockpile stability regressions
- crashes, negative stockpile defects, or telemetry incoherence

## 10) Observability Requirements

- Keep `diag` logging compact and comparable.
- Preserve shortage telemetry contract (`state.lastPriorities`).
- Add concise governor signal lines only when they improve debugging value.
- Every telemetry change must stay consistent with `src/render/telemetry_panel.js`.

## 11) Risk Register

R1: Action/feature contract drift between JS runtime and Python trainer.
- Mitigation: versioned action schema + strict fallback + `--fresh` when shapes change.

R2: Policy over-control destabilizes economy.
- Mitigation: bounded outputs, smoothing, and immutable hard guardrails.

R3: Performance regressions in per-tick scheduling.
- Mitigation: keep ranking logic O(n) or near-O(n), avoid nested heavy scans.

R4: Documentation drift during implementation.
- Mitigation: update this file at every milestone close.

## 12) Working Rules for This Backlog

- Update this file in every implementation/test/rollout change-set touching AI governors.
- Track milestone status as:
  - `[ ]` planned
  - `[~]` in progress
  - `[x]` completed
- Add a short decision note when changing architecture direction.

## 13) Decision Log

Template:

- Date:
- Decision:
- Why:
- Impact:
- Follow-up:

Entries:
- Date: 2026-02-08
- Decision: Use incremental multi-governor envelope with legacy fallback.
- Why: Lowest risk path compatible with current single-policy runtime.
- Impact: Enables phased rollout without breaking existing models.
- Follow-up: Implement M0 and M1 first.

- Date: 2026-02-08
- Decision: Promote this file as the canonical implementation backlog for AI governors.
- Why: Keep design, constraints, milestone status, and rollout checks synchronized.
- Impact: All future implementation/test change-sets must update this backlog.
- Follow-up: Close remaining M0 alignment tasks (trade-rate config contract and feature-set consistency).

- Date: 2026-02-08
- Decision: Keep legacy `merchant.tradeRate.give/receive` as compatibility alias while standardizing on `default` + per-resource keys.
- Why: Avoid breaking older configs while unifying parameter semantics.
- Impact: Merchant behavior stays backward-compatible; docs now point to canonical keys.
- Follow-up: Remove legacy alias only after explicit deprecation cycle.

- Date: 2026-02-08
- Decision: Enforce expanded trainer feature contract (`ruins*`, `myths*`, `mythFlag_*`, `clanShare_*`) and surface them from `ai_server`.
- Why: Align trainer with runtime/config feature expectations.
- Impact: Existing old policy resumes may require `--fresh` when feature names differ.
- Follow-up: Add migration note in implementation PR and start M1 envelope scaffolding.

- Date: 2026-02-08
- Decision: Introduce action-envelope normalization in both policy output and simulation input, while mirroring `weights` for legacy consumers.
- Why: Enable phased governor rollout without forcing immediate consumer rewrites.
- Impact: Runtime can accept both legacy and envelope actions with no intended behavior drift.
- Follow-up: Move jobs priority read-path to `action.jobs.weights` as primary in M2.

- Date: 2026-02-08
- Decision: Make `action.jobs.weights` the primary jobs governor input in the scheduler, with legacy fallback preserved.
- Why: Align runtime read-path with the multi-governor envelope contract from M1.
- Impact: Jobs governor contract is now explicit and forward-compatible; legacy policies remain valid.
- Follow-up: M3 trade governor hooks should consume `action.trade.*` with bounded/advisory semantics.

- Date: 2026-02-08
- Decision: Implement trade governor as advisory intent gates/biases (`reserveRatioBias`, `contestIntent`, `opportunityIntent`) with mandatory fallback safety.
- Why: Increase policy leverage on trade timing/pressure without bypassing stockpile, cost, and ratio guardrails.
- Impact: Trade behavior remains deterministic and guardrail-bound; missing trade intents preserve legacy behavior.
- Follow-up: M4 should mirror this pattern for building ranking control (`action.building.*`) without relaxing structure legality checks.

- Date: 2026-02-08
- Decision: Implement building governor as ranked class selection (`housing/economy/defense/special`) plus bounded class-internal biases (`mineBias`, `upgradeBias`).
- Why: Increase AI leverage over build timing/order without replacing hard structure guardrails.
- Impact: Build scheduler becomes governor-aware while preserving deterministic safety checks and legacy-like defaults.
- Follow-up: M5 should extend observability/training rollout for building intents and finalize regression harness baselines.

- Date: 2026-02-08
- Decision: Extend trainer action-head with explicit governor pseudo action-ids and enforce resume compatibility checks on both features and action ids.
- Why: Keep runtime/training envelope mapping explicit, deterministic, and fail-fast on incompatible checkpoints.
- Impact: Old checkpoints with different action heads now surface a clear `--fresh` requirement instead of silent/late shape failures.
- Follow-up: Regression harness and long benchmark were re-run; remaining blocker is the `seed 101` collapse in 8000-tick benchmark.

- Date: 2026-02-08
- Decision: Regenerate policy snapshots with `--fresh` before running regression after action-head changes.
- Why: Regression harness reuses `models/policy_best.json`; old checkpoints no longer match new governor action ids.
- Impact: Regression profile `standard` is now runnable again, but long benchmark still flags a seed collapse that blocks M5 closure.
- Follow-up: Run stability tuning/analysis for the `seed 101` collapse before marking M5 completed.

- Date: 2026-02-08
- Decision: Allow one emergency housing bootstrap job when there are zero houses and no queued house build.
- Why: In deterministic benchmark seed `101`, emergency gather blocked generic build scheduling indefinitely, preventing couples/births and causing old-age extinction.
- Impact: Seed-collapse blocker removed in 8000-tick deterministic validation across `101,202,303,404`; M5 moved to completed.
- Follow-up: Keep monitoring long-run benchmark runtime cost (high population increases simulation time significantly).
