# NodeDwarves

An autonomous, gamey dwarf colony simulation that lives entirely in your terminal.
No player input after launch: the colony gathers, crafts, and tries to keep itself
alive while you watch the chaos unfold in ASCII.

## Why this exists
- Experiment-friendly sandbox for AI policy training.
- Clean, modular codebase that is easy to extend.
- Fast feedback loop with a lightweight terminal renderer.

## How the simulation works
- The world is a fixed-size ASCII grid with resource nodes and dwarves.
- Each tick:
  1) Dwarves accumulate needs (hunger, thirst, sleep, safety, social).
  2) Resources are consumed when needs cross thresholds.
  3) Shortages are computed vs target stockpile levels.
  4) Jobs are assigned based on the largest shortages.
  5) Dwarves move to targets, work, and update stockpiles.
- Rendering is done as a full-frame redraw with a header + side HUD.

## Job system and priorities
- Shortages are sorted by severity (missing/target ratio).
- If a resource has nodes on the map, a gather job is created.
- If the resource is crafted, a craft job is created when inputs are available.
- Top priorities are displayed in the HUD queue.

## Quick start
```bash
npm start
```

## Configuration
All core knobs live in `config.json`.

Highlights:
- `display`: grid size, auto-resize, header, HUD width.
- `dwarves.count`: number of dwarves.
- `resources.stockpile`: initial resource amounts.
- `resources.targets`: target levels used to drive priorities.
- `jobs`: gather timing/yields per resource.
- `recipes`: crafting inputs/outputs and time.
- `needs.decayPerTick` and `consumption`: pace of survival dynamics.

## ASCII legend
The legend is printed in the header above the map. Symbols are configurable in
`config.json` under `symbols`.

## Project layout
```text
.
├── app.js              # Entrypoint and main loop
├── config.json         # Simulation knobs and defaults
├── REQUIREMENTS.md     # MVP requirements
├── README.md
└── src
    ├── config.js       # Config loader
    ├── render.js       # ASCII renderer + HUD
    ├── runtime.js      # Terminal sizing and layout
    ├── simulation.js   # Needs, jobs, movement, crafting
    ├── state.js        # World state + spawning
    ├── terminal.js     # Terminal helpers
    └── utils.js        # Shared helpers
```

## Collaborate with us
Want to help push this experiment forward? We would love contributors who are
into simulation design, AI training loops, and terminal UX.

Ways to jump in:
- Propose features or balance ideas via issues.
- Improve the job system and crafting economy.
- Prototype the Python AI bridge and policies.

Open a PR or start a discussion with your ideas.

## Roadmap ideas
- Workshop tiles with crafting locations.
- Smarter AI policies (Python bridge).
- World events and biome variation.
- Simple trading or tech progression.

## License
MIT
