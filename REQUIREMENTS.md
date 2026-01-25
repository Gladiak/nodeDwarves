# Autonomous Dwarf Colony Simulation - Requirements (MVP, gamey)

This document defines the MVP requirements for a fully autonomous, gamey dwarf
colony simulation. It is intended as the baseline for future implementations and
extensions. Medical systems are explicitly deferred.

## Goals
- Fully autonomous simulation (no player input after start).
- Simple core loop that can be expanded with new resources, skills, and features.
- Node.js orchestrates simulation; Python hosts AI policy/training.

## Non-Goals (MVP)
- Medical systems (injury treatment, hospitals, doctors).
- Combat or external enemies.
- Complex world generation or biomes.

## Entities

### Dwarf
Each dwarf is an agent with:
- Needs: hunger, thirst, sleep, safety, social.
- States: health, morale, stress, fatigue.
- Skills: mining, logging, farming, hunting, hauling, cooking, brewing, crafting,
  building.
- Traits: bravery, discipline, curiosity, empathy, stubbornness.
- Preferences: favorite food, favorite drink.
- Relations: optional simple bonds/rivalries (MVP can start with none).

### Resource
Resources are items in stockpiles. Each resource has:
- id, tags, and base value.
- base (raw) or processed (crafted).

### Structure
Structures enable recipes:
- farm_plot, kitchen, brewery, kiln, smelter, workshop, shelter.

### Job
Jobs are tasks assigned to dwarves. Each job has:
- required skill, duration in ticks, inputs, outputs, structure requirement.

## Resources (MVP)

### Primary
- food_raw
- water
- wood
- stone
- ore
- plant_fiber

### Processed
- meal
- booze
- charcoal
- metal
- tool_basic
- tool_advanced
- shelter
- workshop

## Recipes (MVP)
- farm_harvest: -> food_raw (time 6, farming, needs farm_plot)
- hunt: -> food_raw (time 8, hunting)
- cook: food_raw x2 -> meal x1 (time 4, cooking, needs kitchen)
- brew: food_raw x1 + water x1 -> booze x1 (time 5, brewing, needs brewery)
- kiln: wood x2 -> charcoal x1 (time 5, crafting, needs kiln)
- smelt: ore x2 + charcoal x1 -> metal x1 (time 8, crafting, needs smelter)
- tool_basic: wood x1 -> tool_basic x1 (time 4, crafting, needs workshop)
- tool_advanced: metal x1 -> tool_advanced x1 (time 6, crafting, needs workshop)
- build_shelter: wood x2 + stone x2 -> shelter x1 (time 10, building)
- build_workshop: wood x2 + stone x3 -> workshop x1 (time 12, building)

## Needs, States, Traits

### Needs (decay over time)
- hunger: affects morale and health if critical
- thirst: affects efficiency strongly if critical
- sleep: increases fatigue and lowers success
- safety: increases stress when low
- social: affects morale

### States (0..1)
- health: overall vitality
- morale: influences work speed and choices
- stress: risk of negative events (breakdown)
- fatigue: lowers efficiency and success

### Traits (0..1, stable)
- bravery, discipline, curiosity, empathy, stubbornness

## AI Scope (MVP)

### High-level actions
- prioritize_food (farming/hunting/cooking)
- prioritize_drink (water/brewing)
- prioritize_build (shelter/workshop)
- prioritize_extract (mining/logging)
- prioritize_recover (sleep/social)

### Observation (minimal)
- normalized stock levels of key resources
- percent of dwarves with critical needs
- count of idle dwarves
- count of available structures
- average morale and stress

### Reward (per tick)
- positive: survival, stable stocks, high morale
- negative: critical needs, high stress, idle time, deaths

## Simulation Loop (MVP)
1) Update needs and states for each dwarf (decay and recovery).
2) Generate or update job pool based on priorities and shortages.
3) Assign jobs to dwarves based on skills, needs, and availability.
4) Execute jobs (consume inputs, produce outputs, apply time).
5) Update resources and structures.

## Terminal ASCII Visualization (MVP)
The simulation renders to a fixed-size ASCII grid in the terminal.

### Grid
- Use a 2D array of characters, 168x42 for MVP.
- Each tick, redraw the grid from the current world state.
- Keep the palette ASCII-only and stable across ticks.

### Tile Legend (example)
- Empty: `.`
- Dwarf: `@`
- Food: `f`
- Water: `w`
- Wood: `t`
- Stone: `s`
- Ore: `o`
- Structure: `#`
- Workshop: `W`

### HUD (right or bottom panel)
- Tick counter
- Resource totals (food_raw, water, wood, stone, ore)
- Average needs (hunger, thirst, sleep)
- Average morale and stress

### Rendering Notes
- Use double-buffering to avoid flicker (render to a string, then output once).
- Avoid colors in MVP to keep output portable.
- Clamp entities to grid bounds; if collisions occur, draw the highest-priority symbol.

## Data Model (JSON-like)

### Dwarf
```json
{
  "id": "dwarf_1",
  "needs": { "hunger": 0.2, "thirst": 0.1, "sleep": 0.6, "safety": 0.8, "social": 0.4 },
  "state": { "health": 1.0, "morale": 0.7, "stress": 0.2, "fatigue": 0.3 },
  "skills": { "mining": 2, "logging": 1, "farming": 2, "hunting": 0, "hauling": 1,
              "cooking": 1, "brewing": 1, "crafting": 1, "building": 1 },
  "traits": { "bravery": 0.6, "discipline": 0.8, "curiosity": 0.5,
              "empathy": 0.4, "stubbornness": 0.3 },
  "prefs": { "food": "meal", "drink": "booze" }
}
```

### Resource
```json
{ "id": "wood", "tags": ["raw", "fuel"], "value": 2 }
```

### Recipe
```json
{
  "id": "smelt",
  "inputs": { "ore": 2, "charcoal": 1 },
  "outputs": { "metal": 1 },
  "time": 8,
  "skill": "crafting",
  "requires": ["smelter"]
}
```

## Deferred Features
- Medical systems (injuries, healing, hospitals).
- Combat and hostile entities.
- Advanced economy and trading.
- Advanced world generation and biomes.
