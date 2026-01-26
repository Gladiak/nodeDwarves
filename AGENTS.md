# Agent Guidelines (NodeDwarves)

This file defines how to implement new features in a consistent, stable way.

## Core principles

- Prefer stability and long-term equilibrium over short-term spikes.
- Keep logic explicit and readable; avoid hidden behavior.
- Use config-driven tuning for all gameplay parameters.
- Favor gather-first economy; build structures only when shortages justify them.
- Keep the simulation deterministic enough for training comparison.

## Project structure

- `config.json`: single source of truth for tunables.
- `src/simulation.js`: core simulation loop and rules.
- `src/state.js`: initial state and entity defaults.
- `src/render.js`: ASCII HUD + legend output.
- `src/runtime.js`: terminal sizing and layout.
- `ai_server.js`: JS inference bridge for training.
- `python/train.py`: PPO training loop and logging.

## Config-first changes

- Add new parameters to `config.json` with sensible defaults.
- Document new parameters in `README.md` (config section).
- Avoid comments in JSON; use README for explanations.
- Keep ratios in [0, 1] where possible to simplify tuning.

## Simulation rules

- New resources must update:
  - `config.json` (`resources.*`, `jobs.*`, `symbols.*`)
  - `src/state.js` (initial stockpile and nodes)
  - `src/simulation.js` (gathering, regen, consumption)
  - `src/render.js` (legend + HUD)
  - `README.md` (parameter reference)
- New structures must update:
  - `config.json` (`structures.*`, costs, build ticks, guardrails)
  - `src/simulation.js` (build jobs, placement, effects)
  - `src/render.js` (symbols + HUD counts)
  - `README.md` (parameters + gameplay notes)
- Guardrails should use stockpile ratios, not absolute counts.

## AI training

- PPO only (2x128 MLP). Keep JSON weights for JS inference.
- Training must be resumable from `models/policy_best.json`.
- If observation/action shapes change, require `--fresh` training.
- Keep logs low-noise: `diag` should be averaged per log window.

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
- Run `npm run ai:train -- --fresh` after structural changes.
- Confirm no crashes on resize and no negative stockpile values.
- Check that shortages drive gathering priorities as expected.

## Style guidelines

- Small pure helpers over large monolithic blocks.
- Use consistent naming: `snake_case` only for config keys, `camelCase` in code.
- Use ASCII only unless a file already uses Unicode.
- Prefer early returns and guard clauses.
