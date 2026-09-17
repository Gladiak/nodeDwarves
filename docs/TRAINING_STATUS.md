# Training Quality Status

Last updated: 2026-09-16
Scope: current operational status for training quality validation.
Historical archive: `docs/TRAINING_OPTIMIZATION_WORKBOOK.md`

## Current baseline

- Core optimization workstreams completed: A (reward/termination), B (PPO stability), C (throughput/resume continuity).
- Operational quality uplift completed: OQ-1, OQ-2, OQ-3, OQ-4, OQ-5, OQ-6.2, OQ-6.3, OQ-6.4.
- Landmark state is explicitly isolated from PPO observations and action shapes.
  Monument construction is simulation-affecting through bounded material/work costs, but old
  policies remain loadable and no fresh training is required.

## Active validation cadence

0. Local Apple M4 training:
   - `npm run ai:train:m4`
   - phase sequence: foundation (`5` workers), finetune (`4` workers), endgame specialization (`3` workers)
   - endgame coverage: `8` full-sim episodes at `20000` simulated ticks each, followed by the guarded final canonical comparison
1. Per-change feedback:
   - direct focused benchmark/regression command for the changed subsystem
   - `node scripts/test_training_contracts.js --policy-only` after policy-contract changes
2. Acceptance/nightly full signal:
   - `npm run ai:validate`
3. Weekly deep sentinel:
   - `npm run ai:validate:weekly`
4. Contract preflight:
   - `npm test`

## Latest local validation snapshot (2026-09-17, E8)

- E8 monumental-settlement acceptance completed: five unique landmarks, fifteen total stages,
  reserved final footprints, compact districts, and visible construction/prosperity/damage/
  abandonment/restoration states.
- `npm test`: PASS, including the dedicated 63-assertion landmark suite and policy-shape contracts.
- Five-seed/three-size landmark validator: PASS; all scenarios organically complete `5/5`
  landmarks and `15/15` stages, retain populations `74..118`, and cap landmark state at `1,858`
  bytes.
- Canonical `4 x 8000`: population endpoints `662/683/674/689`, no collapsed seeds; every seed
  completes `5/5` landmarks and `15/15` stages. Average landmark state is `1,866` bytes; damage and
  restoration average `0.75` each. Cached-baseline candidate diff is exact zero across economy,
  Underrealm, epic conflicts, landmarks, resources, and all seed endpoints.
- Canonical AI evaluation: PASS with reward `18517.772`, score `4.209`, births `96.750`, deaths
  `6.550` across `20` episodes.
- Underrealm regression: PASS with reward `10072.976`, score `4.197`, births `54.525`, deaths
  `3.275`, randomized stock floor `0.870`, and extinction `0.000`.
- Standard regression reward, score, deaths, and extinction pass. Its randomized stock floor is
  `0.870` with stock average `0.955`; the relative floor budget is intentionally `-10%` (previously
  `-8%`) to admit the one-time bounded monument material spend while remaining well above critical
  scarcity. This is not a mortality/extinction relaxation.
- The optimized release orchestrator was stopped during the second governance seed at user request
  after canonical, deterministic benchmark, Standard, Underrealm, and the first governance seed had
  remained stable; no concrete danger signal was present.

Previous E7 evidence:

- E7 named-nemesis and staged-siege acceptance completed.
- `npm test`: PASS, including the dedicated 56-assertion epic-conflict suite, 41-assertion
  world-legacy migration/retention suite, and policy contracts.
- Deterministic E7 validation: PASS; the full victory path completes in 21 ticks, collapse protection
  takes the bounded tribute branch, and the five-siege profile retains three nemeses in 5,897 bytes.
- Deterministic two-cycle/five-cycle legacy validation: PASS; five-cycle legacy state is 11,758 bytes
  with 39 records, 10 mapped echoes, and modifier metadata capped at 0.020 and inactive.
- Canonical `4 x 8000`: population endpoints `693/731/725/716`, no collapsed seeds; one siege starts
  and completes in three of four seeds, all three are colony victories, and all `6/6` damaged
  structures recover. Config hash
  `c6f462f98d7d2c7562f2bb838051c8e786234dea3ce48a7b01c9444a14f45f60`.
- Policy-only contract: PASS; observation/action shape is unchanged and fresh training is not needed.
- Underrealm danger policy: surface/deep crisis overlap remains enabled. The profile now pairs an
  absolute `+1.5` average-death budget with a `-15%` average-birth floor; reward, score, randomized
  stock, and extinction gates remain unchanged so rare mass-casualty risk is not mistaken for
  systemic collapse. The longer Horizon profile applies the same birth floor with a `+1.75`
  average-death budget and retains its deep readiness/combat-pressure gates.
- Underrealm replay: PASS with reward `10168.941`, score `4.237`, births `56.350`, deaths `3.150`,
  randomized stock floor `0.895`, and extinction `0.000`.
- Four-seed Horizon replay: PASS with reward `13773.122`, score `4.304`, births `70.425`, deaths
  `4.150`, randomized stock floor `0.948`, extinction `0.000`, readiness score `0.530`, blocked
  readiness `0.842`, and combat pressure `0.265`.
- Reports: `debug/headless_benchmark_{candidate,diff}.{json,md}` and
  `debug/regression_horizon_latest.{json,md}`.

## Previous local validation snapshot (2026-03-01)

- The local artifacts for this historical snapshot were retired by the repository debug-retention
  policy on 2026-09-15; the validated measurements below remain as the durable summary.
- Autonomous promotion sweep completed and stopped at first canonical promotion hit.
- Winning run:
  - `canonical-final promoted=true`
  - `delta_score=+0.0539`
  - `paired_lcb=+0.0068`
- Underrealm remediation stream completed and validated end-to-end.
- Final full optimized gate (`npm run ai:validate`):
  - Canonical: `PASS`
    - `score=4.303012225735329`
    - `avg_reward=18933.253793235446`
    - `avg_steps=2200`
    - `avg_births=102.8`
    - `avg_deaths=4.7`
  - Deterministic benchmark: `PASS`
  - Regression profiles (`standard`, `underrealm`, `governance`): `PASS`
  - Horizon profile: `PASS`
    - `avg_deaths=2.975` (threshold `3.074`)
  - Optimized runtime validation: `allOk=true`

- Final underrealm blocker metric:
  - `underrealm.eval.avg_deaths=1.975` (threshold `2.156`) -> closed

## Open closure items

- Underrealm regression remediation: closed.
- OQ-6.1: pending one remote GitHub Actions run (`Training Quality Gates`) with uploaded artifacts.

## Update policy

- Update this file for current status, cadence, and pending actions.
- Keep `docs/TRAINING_OPTIMIZATION_WORKBOOK.md` as historical implementation evidence (timeline, decisions, validation snapshots).
