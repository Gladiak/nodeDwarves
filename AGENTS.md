# Agent Guidelines (NodeDwarves)

This file defines how to implement new features in a consistent, stable way.

## Core principles

- Prefer stability and long-term equilibrium over short-term spikes.
- Keep logic explicit and readable; avoid hidden behavior.
- Use config-driven tuning for all gameplay parameters.
- Favor gather-first economy; build structures only when shortages justify them.
- Keep the simulation deterministic enough for training comparison.
- Continuously improve model intelligence and learning capability in measured, stable steps.
- When implementation details are unclear, ask for clarifications before coding changes.
- Always update README.md and MANUAL.md after new implementations or tweaks, if needed.
- When new files are added, update the Project layout section in README.md.
- For substantial implementations, update documentation with a clear, high-detail explanation (README, MANUAL, and relevant docs).
- Always write documentation in English.

## Project structure

- `app.js`: entrypoint and main loop.
- `config.json`: single source of truth for tunables.
- `docs/PARAMETERS.md`: config parameter reference.
- `docs/TRAINING_OVERRIDES.md`: training overrides guide.
- `src/config.js`: config loader.
- `src/simulation/`: simulation systems split by theme.
- `src/simulation/index.js`: simulation orchestrator.
- `src/simulation.js`: thin wrapper for `src/simulation/index.js`.
- `src/state/`: state creation and terrain generation.
- `src/state/index.js`: state orchestrator.
- `src/state.js`: thin wrapper for `src/state/index.js`.
- `src/render/`: render helpers (grid, header, HUD, legend, colors, format).
- `src/render/index.js`: render orchestrator.
- `src/render.js`: thin wrapper for `src/render/index.js`.
- `src/runtime.js`: terminal sizing and layout.
- `src/terminal.js`: terminal helpers.
- `src/ai/`: AI modules (policy and observation).
- `src/ai_policy.js`: thin wrapper for `src/ai/policy.js`.
- `src/utils.js`: shared helpers.
- `ai_server.js`: JS inference bridge for training.
- `python/bootstrap.py`: venv bootstrap.
- `python/train.py`: PPO training loop and logging.
- `python/agent.py`: example Python agent.

## Config-first changes

- Add new parameters to `config.json` with sensible defaults.
- Document new parameters in `docs/PARAMETERS.md` (and `README.md` for high-level behavior changes).
- Avoid comments in JSON; use docs/README for explanations.
- Keep ratios in [0, 1] where possible to simplify tuning.
- If training overrides or scenario knobs change, update `docs/TRAINING_OVERRIDES.md`.

## Simulation rules

- New resources must update:
  - `config.json` (`resources.*`, `jobs.*`, `symbols.*`, `display.colors.map` when colors are enabled)
  - `src/state.js` (initial stockpile and nodes)
  - `src/simulation.js` (gathering, regen, consumption)
  - `src/render.js` (legend + HUD)
  - `docs/PARAMETERS.md` (parameter reference) + `README.md` (gameplay notes)
- New structures must update:
  - `config.json` (`structures.*`, costs, build ticks, guardrails, `symbols.*`, `display.colors.map` when colors are enabled)
  - `src/simulation.js` (build jobs, placement, effects)
  - `src/render.js` (symbols + HUD counts)
  - `docs/PARAMETERS.md` (parameters) + `README.md` (gameplay notes)
- Guardrails should use stockpile ratios, not absolute counts.

## Modularization and refactoring

- Split large files into small, thematic modules (resources, structures, movement, population, raids, rendering, AI).
- Keep wrappers as stable public APIs to avoid import churn and reduce regression risk.
- Prefer explicit data flow between modules over implicit shared state.
- Avoid circular dependencies; use small, single-purpose helpers.

## AI training

- PPO only (2x128 MLP). Keep JSON weights for JS inference.
- Training must be resumable from the best-eval snapshot (default `models/policy_best.json`).
- If observation/action shapes change, require `--fresh` training.
- Keep logs low-noise: `diag` should be averaged per log window.
- Track model quality over time and prefer steady, incremental improvements over sudden unstable jumps.

## Logging and diagnostics

- Use the `diag` line for compact, comparable summaries.
- Avoid per-episode debug spam; log on `logEvery`.
- Keep log formatting stable so it can be parsed later.

## Performance and UX

- Avoid O(n^2) scans in per-tick logic when possible.
- Prefer early exits and precomputed counts.
- Keep HUD lines short enough for the configured width.
- Update the ASCII legend when new entities are added.

## Validation checklist

- Run `npm start` and confirm the HUD/legend renders.
- Run `npm run ai:regression` after structural changes (use `node scripts/regression.js --record --profile <name>` when behavior changes are intentional).
- Run `npm run ai:train:fresh` after structural changes.
- Confirm no crashes on resize and no negative stockpile values.
- Check that shortages drive gathering priorities as expected.

## Style guidelines

- Small pure helpers over large monolithic blocks.
- Use consistent naming: `snake_case` only for config keys, `camelCase` in code.
- Use ASCII only unless a file already uses Unicode.
- Prefer early returns and guard clauses.
- Add short English comments above top-level functions to aid onboarding.
- Use English for all player-facing in-game strings (HUD, events, labels, config names).
