# Long-Run Stability Backlog

Updated: 2026-02-13

## Scope

This note tracks unresolved stability issues for the current single-run gameplay package
(schism + festival + temple + underrealm + ruins readiness integration), with a focus on
long-run behavior and deep-expedition reliability.

## Latest benchmark snapshots

### Hot seeds long-run (303,404 @ 12000 ticks)

- Command:
  `node scripts/headless_benchmark.js --ticks 12000 --seeds 303,404 --variant baseline --set schism.enabled=false --set festivals.enabled=true --set structures.temple_of_ancestors.doctrine_path.enabled=false --variant candidate --output table --report-json /tmp/bench_tune5_12000_hotseeds.json --report-md /tmp/bench_tune5_12000_hotseeds.md --progress --progress-every 2000`
- Result (`candidate - baseline`):
  - `score`: `-0.19`
  - `population`: `+1.57%`
  - `underFail`: `+50.00%`
  - `underReadiness`: `+0.08%`
  - `resource_avg_rel`: `-0.41%`

### Full seeds mid-long run (101,202,303,404 @ 8000 ticks)

- Command:
  `node scripts/headless_benchmark.js --ticks 8000 --seeds 101,202,303,404 --variant baseline --set schism.enabled=false --set festivals.enabled=true --set structures.temple_of_ancestors.doctrine_path.enabled=false --variant candidate --output table --report-json /tmp/bench_tune5_8000.json --report-md /tmp/bench_tune5_8000.md --progress --progress-every 2000`
- Result (`candidate - baseline`):
  - `score`: `-1.18`
  - `population`: `+1.10%`
  - `underFail`: `+100.00%`
  - `underReadiness`: `-2.34%`
  - `resource_avg_rel`: `+6.04%`

## Open problems

1. **Deep expedition failures still above baseline**
   - The worst long-run regression is reduced vs earlier attempts, but still elevated (`underFail +50%` on hot seeds).

2. **Seed-level variance is still high**
   - Results diverge strongly by seed (especially 303 vs 404), so tuning is not yet robust.

3. **Readiness gating remains too permissive in risky windows**
   - Warning-zone dispatch still allows enough deep attempts to produce failure cascades under bad runs.

4. **Economy tradeoff remains unstable**
   - Population generally holds or improves, but score quality and stockpile composition are still inconsistent.

## Why this is likely happening

- Failure cooldown adaptation helps, but does not fully break deep-failure streaks.
- Warning-zone dispatch at higher depths still introduces too much downside variance.
- Underrealm deep risk and readiness are coupled to schism/runtime modifiers, amplifying seed divergence.

## Next optimization backlog

### P0 (high impact)

1. Add a **hard dispatch guard** for deep rooms when readiness is in warning zone:
   - block or delay depth >= 4 dispatch if `score < recommendedScore * X`.
2. Add **failure-streak cooldown escalation** per depth:
   - each recent failure in the same depth increases cooldown multiplier.

### P1 (medium impact)

1. Tighten champion encounter retry cadence in contested floors.
2. Add telemetry counters for:
   - deep dispatch blocked by readiness hard guard,
   - cooldown escalations by depth,
   - warning-zone dispatch count per depth.

### P2 (quality of tuning loop)

1. Add a dedicated benchmark profile for deep-expedition stress:
   - same seeds and command shape used here, with fixed report destination.
2. Add acceptance gates in benchmark review checklist for:
   - `underFail`,
   - `underReadiness`,
   - `resource_avg_rel`.

## Proposed acceptance thresholds for closure

- Hot seeds (`303,404 @ 12000`):
  - `underFail delta <= +20%`
  - `underReadiness delta >= -3%`
  - `population delta >= -2%`
  - `resource_avg_rel >= -5%`
- Full seeds (`101,202,303,404 @ 8000`):
  - no catastrophic seed collapse,
  - no persistent deep-failure cascade pattern.

## Files currently carrying the active tuning logic

- `src/simulation/ruins.js`
  - readiness damping by schism and depth,
  - adaptive failure cooldown scaling.
- `src/simulation/underrealm.js`
  - schism multiplier damping for exploration/raid strength/casualty/loss.
- `config.json`
  - schism phase/doctrine/climax modifier maps used by underrealm bridge.
