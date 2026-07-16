# NodeDwarves Epic Evolution Baseline

Generated: 2026-07-16T13:12:10Z  
Workbook step: E0.1  
Status: Complete

## Freeze identity

| Field | Value |
| --- | --- |
| Branch | `epicEvolution` |
| Commit | `c9cda62f495f83cf825f28b63db1f79c1abb1540` |
| Worktree before E0.1 | Clean |
| Platform | Darwin 25.5.0 arm64 |
| Node | `v24.14.0` |
| Config SHA-256 | `16cab5b529e99eed7f65ce3f4a08fe994f7828a8cb2e7be690926a0b253bffb3` |
| Configured display | Auto-size, `190x60` fallback, `20 ms` tick |
| Deterministic probe layout | `120x40` total, `118x38` grid, frame enabled |

## Active policy contract

- Default `npm start`: heuristic governor (`ai.runtime.enabled=false`).
- Configured runtime path when enabled: `models/policy.json`.
- `npm run ai:play`: `models/policy_best.json`.
- Best policy SHA-256: `9168d821b3994923e91d1f34d961a739e86ffc9f288325759d91bd4388446689`.
- Best policy metadata: score `4.2029689` (`rpt`), `20x2200` evaluation, compact transport.

## Cached balance baseline

The cache guard detected a config-hash mismatch and regenerated the official baseline. A second
`npm run bench:ensure-baseline` confirmed that the refreshed cache is aligned.

| Field | Value |
| --- | --- |
| Previous config hash | `619598a2315b57c594203e260dd896b739c1c55d0a41057ed2777843aac07dab` |
| Current config hash | `16cab5b529e99eed7f65ce3f4a08fe994f7828a8cb2e7be690926a0b253bffb3` |
| Ticks | `8000` |
| Seeds | `101,202,303,404` |
| Resources | `beer,food,water` |
| Layout arguments | `120x40` |
| Generated | `2026-07-16T12:54:25.470Z` |
| JSON SHA-256 | `fb410b3b5fc1b433a4ffd8b37193c8135564f3d0facb42a59497b96fc1ba2a1c` |
| Markdown SHA-256 | `bdf31e1c19f604409b7df81c0c91352674eef63dd02a08b50edeb49f1e9dc749` |

Baseline summary:

| Population | Morale | Hunger | Thirst | Underrealm depth | Underrealm readiness |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 698.25 | 0.8851 | 0.1575 | 0.1083 | 2.25 | 0.8061 |

No benchmark seed collapsed. Final populations were `683`, `678`, `732`, and `700`.

## Frozen visual references

The current product screenshots form a visually consistent sequence with the same layout and
monotonically increasing ticks. Their seed is not embedded, so they are frozen as visual evidence,
not deterministic metric evidence. All reference images are `2904x2048` pixels.

| View | File | Visible tick | SHA-256 |
| --- | --- | ---: | --- |
| Surface | `assets/NodeDwarves_1.png` | 4800 | `bb9f76a01425e0ac6432ba69f38c5f01dc1b6168dfc2875b2a1daf08519fe58f` |
| Data Center | `assets/NodeDwarves_2.png` | 5051 | `b54c0335107a4d4b91e522b33370ea9de2e8aae33cbba603715864de76c1dd32` |
| Character Inspect | `assets/NodeDwarves_4.png` | 5298 | `296444614b8a958a0afb0c54ea369b48ffb2db864ec9df9b591c445f1d085da2` |
| Underrealm | `assets/NodeDwarves_5.png` | 5475 | `8d20d42dd03fa9781cf006d64ab1028e0b1d9189adee5b416bfc780a9ee230de` |

## Event-log baseline

Method: one deterministic 8,000-tick run per benchmark seed. The short snapshot was taken at tick
1,000 from the same run. Counts describe the retained `state.eventLog`, including the current
300-entry per-seed cap.

Current stored event fields are only `tick`, `message`, `category`, and `source`.

### Short horizon - tick 1,000

- Stored entries: `631` across four seeds.
- Raw `dwarf_N` messages: `238` (`37.72%`).
- No seed reached the 300-entry retention cap.

| Category | Count | Share |
| --- | ---: | ---: |
| diplomacy | 138 | 21.87% |
| economy | 122 | 19.33% |
| social | 99 | 15.69% |
| warrior | 78 | 12.36% |
| lifecycle | 59 | 9.35% |
| schism | 46 | 7.29% |
| world | 32 | 5.07% |
| other | 29 | 4.60% |
| combat | 21 | 3.33% |
| myth | 5 | 0.79% |
| festival | 2 | 0.32% |

### Long horizon - tick 8,000

- Stored entries: `1,200/1,200`; every seed saturated its 300-entry cap.
- Raw `dwarf_N` messages: `462` (`38.50%`).
- Retained history spans only `859-1,166` ticks depending on seed.

| Seed | Population | Retained ticks | Raw-ID share |
| ---: | ---: | --- | ---: |
| 101 | 683 | 7141-8000 | 33.33% |
| 202 | 678 | 6829-7995 | 43.33% |
| 303 | 732 | 6980-7999 | 44.00% |
| 404 | 700 | 7080-8000 | 33.33% |

| Category | Count | Share |
| --- | ---: | ---: |
| lifecycle | 285 | 23.75% |
| schism | 230 | 19.17% |
| diplomacy | 155 | 12.92% |
| underrealm | 113 | 9.42% |
| social | 100 | 8.33% |
| other | 78 | 6.50% |
| warrior | 77 | 6.42% |
| economy | 52 | 4.33% |
| combat | 44 | 3.67% |
| world | 40 | 3.33% |
| festival | 14 | 1.17% |
| myth | 12 | 1.00% |

Interpretation for later workstreams:

- E1 needs structured fields for importance, actors, locations, causes, consequences, saga IDs, and
  deterministic event IDs.
- E2 starts from a measured raw-ID baseline of `38.50%` at long horizon.
- E5 cannot use the rolling Event Log as the only Chronicle source because most of an 8,000-tick run
  has already been truncated.

## Rendering baseline

Method: final tick-8,000 state for every seed; two warmup frames, then 12 frame-build samples and 24
output-write samples per mode and seed. Output write is measured synchronously against `/dev/null`
to separate byte-write cost from frame construction. It does not include terminal-emulator paint.

| Mode | Mean bytes | Mean build | Highest seed p95 | Mean output write |
| --- | ---: | ---: | ---: | ---: |
| Surface | 97,247.5 | 1.146 ms | 2.090 ms | 0.097 ms |
| Underrealm | 92,922.0 | 0.817 ms | 1.001 ms | 0.082 ms |
| Telemetry | 15,445.3 | 1.449 ms | 2.301 ms | 0.020 ms |
| Inspect | 34,367.3 | 1.914 ms | 7.832 ms | 0.031 ms |

The Inspect panel is the highest-variance mode and should be watched during biography work. Surface
and Underrealm frame construction have substantial headroom relative to the configured `20 ms` tick
on this machine, but future comparisons must use the same hardware and runtime profile.

## E0.1 conclusions

1. The official balance baseline is now aligned with the active config.
2. The retained log is already saturated at long horizon and is not a full-history store.
3. Raw actor IDs occupy roughly two out of every five retained messages.
4. Current events cannot express actors, locations, causality, consequences, importance, or stable IDs.
5. Rendering is currently fast in the frozen headless layout; Inspect is the main variance hotspot.
6. The existing screenshots are sufficient as a visual freeze, but future automated screenshot work
   should embed seed, tick, layout, and config hash in its metadata.

## Commands executed

```bash
npm run bench:ensure-baseline
npm run bench:ensure-baseline
node --check /private/tmp/epic_baseline_probe.js
node /private/tmp/epic_baseline_probe.js
npm test
```

Detailed machine-readable values live in `debug/epic_baseline_summary.json`.
