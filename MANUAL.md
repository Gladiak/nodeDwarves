# NodeDwarves User Manual 🛠️

## 0) Scope and navigation 🧭

A concise guide to playing, configuring and operating NodeDwarves v2.3.0.
See [README.md](README.md) for the product overview and [AGENTS.md](AGENTS.md) for contributor guidelines.

## 1) Operations and workflows 🛠️

Install dependencies and start the colony:

```bash
npm ci
npm start
```

Run the existing trained policy:

```bash
npm run ai:play
```

| Key | Action |
| --- | --- |
| Space | Pause or resume |
| `[` / `]` | Decrease or increase speed |
| `.` | Advance one tick while paused |
| `l` | Open or close Legend; arrow keys browse its pages |
| `i` | Inspect a dwarf |
| `w` | Open Warrior League |
| `h` | Open Data Center; left/right changes pages |
| `e` | Open Event Log; up/down scrolls |
| `f` | Change the open Event Log filter |
| Left/right | Browse the active panel, inspect selection or log filter |
| Up/down | Change map depth when no scrollable panel is open |
| `m` / Shift+M | Export unlocked map layers, without/with structures and roads |
| `c` | Export the latest completed or current Chronicle |
| Ctrl+C | Exit |

Map exports use PNG/SVG. Chronicle exports use Markdown/JSON in `chronicles/`.

## 2) Mental model 🧠

The colony runs autonomously. Shortages guide gathering and work priorities; housing,
production and trade support growth. Seasons, raids and social pressure create recoverable challenges.
Watch trends in population, food, water, morale and housing rather than individual fluctuations.

## 3) Tick flow ⏱️

Each tick advances the full simulation. Faster speeds batch complete ticks; they do not skip
systems. Pause and single-step are useful for watching a crisis or inspecting a busy settlement.
Critical story beats may briefly slow or hold presentation; manual controls take precedence.

## 4) Runtime 🖥️

Use a terminal with at least 80 columns for comfortable navigation. Panels adapt to the available
map area. Close the active panel with its toggle key. Legend pages remain accessible with arrows
when the symbols need more space than the popup can display at once.

## 5) State generation 🌍

World size, terrain and seed are configured in `config.json`. Use a fixed seed and identical
settings when comparing simulation changes. The benchmark commands provide repeatable seed sets.

## 6) Simulation systems ⚙️

- Gathering comes first; buildings follow demand and available reserves.
- Villages, roads, trade and external camps shape the surface economy.
- Regional roads help eligible long trips while primary resource gathering keeps its normal routes.
- Social relationships leave bounded memories that influence mood and colony climate.
- Underrealm crews explore deeper resources and threats; progression is visible in Data Center.
- Warrior League, named rivals, sieges and landmarks provide longer-running challenges.
- Completed cycles preserve selected historical facts and places. An inherited Builders' Guild
  can provide a small, fading construction benefit.

## 7) Rendering and telemetry 🎨

Legend explains surface or active Underrealm symbols. Inspect shows a dwarf's identity and
witnessed deeds. Event Log provides current events and a drama filter. Data Center shows economy,
progression and policy information; its reference text explains the displayed metrics.
The Story Ribbon highlights the current event without requiring you to follow every log entry.

## 8) AI and training 🤖

Python training is optional. Bootstrap its environment before training:

```bash
npm run ai:bootstrap
npm run ai:train -- quality
```

Available wrapper profiles: `fast`, `quality`, `quality-mixed`, `m4-balanced`, `full`, `endgame`,
and `benchmark`. `npm run ai:train:m4` selects the M4 preset directly.
Training resumes from the best available checkpoint. Use `--fresh` only when intentionally
starting over or when observation/action shapes change.

```bash
npm run ai:train:continuous
npm run ai:validate
npm run ai:validate:weekly
```

Run expensive operational validation at milestones. The full validation command covers the
canonical policy, deterministic simulation and regression gates; the weekly command adds the
rotating Horizon check. CI artifacts identify their run and commit and mark missing phases explicitly.

## 9) Configuration ⚙️

`config.json` is the authoritative source for gameplay, display and training settings.
Keep valid JSON and change a small, understood set of values at a time. Use benchmark overrides
for comparisons before accepting a new default.

```bash
npm run bench:ensure-baseline
npm run bench:candidate -- --set path=value
npm run bench:diff
```

Use the shared cache in `benchmark_cache/` for report comparisons. Preserve the previous control
until a gameplay candidate is accepted. Current results are written to `debug/`.

## 10) Role guide 🧭

- Players: start the simulation, use Legend/Inspect/Data Center, and follow colony trends.
- Operators: run repeatable benchmarks and quality checks at milestones.
- Contributors: follow [AGENTS.md](AGENTS.md), keep settings explicit and preserve determinism.

## 11) Diagnostics and cleanup 🔎

Run the contract suite:

```bash
npm test
```

Review a captured Chronicle without rerunning the simulation:

```bash
npm run bench:candidate -- --snapshot-json /tmp/colony.json
npm run review:chronicle-retention -- --snapshot-json /tmp/colony.json --report-json /tmp/retention.json
npm run review:chronicle-retention -- --replay-json /tmp/retention.json
```

Preview and clean temporary debug files after validation:

```bash
npm run debug:clean -- --dry-run
npm run debug:clean
```

Cleanup keeps the latest operational reports and a small recent training history. Completed
implementation workbooks and technical completion reports are not part of the user documentation.

## 12) Project layout 🗂️

- `app.js`, `config.json`: entrypoint and settings.
- `src/simulation/`, `src/state/`: simulation systems and world creation.
- `src/render/`, `src/runtime/`, `src/telemetry/`: terminal views, controls and diagnostics.
- `src/ai/`, `ai_server.js`, `python/`: policy inference, training bridge and PPO tooling.
- `scripts/`: tests, benchmarks, validation, exports and CI utilities.
- `models/`, `regression/baselines/`: policies and model-quality references.
- `benchmark_cache/`, `debug/`: shared simulation baseline and current operational results.
- `chronicles/`: generated history exports.
- `.github/workflows/quality_gates.yml`: remote quality-check workflow.
