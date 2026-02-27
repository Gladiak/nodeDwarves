# Training Quality Status

Last updated: 2026-02-27
Scope: current operational status for training quality validation.
Historical archive: `docs/TRAINING_OPTIMIZATION_WORKBOOK.md`

## Current baseline

- Core optimization workstreams completed: A (reward/termination), B (PPO stability), C (throughput/resume continuity).
- Operational quality uplift completed: OQ-1, OQ-2, OQ-3, OQ-4, OQ-5, OQ-6.2, OQ-6.3, OQ-6.4.

## Active validation cadence

1. Per-change feedback:
   - `npm run ai:validate:canonical`
   - `npm run ai:validate:gate`
   - `npm run ai:validate:risk:r002`
2. Acceptance/nightly full signal:
   - `npm run ai:validate:extended:optimized`
3. Weekly deep sentinel:
   - `npm run ai:validate:horizon:weekly`
4. Contract preflight:
   - `npm test`

## Latest local validation snapshot (2026-02-27)

- Fresh training cycle completed locally (`--fresh`) before gate execution.
- Canonical validation: `PASS` via `npm run ai:validate:canonical`.
  - `score=3.77368007093475`
  - `avg_reward=16604.1923121129`
  - `avg_steps=2200`
  - `avg_births=97.4`
  - `avg_deaths=4.55`
- Gate validation: `PASS` via `npm run ai:validate:gate`.
  - Benchmark completed on seeds `101,202,303,404`.
  - Regression profiles `standard`, `underrealm`, and `governance`: all `PASS`.
- Risk validation: `PASS` via `npm run ai:validate:risk`.
  - `r001`: completed.
  - `r002`: observation normalization shape check `ok`.
- Debug housekeeping completed via `npm run debug:clean`; transient artifacts removed while latest canonical/regression reports were retained.

## Open closure item

- OQ-6.1: pending one remote GitHub Actions run (`Training Quality Gates`) with uploaded artifacts.

## Update policy

- Update this file for current status, cadence, and pending actions.
- Keep `docs/TRAINING_OPTIMIZATION_WORKBOOK.md` as historical implementation evidence (timeline, decisions, validation snapshots).
