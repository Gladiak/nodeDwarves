# Training Quality Status

Last updated: 2026-09-15
Scope: current operational status for training quality validation.
Historical archive: `docs/TRAINING_OPTIMIZATION_WORKBOOK.md`

## Current baseline

- Core optimization workstreams completed: A (reward/termination), B (PPO stability), C (throughput/resume continuity).
- Operational quality uplift completed: OQ-1, OQ-2, OQ-3, OQ-4, OQ-5, OQ-6.2, OQ-6.3, OQ-6.4.
- Epic Evolution E6 persistent-world state is explicitly isolated from PPO observations and gameplay
  decisions; no fresh training is required.

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

## Latest local validation snapshot (2026-09-15)

- E6 persistent-world acceptance completed.
- `npm test`: PASS, including the dedicated 39-assertion world-legacy suite and policy contracts.
- Deterministic two-cycle/five-cycle validation: PASS; five-cycle legacy state is 11,745 bytes with
  39 records, 10 mapped echoes, and modifier metadata capped at 0.020 and inactive.
- Canonical `4 x 8000`: exact cached-baseline diff, population endpoints `687/678/725/716`, no
  collapsed seeds, config hash
  `28c11e8e0b070a952054d5b96b629d6f51f73104387819174307bd5b256eb88c`.
- Reports: `debug/headless_benchmark_{candidate,diff}.{json,md}`.

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
