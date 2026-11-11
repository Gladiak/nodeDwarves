# NodeDwarves User Manual 🛠️

## 0) Scope and navigation 🧭

A concise guide to playing, configuring and operating NodeDwarves v2.5.0.
See [README.md](README.md) for the product overview and [AGENTS.md](AGENTS.md) for contributor guidelines.

## 1) Operations and workflows 🛠️

Install dependencies and start the colony:

```bash
npm ci
npm start
```

The welcome screen uses the game's terrain generator, symbols and palette for a decorative atlas,
including the first playable frame's seasonal colors and active theme, also on decorative fields,
with a carved gatehouse for New colony, Load colony and Continue latest. Text keeps the map's slate
and icy-blue tones; a bold gold frame, bronze pillars and yellow selected option add contrast. The panel
and text share the map's terminal background. The palette follows `display.colors.map.menu_*`. Use Up/Down and
Enter, or `n`/`l`/`c` shortcuts; Esc returns to the welcome screen and `q` exits the menu.
Scenario selection includes an actual terrain preview, seed and world dimensions. Large terminals
show it beside the menu; smaller ones place it below. Press `p` for the expanded map and `r` for a
new gameplay seed. Confirmation starts that displayed seed and geometry. A fixed terrain seed in a
custom config still takes precedence over randomized terrain generation. Previewing never advances
the colony. Set `startup.preview.enabled` to false to hide previews; `cache_entries` bounds cached maps.
The free colony uses standard settings and a fresh random seed. Eleven additional presets change
supplies, world pressure and selected system settings. Their focus and difficulty are shown in the
scrollable scenario menu; the complete catalog is listed under State generation.

Direct launch and resume:

```bash
npm start -- --new --seed 101
npm start -- --scenario green_valley
npm start -- --scenario below_the_gate
npm start -- --resume
npm start -- --load saves/COLONY_ID.json
npm start -- --config /path/to/config.json --new
```

`--seed` and `--scenario` imply a new colony. `--resume` selects the latest compatible checkpoint;
`--load` selects a specific file. Non-interactive launches skip the menu and start a free colony
unless a launch choice is supplied. `--ai` selects a policy for a new colony; loaded games always
restore their embedded policy and inference cadence.

Run the existing trained policy:

```bash
npm run ai:play
```

| Key | Action |
| --- | --- |
| Space | Pause or resume |
| `[` / `]` | Decrease or increase speed |
| `.` | Advance one tick while paused |
| `s` | Save the colony, including during a cycle transition |
| `v` | Cycle observed surface flows: off, all, gathering, work, trade |
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
| Ctrl+C | Save and exit (when save_on_exit is enabled) |

Map exports use PNG/SVG. Chronicle exports use Markdown/JSON in `chronicles/`.

Each colony has an independent checkpoint in `saves/`, created when it starts, updated automatically
after 600 simulation ticks and at least 30 seconds since the previous save, and saved on clean exit
(Ctrl+C or SIGTERM). `s` saves immediately. Autosave is silent; failures appear in the archive panel.
The previous valid checkpoint is kept as `.json.bak`; loading automatically recovers it if the
primary is damaged and reports that recovery. Invalid saves remain untouched. Forced termination
(SIGKILL or power loss) can lose progress since the last completed checkpoint.

Saves retain world geometry, resolved config, scenario/seed, random cursor, jobs, history, AI policy,
speed/pause and cycle-transition progress. Use the same gameplay engine and Node.js major version to
resume deterministically. Presentation-only compatible builds also accept v2.5.0 saves. Changes to
the gameplay engine still reject unsupported saves rather than reinterpret them. Retain the original
version when archiving a long-running colony. Config edits affect new games;
the current `persistence` settings control save storage and cadence. Restore the original terminal
size for a full view of a loaded world. In-flight external map exports are not resumed.

## 2) Mental model 🧠

The colony runs autonomously. Shortages guide gathering and work priorities; housing,
production and trade support growth. Seasons, raids and social pressure create recoverable challenges.
Watch trends in population, food, water, morale and housing rather than individual fluctuations.

## 3) Tick flow ⏱️

The game starts at `1x`: five full simulation ticks per second (one every 200 ms). Use `[` / `]` to change the pace.
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
Interactive `--seed` controls the complete gameplay random stream. Scenario presets are in
`startup.scenarios`; each has an ID, name, difficulty label, description, optional seed and explicit
dotted config overrides. Add presets there without changing the free colony defaults. Reproducible
comparisons also require identical world dimensions. Training/benchmark launches ignore the menu,
scenario presets and save storage unless their own configuration is explicitly overridden.

| Scenario ID | Difficulty | Focus | Default seed |
| --- | --- | --- | --- |
| `free` | Standard | Unrestricted colony | Random |
| `green_valley` | Gentle start | Double founding supplies | 101 |
| `lean_provisions` | Challenging start | Reduced reserves | 303 |
| `dry_stone` | Challenging | Thirst, drought and water gathering | 202 |
| `hungry_hills` | Challenging | Hunger, cold and leaner harvests | 404 |
| `crowded_hearth` | Challenging | Twenty settlers and costlier housing | 505 |
| `raider_frontier` | Hard | Earlier raids, more attack seasons and heavier looting | 606 |
| `border_council` | Hard | Camps, diplomacy and political pressure | 707 |
| `divided_halls` | Hard | Rivalries, grudges and colony cohesion | 808 |
| `below_the_gate` | Hard | Earlier Deep Gate and faster mining frontier | 909 |
| `arena_of_stone` | Hard | Larger tournaments, injuries and training | 1010 |
| `compound_crisis` | Expert | The Long Emergency: needs, weather, housing and raid losses | 1111 |

Use `--seed` to replay a preset on a different mountain. Presets still use the complete simulation,
including social memory, combat readiness and full cycle progression. Larger founding caravans
receive extra supplies so their challenge comes from the featured systems.

Several presets reuse selected settings from `housing_pressure`, `governance_pressure`,
`social_tension_pressure`, `underrealm_push`, `warrior_realism_pressure` and `compound_crisis` in
the test catalog. Scarcity is adapted to terrain gathering instead of adding explicit test nodes.
`test_template.scenario` selects a source and `test_template.paths` lists the settings to copy.
Unmentioned defaults remain active; local dotted `overrides` are applied afterward. Training
shortcuts, termination limits and policy settings are not imported. Template edits affect new
colonies; saved colonies retain their resolved settings and source identity.

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
Story context is available in Event Log and Data Center. The bottom Story Ribbon is disabled by
default to keep the map unobstructed.

Background terrain is softened while roads, deep corridors, magma, shrines, actors and urgent
markers keep their normal colors. Dark structure symbols use a brighter map tone. Legend follows
the structure colors, and the home/preview terrain shares the same hierarchy and seasonal palette.

Press `v` to show recent surface movement with directional arrows: green for gathering, gold for
other colony work, cyan for merchants and caravans. The Ops view line identifies the selected
filter. Traces come from consecutive, adjacent observed positions, including ticks batched at high
speeds; they are not planned routes, carried-resource quantities or transport predictions. Actors,
structures, threats and panels draw above traces. Marks expire after 120 simulation ticks.
Underrealm views show `Surface only`: their decorative actor positions are not physical logistics.
Flow history is bounded, outside simulation/save state and rebuilt after load. It is disabled by
default until selected; pausing also pauses trace aging.

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

`startup.enabled` controls the interactive welcome menu; `startup.background_seed` selects its
decorative terrain independently of gameplay seeds. `persistence.enabled`, `directory`,
`autosave_interval_ticks`, `autosave_min_interval_ms`, `save_on_exit`, `keep_backup` and
`max_save_bytes` control local checkpoints; defaults are enabled, `saves/`, 600 ticks, 30000 ms,
enabled exit saves/backups and a 64 MiB file limit. Custom save directories should also be ignored
by Git when they live inside the repository.

`display.map_readability` enables the hierarchy, controls `terrain_strength` (default 0.82),
`minimum_brightness` (72) and the brighter `structure_color_key`. `display.map_flows` enables the
observer and selects `default_mode`; `retention_ticks`, `max_actors`, `max_segments` and `max_cells`
bound trace retention, tracked actors, movement records and drawn cells (120/1024/4096/180).
Flow colors use `display.colors.map.flow_gather`, `flow_work` and `flow_trade`.

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

`npm run test:saves` checks lossless saves, recovery, the menu and policy continuity.
`npm run test:scenarios` checks template provenance, standard-game and policy isolation.
`npm run test:map-presentation` checks hierarchy, real flow samples, bounds, collision protection,
exact terrain previews, selected-seed launch and presentation-compatible saves.
At a save-system milestone, `npm run validate:saves` compares uninterrupted and resumed worlds
over 8,000 advances with and without the canonical policy, plus shorter scenario checks.
At a scenario milestone, `npm run validate:scenarios` checks every preset with two seeds, extends
four pressure scenarios to 8,000 advances, and checks The Long Emergency with the canonical policy.
It also restores a checkpoint in every case. To recheck one changed preset, use
`npm run validate:scenarios -- --only dry_stone`; current results go to
`debug/scenario_validation_latest.json`.
`npm run validate:map-presentation` compares the new and original presentation at 1,000 and
8,000 ticks, both autonomous and with the canonical policy; it checks exact state, RNG, AI and
observer bounds. Current results go to `debug/map_presentation_latest.json`.

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
- `src/game_session.js`, `src/session_random.js`, `src/persistence.js`: sessions, random state and saves.
- `src/render/`, `src/runtime/`, `src/telemetry/`: terminal views, controls and diagnostics.
- `src/render/map_readability.js`, `map_flows.js`, `scenario_preview.js`: map hierarchy, flow marks
  and exact initial terrain previews; `src/runtime/map_flows.js`: bounded read-only surface observer.
- `src/ai/`, `ai_server.js`, `python/`: policy inference, training bridge and PPO tooling.
- `scripts/`: tests, benchmarks, validation, exports and CI utilities.
- `models/`, `regression/baselines/`: policies and model-quality references.
- `benchmark_cache/`, `debug/`: shared simulation baseline and current operational results.
- `chronicles/`: generated history exports.
- `saves/`: local colony checkpoints and recovery backups.
- `.github/workflows/quality_gates.yml`: remote quality-check workflow.
