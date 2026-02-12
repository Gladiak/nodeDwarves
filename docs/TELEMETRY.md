# Telemetry Operator Manual 📡⛏️

NodeDwarves telemetry is not just a stats dump. It is an observability cockpit for a living autonomous simulation.

This manual explains, from zero to hero, every telemetry page, each field family, and the logic behind the numbers so you can:

- Diagnose pressure before collapse
- Understand why AI/governors chose a direction
- Validate long-run tuning with deterministic context
- Read short-term noise vs structural trend

## 1) What telemetry is (and what it is not) 🧠

If you are onboarding for the first time, the most useful mental shift is this: telemetry is not decoration, it is your operational language for the colony. In a deterministic simulation, every failure is usually preceded by weak signals. Telemetry exists to expose those weak signals early, so you can reason in terms of systems, not anecdotes. Think of it as the equivalent of a production SRE dashboard, but for dwarves, supply lines, and deep-front pressure. 🤓

Another important point: telemetry is intentionally opinionated. It favors stable, comparable output over visual novelty, because stability is what allows benchmark-to-benchmark reasoning and reliable debugging. The panel is built to answer three questions quickly: what is happening now, where it is drifting, and what will likely break next if you do nothing.

Telemetry is a **read-only operational model** of simulation state.

- It is generated from live runtime state (`state`) and config (`config`)
- It does not change gameplay decisions directly
- It is deterministic given state + config + panel sampling settings

Telemetry in NodeDwarves has two layers:

1. Section telemetry engine (`src/telemetry/telemetry.js`)
2. Data Center panel experience (`src/telemetry/telemetry_panel.js`)

The panel consumes section telemetry and adds higher-level analytics, trend history, context blocks, and operator-centric grouping.

## 2) Controls and panel lifecycle 🎛️

The Data Center is designed to be consulted repeatedly during the same run, not opened once and forgotten. The control model is intentionally tiny so the cognitive load stays on interpretation, not navigation. You should be able to jump between strategic and diagnostic views in a couple of keystrokes while keeping your mental model of the map and colony intact.

Lifecycle-wise, the panel follows runtime sizing and keeps content constrained to predictable geometry. That predictability matters: when you learn where to look for pressure, trend, context, and explainability, your eye-scanning speed improves dramatically over long sessions.

### Open and navigation

- `h`: open/close telemetry Data Center
- `←` / `→`: switch pages while telemetry is open

### Pages

The Data Center has 3 pages:

1. `Dashboard`
2. `Overview + Deep`
3. `Economy`

### Panel sizing

The telemetry panel is centered and sized to ~98% of map area by default:

- Width: clamped between 70 and current grid width
- Height: clamped between 24 and current grid height

Override with:

- `display.telemetry_panel.width`
- `display.telemetry_panel.height`

## 3) Telemetry architecture and data flow 🧩

NodeDwarves telemetry is split into a data engine and a presentation shell. This separation is not just architectural neatness: it is what keeps the system evolvable. You can refine how metrics are shown in the Data Center without rewriting core section extraction, and you can enrich section-level telemetry without breaking page orchestration logic.

For operators and developers, this separation also means trust: values exposed on different pages come from shared snapshots and helpers, so cross-page comparisons remain coherent. In practical terms, you avoid the classic “same metric, different number” trap that breaks confidence in dashboards.

## 3.1 Section engine (`src/telemetry/telemetry.js`)

The section engine is where raw simulation state becomes structured observability. It normalizes missing fields, applies readable formatting, keeps stable row semantics, and emits canonical section payloads. If you think of the Data Center as the UI, this module is the telemetry API contract behind it.

Pipeline:

1. `collectTelemetrySnapshot(...)`
2. `buildTelemetrySectionModels(snapshot)`
3. `renderTelemetryColumns(...)`

This produces canonical section rows for:

- `World`
- `Underrealm`
- `Population`
- `Pressure`
- `Lore`
- `Structures`
- `Diplomacy`
- `Stockpile`
- `Operations`
- `AI Explainability`
- `Endgame`
- `Deep Signals`

## 3.2 Data Center panel (`src/telemetry/telemetry_panel.js`)

The panel layer adds operator ergonomics: paging, high-level summary blocks, trend history, context lenses, and inline status highlighting. It does not replace section telemetry; it composes it into decision-friendly views. This is why the same run can be read at multiple zoom levels, from executive summary (Dashboard) to root-cause deep dive (Overview + Deep, Economy).

Panel pipeline:

1. Resolve page + dimensions + active theme alerts
2. Compute top risk strip (`Colony risk`)
3. Build page content:
   - Dashboard: custom analyst blocks
   - Other pages: section blocks + context lens block
4. Wrap, merge columns, apply inline signal highlighting
5. Draw frame + controls footer

## 4) Alert model used across telemetry 🚨

The alert model is the backbone of triage consistency across pages. Without a shared pressure model, every section would “scream” with a different severity logic, and operators would lose confidence fast. Here, risk level and cause tags are computed once from a compact set of colony-critical indicators and then reused everywhere the UI needs urgency semantics.

Treat this model as a first-stage classifier, not a full diagnosis engine. It tells you *how urgent* the situation is and *which pressure family* is dominant; detailed root cause still lives in section rows and context blocks. In other words: alert first, explain second, act third.

Alert state is computed from:

- Tracked stockpile ratio floor (default tracked resources: food, water, beer)
- Average morale ratio
- Primary shortage score
- Surface raid active
- Deep raid active

Thresholds come from active theme alerts (or defaults):

- `stockpile_warning_ratio`
- `stockpile_critical_ratio`
- `morale_warning`
- `morale_critical`
- `shortage_warning_score`
- `shortage_critical_score`

Alert levels:

- `critical`: any critical threshold breach or raid active
- `warning`: warning threshold breach (no critical condition)
- `stable`: no warning/critical condition

Cause tags:

- `raid`, `deepRaid`, `shortage`, `stockpile`, `morale`, `mixed`, `stable`

Top strip format:

`Colony risk: <Status> (<cause>) Stock:<%> Mor:<%> Shortage:<score>`

## 5) How trend history works 📈

Trend history is deliberately sampled, not tick-by-tick streamed. The goal is to preserve signal quality in fast simulations where per-tick movement can look chaotic and visually unhelpful. By using snapshots and fixed history capacity, the dashboard keeps trends interpretable while remaining lightweight enough for long runs.

This is also why tick-based delta windows are emphasized: they preserve semantic meaning when sampling cadence changes. If you tune snapshot interval for readability, your deltas still refer to comparable real simulation time, not arbitrary sample counts.

Dashboard history is stored in `state.renderState.telemetryDashboardHistory`.

Each sample stores:

- `tick`
- `foodRatio`, `waterRatio`, `beerRatio`
- `foodCurrent`, `waterCurrent`, `beerCurrent`
- `moraleRatio`
- `population`
- `riskScore`

Sampling config:

- `display.telemetry_panel.dashboard.history_points` (default `32`)
- `display.telemetry_panel.dashboard.snapshot_interval_ticks` (default `120`)

Key behaviors:

- One sample is appended only each snapshot interval
- History resets when snapshot interval changes
- History resets safely when ticks go backward (new run/reset)

## 6) Dashboard page (Page 1) deep dive 🛰️

Dashboard is an analyst layout made of blocks.

The first page is your command bridge. It is built to answer, in under ten seconds, whether the colony is healthy, drifting, or approaching a failure envelope. Instead of flooding you with raw rows, it layers “now + direction + consequence” so you can prioritize actions without context switching.

In practice, this page should be your default landing spot during active tuning: read the top strip, validate trend direction, inspect forecast pressure, then decide if you need deeper page-level diagnostics.

## 6.1 KPI Snapshot

`KPI Snapshot` is the high-trust anchor block. It is intentionally compact and minimally interpretive: mostly direct state compression with explicit ratios. Use it to establish baseline orientation before reading derived analytics.

Rows:

1. `Tick / Cycle / Pop (A/C/E)`
- Tick and cycle counters
- Population split: adults, children, elders

2. `Morale / Stress / Stock floor`
- Morale and stress are average dwarf state metrics
- Stock floor = min(foodRatio, waterRatio, beerRatio)

3. `Risk level/cause + score`
- Uses computed alert level and risk score

4. `Underrealm depth summary + deep raids`
- Shows active/max unlocked/max depth and active deep raid count

5. `Food/Water/Beer target ratios`
- Ratios are `current / target` (can exceed 100%)

## 6.2 Trend Charts

Purpose: visualize direction over time, not instant noise.

This block teaches you the rhythm of the run. The sparklines are not “cute charts”; they are compact phase detectors. A flat line means regime stability, a steady incline/decline means structural drift, and oscillation means control instability or periodic event pressure. Always pair sparkline shape with delta labels, never one without the other.

Header row:

- Sampling cadence (`1pt/<interval>t`)
- Total window (`history_points * interval`)
- Delta window (analysis lookback in ticks)
- Current samples count

Series shown:

- Food target%
- Water target%
- Beer target%
- Morale
- Population
- Risk score

Sparkline mechanics:

- Series is lightly smoothed (moving average radius 1)
- Resampled to fit line width
- Glyph ramp: `._-:=+*#%@`
- Some metrics use fixed scales (for comparability)

Delta mechanics:

- Deltas are computed by **tick lookback**, not by fixed sample count
- This keeps meaning stable when sampling cadence changes

## 6.3 Forecast & Bottlenecks

Purpose: convert trends into operational foresight.

This is where telemetry stops reporting and starts forecasting. The block translates trend slopes into time-to-threshold and flow language, which is much closer to real operational decision-making. Instead of asking “is water low?”, you can ask “how many ticks to warning if current regime persists?”.

`Bottleneck` is especially useful when multiple pressures coexist: it highlights the constraint with the highest immediate explanatory power and couples urgency with trend and flow, so you can distinguish temporary dips from systemic deficits.

Rows:

1. `Window`
- Analysis window in ticks + samples observed

2. `Runway warn`
- Estimated ticks to warning threshold for food/water/beer

3. `Runway crit`
- Estimated ticks to critical threshold for food/water/beer

Runway formula:

- Inputs: current ratio, ratio slope per tick, threshold ratio
- If current <= threshold: `now`
- If slope >= 0: `stable` (not drifting toward threshold)
- Else: `(current - threshold) / abs(slope)`

4. `Net flow /100t`
- Per-resource stock unit trend normalized to 100 ticks
- Computed from `foodCurrent/waterCurrent/beerCurrent` history slopes

5. `Risk momentum`
- Long-window risk delta
- Short-window risk delta
- Acceleration = short slope - long slope

6. `Volatility`
- Stock volatility and risk volatility labels (`low/medium/high`)
- Numeric value = mean absolute point-to-point change (recent samples)

7. `Bottleneck`
- Primary shortage label/urgency + trend + flow
- Falls back to weakest core resource watchline when no shortage exists
- Also includes utilization and gather-share context

## 6.4 Risk Breakdown

Think of this block as risk decomposition math rendered for humans. The gauge gives magnitude, the pressure mix gives attribution, and hazard flags add binary context that can dominate planning (for example raids). This decomposition helps avoid premature fixes, like overreacting to morale when stock pressure is the real driver.

Rows:

1. Risk gauge bar + risk % + alert level
2. Pressure mix components
3. Hazard flags (surface/deep raids)
4. Active thresholds
5. Primary shortage detail
6. Secondary shortage detail

Risk score composition:

- Stock pressure: `1 - stockpileRatio`
- Morale pressure: `1 - moraleRatio`
- Shortage pressure: `shortageScore / shortageCriticalThreshold`
- Raid pressure: `1` if raid active else `0`

Weighted score:

- `0.35 * stock + 0.25 * morale + 0.25 * shortage + 0.15 * raid`

Floor forcing:

- At least `0.75` when alert is critical
- At least `0.45` when alert is warning

## 6.5 Operations Mix

A healthy colony is not only about stock levels; it is about throughput capacity and allocation quality. `Operations Mix` makes execution capacity visible: who is busy, where jobs are concentrated, and how much adult workforce is effectively utilized.

If your strategy looks correct on paper but outcomes are weak, this block is usually where the mismatch appears first.

Rows:

1. Workforce split stacked bar (`I/J/U/E`)
2. Workforce legend
3. Job mix stacked bar (`G/C/B/M/O`)
4. Job legend
5. Adult utilization + active jobs + shortage score

Legend:

- `I`: idle adults
- `J`: assigned adults
- `U`: adults on underrealm duty
- `E`: adults on expedition
- `G`: gather jobs
- `C`: craft jobs
- `B`: build/upgrade jobs
- `M`: mine jobs
- `O`: other jobs

## 6.6 Event Timeline

Most collapses are timing problems before they are quantity problems. Contracts expire, events spawn, rites rotate, raids overlap. `Event Timeline` compresses those clocks into one operator row group so you can sequence actions rather than react blindly.

Rows summarize live temporal windows:

- World event status or next spawn ETA
- Contract status
- Festival status
- Alchemy mode/status
- Raid status surface/deep

## 6.7 Actionable Insights

Deterministic rule-based hints, not random flavor text.

This block is intentionally deterministic and conservative: same state, same hint. It is not an “AI assistant”; it is a policy-aligned suggestion layer that points to dominant recovery or optimization moves. Use it as a sanity check against your own interpretation, especially during long balancing sessions.

Rule examples:

- Critical/warning posture focus
- Weakest core stock recovery suggestion
- Morale stabilization suggestion
- Raid defense posture
- Top shortage driver highlight
- Fallback optimization/watchline hints

## 7) Overview + Deep page (Page 2) deep dive 🕳️

Page 2 now starts with `Deep Context`, then detailed sections.

If Dashboard tells you *that* pressure exists, `Overview + Deep` tells you *where in the world model* that pressure is materializing. This page is tuned for systemic diagnosis: frontier progression, underrealm gating, demographic stability, and macro-pressure synthesis in one place.

## 7.1 Deep Context

`Deep Context` is the narrative bridge between high-level risk and raw section diagnostics. Read it first to prime your interpretation: it frames direction, raid posture, stock floor health, and near-term timeline state before you enter detailed rows.

Rows summarize context before raw detail:

- Risk posture + delta
- Population/morale/stress lens + delta
- Frontier posture (depth progression framing)
- Raid status
- Core stock floor + core stock ratios
- Contract/event timeline summary

This is your fast “what changed and why should I care” layer.

## 7.2 World section

The `World` section is your temporal and environmental backbone. It merges timeline, climate, prestige progression, and event states so you can understand whether current behavior is structural or season/event-driven.

Rows:

1. Timeline (tick/year/season)
2. Cycles completed + villages count
3. Prestige total + rank
4. Weather + remaining ticks
5. Housing ratio (beds per dwarf)
6. Festival status
7. World event status
8. Contract status
9. Alchemy status
10-12. Latest world log (wrapped, capped)

Notes:

- World log is fixed-height (3 rows) to avoid visual jumping
- Year is derived from seasons config and tick

## 7.3 Underrealm section

Underrealm telemetry is intentionally normalized because frontier data can otherwise jump around visually as systems unlock. Stable row semantics let you compare states tick-to-tick without relearning layout each time.

Underrealm rows are normalized into a stable 9-row structure:

1. Realm status (surface/depth + unlocked progression)
2. Hidden gate/search status
3. Depth progression status
4. Champion gate status
5. Readiness gate status
6. Strata snapshot
7. Delver role ratios
8. Assigned delvers vs surface adults
9. Underrealm pressure (ward/oath/threats)

Signals may include:

- Lift progression
- Champion cooldown/victory stats
- Readiness gate blocks/warnings
- Depth stock reserves and survey progress

## 7.4 Population section

Population is the colony’s execution substrate. This block is not only “how many dwarves”; it is demographic composition, morale/stress climate, and mortality/reproduction signals that forecast labor sustainability.

Rows:

1. Population total
2. Adults/children/elders split
3. Workforce assignment summary
4. Wildlife status
5. Morale + beer boost and stress
6. Births/deaths total
7. Deaths by cause (starvation/raids/deep raids)
8. Reproduction success rate

## 7.5 Lore section

`Lore` is not cosmetic fluff in this context. Myth and ruins signals are compactly surfaced because they alter meaningful multipliers and expedition posture. This section helps connect narrative systems to practical operational consequences.

Rows summarize myths + ruins:

- Active myths/traditions counts
- Primary/secondary myth names
- Primary/secondary myth bonus summaries
- Ruins rooms progress
- Expedition status
- Artifact progress summary
- Ruins bonus summary

If systems are disabled, explicit `off`/`-` placeholders are shown.

## 7.6 Pressure section

`Pressure` is the shortest path to “what is constraining us right now?”. It combines shortage urgency, stock target alignment, raid burden, and jobs-governor weighting into one diagnostic cluster.

Rows:

1. Primary shortage line
2. Secondary shortage line
3. Core stock targets line
4. Build stock targets line
5. Surface raid aggregate status
6. Jobs governor top weighted resources

Shortage line includes:

- Resource label
- Percent of target
- Urgency score

## 7.7 Deep Signals section

`Deep Signals` complements frontier diagnostics with diplomacy/event cadence and contract reliability. It is especially useful when your run feels unstable but no single stock or combat metric looks catastrophic in isolation.

Rows:

1. World event live status
2. World event aggregate stats
3. Next world event ETA
4. Contract reputation
5. Contract record
6. Contract success rate

## 8) Economy page (Page 3) deep dive 🏭

Page 3 starts with `Economy Context`, then economic detail sections.

This page is for structural tuning. If you are asking “is my colony economically robust or just temporarily lucky?”, this is where you answer it. It links inventory health, execution load, governor intent, and endgame readiness in one economically coherent view.

## 8.1 Economy Context

`Economy Context` is the fast primer for this page. Before reading detailed tables, it tells you where pressure is concentrated, how core stocks are drifting, whether workforce is saturated, and which shortage vectors are currently dominant.

Rows:

- Stock pressure + weakest core resource + shortage pressure
- Trend context for food/water/beer/risk
- Workforce load and active jobs
- Primary/secondary shortage drivers
- Contract/festival/alchemy operational clocks

## 8.2 Stockpile section

Stockpile bars are intentionally ratio-centric: they map holdings against configured targets, not arbitrary absolute values. This keeps interpretation stable across colony scales and growth phases.

Each row is a bar line:

`<Label>: [#####-----] <count>/<target>`

Bar behavior:

- Scale uses per-resource target
- If `display.telemetry.stockBarMax > 0`, that fixed max is used
- Bars are clamped to [0,1] visually

Equipment compaction:

- `weapon_tier_*` and `armor_tier_*` are aggregated
- Rows become compact equipment ranges (e.g. `Weapons T1-T10`)
- Detail includes highest stocked tier marker (`hiT*`)

## 8.3 Structures section

Structures are slow-moving leverage points. This section lets you read the installed base and progression stage at a glance, so you can correlate economic behavior with infrastructure maturity.

Rows:

- Core structures counts
- Production structures counts
- Defense structures counts
- Arcane structures counts
- Temple stage status
- Temple construction progress
- Tool upgrade level
- Structure level summary (mine/sawmill/brewery/mithril forge)

## 8.4 Operations section

Operations is where throughput reality shows up. Even with perfect targets, bad queue composition or poor workload split can stall the economy. Use this block to validate that labor and jobs are aligned with current pressure profile.

Rows:

1. Workforce (adults) assignment counts
2. Active jobs by type
3. Queue composition (brewery/hunt/upgrade/other)
4. Build pipeline status
5. Tool level + total active jobs
6. Core stock trend over rolling 200-tick window
7. Build stock trend over rolling 200-tick window
8. Primary shortage signal
9. Building governor line
10. Total shortage pressure (sum of shortage scores)
11. Workload split (production/infrastructure/other)

The stock trend window uses a rolling history in renderState (`telemetryStockHistory`).

## 8.5 AI Explainability section

This section is your model governance lens for AI-driven policies.

When policy behavior looks surprising, this section provides provenance and rationale traces. It is designed to answer: “Was this decision action-driven or fallback logic, what pressures ranked highest, and which governor biases were active at that moment?”

Rows:

1. Decision tick and source provenance (`jobs/trade/build`: action vs default)
2. Top ranked drivers
3. Shortage #1 with score/weight/boost
4. Shortage #2 with score/weight/boost
5. Runtime context (weather/raid/event/festival)
6. Trade explainability
7. Build explainability
8. Job load summary

Driver logic:

- Up to 3 top drivers
- Shortage drivers are humanized to resource labels

Governor explainability includes:

- Reserve bias
- Contest/opportunity intents
- Mine/upgrade bias
- Building class priority order

## 8.6 Diplomacy section

Diplomacy rows expose external economic coupling: merchant flows, contracts, and event opportunities. Use this section to verify whether outside interactions are relieving pressure or amplifying variance.

Rows:

- Merchant status
- Merchant completed trades
- Top exported resource
- Top imported resource
- Contract status
- Contract reputation by faction
- Contract record
- Trade governor status
- World event aggregate summary
- World event live status

## 8.7 Endgame section

Checklist-style operator view.

Endgame telemetry is intentionally checklist-shaped because it represents a gated progression pipeline. Rather than raw counters, you get explicit completion semantics, ETA logic, and blockers so cycle-reset readiness is operationally transparent.

Rows include:

- Cycle loop enabled/disabled
- Cycle history
- Ruins gateway status
- Required path progress (`x/4`)
- Step checklist:
  - Clear all rooms
  - Recover all artifacts
  - Hold post-artifact wait window
  - Arm new cycle trigger
- Next reset ETA reason
- Optional temple completion
- Cycle pressure multiplier

## 9) Visual language and inline highlighting 🎨

Visual semantics are part of telemetry logic, not an aesthetic afterthought. Inline color tokens and status word highlights are there to reduce scan latency in dense panels. During long sessions, this cuts decision time and lowers operator fatigue.

Telemetry panel highlights key words inline:

- Critical words: `critical`, `blocked`, `failed`
- Warning words: `warning`, `pending`, `cooldown`, `active`
- Positive/ready words: `ready`, `complete`, `cleared`, `online`

Section headers are also color-tagged for fast scanning.

## 10) Placeholders and stability rules 🧱

Stable dashboards beat sparse dashboards in deterministic tuning workflows. Placeholder rules ensure row continuity across feature states (enabled, disabled, missing, pending), so you can compare screenshots/log captures without layout churn.

Telemetry intentionally prefers stable output over sparse silence.

You will see:

- `-` for missing/inactive data
- `off` for disabled systems
- fixed-row normalization in some sections to avoid jitter

This is deliberate to keep human diff-reading and benchmark screenshots consistent.

## 11) Configuration knobs that matter most ⚙️

Telemetry is intentionally tunable. If your run speed, terminal size, or analysis style changes, you can retune panel behavior without touching code. The most impactful knobs are sampling/window settings and alert thresholds.

Core telemetry knobs:

- `display.telemetry.stockBarMax`
- `display.telemetry_panel.enabled`
- `display.telemetry_panel.width`
- `display.telemetry_panel.height`
- `display.telemetry_panel.dashboard.history_points`
- `display.telemetry_panel.dashboard.snapshot_interval_ticks`

Alert thresholds (theme-driven):

- `display.themes.<id>.alerts.tracked_resources`
- `display.themes.<id>.alerts.stockpile_warning_ratio`
- `display.themes.<id>.alerts.stockpile_critical_ratio`
- `display.themes.<id>.alerts.morale_warning`
- `display.themes.<id>.alerts.morale_critical`
- `display.themes.<id>.alerts.shortage_warning_score`
- `display.themes.<id>.alerts.shortage_critical_score`

## 12) Operator workflow: zero to hero 🧪

This workflow is intentionally progressive. Do not jump straight to deep diagnostics every tick: start with risk posture, escalate to trend interpretation, then move into root-cause sections only when needed. That cadence keeps analysis fast and repeatable.

## Level 0: Basic survival check

This level is about avoiding obvious collapses with minimal cognitive load.

1. Open Dashboard
2. Read top `Colony risk`
3. Check `Stock floor` and `Runway warn`
4. If any runway is short, stabilize core resource immediately

## Level 1: Trend-aware triage

At this level, you are no longer reacting to point values; you are reacting to direction.

1. Read `Trend Charts` (not just point values)
2. Confirm `Risk momentum` direction
3. Use `Actionable Insights` for deterministic next move

## Level 2: Root-cause analysis

This is where you separate symptom from mechanism by correlating deep context with section detail.

1. Go to `Overview + Deep`
2. Read `Deep Context`
3. Check `Pressure` + `Underrealm` + `Deep Signals`
4. Decide whether collapse risk is surface, deep, or mixed

## Level 3: Structural optimization

Now you are tuning for equilibrium, not firefighting. Use this level for long-run performance shaping and policy validation.

1. Go to `Economy`
2. Read `Economy Context`
3. Correlate `Stockpile`, `Operations`, `AI Explainability`
4. Tune config/governor assumptions and re-run deterministic benchmark

## 12.1 Scenario playbooks (live examples) 🎮

The fastest way to become dangerous with telemetry is to rehearse concrete failure stories. The scenarios below are based on typical long-run patterns: they show what the panel *feels like* while the system degrades, where the first reliable clue appears, and which page gives the decisive evidence.

Read them like tactical drills. If a real run starts to resemble one of these signatures, you can jump directly to the matching analysis path instead of improvising under pressure.

### Scenario A: The slow water crash 💧

You are in mid-run, population is growing, and nothing looks dramatic at first glance. Dashboard risk stays warning/stable for a while, but `Trend Charts` show water ratio drifting down steadily while food and beer look acceptable. In `Forecast & Bottlenecks`, `Runway warn` for water compresses much faster than other resources.

At this stage, many operators focus on absolute stock and miss the ratio slope. The right move is to open `Economy` and check `Operations` + `AI Explainability`: if job mix underweights gather or the governor is prioritizing other pressure, you have a structural allocation mismatch, not a random fluctuation.

Telemetry signature:

1. `Dashboard`: water trend negative, water runway shrinking, risk momentum mildly up
2. `Economy Context`: weakest resource = water, shortage pressure rising
3. `Pressure`/`Operations`: primary shortage repeatedly water, gather share not compensating

### Scenario B: Frontier trap with deep pressure 🕳️

The colony seems fine on surface stocks, but raids and readiness friction in underrealm keep stealing stability. Dashboard may show mixed cause tags and risk oscillation without obvious stock collapse. This is where `Overview + Deep` becomes mandatory.

Open `Deep Context` first: if raid flags are active and frontier posture is blocked/warning, then inspect `Underrealm` rows for champion gate cooldowns, readiness thresholds, and progression stalls. `Deep Signals` helps confirm whether the instability is synchronized with event/contract cadence.

Telemetry signature:

1. `Dashboard`: risk volatility medium/high, stock floor not catastrophic, cause often `mixed` or `deepRaid`
2. `Deep Context`: raids active + weak frontier posture
3. `Underrealm`: gate/readiness friction, stalled progression, threat pressure persistent

### Scenario C: False prosperity loop 📦

This one is tricky: stockpile looks rich, but operations are saturated in the wrong places and future pressure is building silently. You might see strong stock bars and still get hit later by shortages, morale dips, or missed windows.

Use `Economy Context` and `Operations Mix` to verify whether utilization and job composition are balanced. Then check `AI Explainability` for source provenance and governor biases. If decisions are consistent but misaligned, you likely need parameter tuning rather than tactical intervention.

Telemetry signature:

1. `Stockpile`: healthy bars, sometimes over target
2. `Operations`: high utilization but skewed workload split or queue composition
3. `Forecast & Bottlenecks`: momentum/volatility warns before visible stock crisis

### Scenario D: Endgame lock despite stable economy 🗝️

The colony can look operationally healthy while cycle reset never arms. This is not an economy failure; it is usually a progression-gate mismatch. Go straight to `Endgame` and read it as a pipeline status board.

If checklist steps stall on rooms/artifacts/wait window, correlate with `Lore` and `Deep` signals. If readiness or frontier constraints block expedition throughput, the root cause may live in underrealm progression rather than stockpile.

Telemetry signature:

1. `Endgame`: progress stuck on one checklist step
2. `Lore`: ruins/artifact progression not advancing
3. `Overview + Deep`: frontier/readiness/champion constraints reduce expedition continuity

### Scenario heuristic: pick the right page first 🧭

When under time pressure, use this quick routing rule:

1. Unclear instability -> start `Dashboard`
2. Deep raids/frontier suspicion -> jump `Overview + Deep`
3. Throughput/governor/economic suspicion -> jump `Economy`
4. Reset/progression suspicion -> inspect `Endgame` + `Lore` + `Underrealm`

This routing habit alone cuts diagnosis time massively in long balancing sessions. ⚙️

## 13) Common interpretation pitfalls (and fixes) 🧯

Even good telemetry can be misread under pressure. The pitfalls below are the most frequent operator errors observed in simulation triage and balancing loops.

1. Mistaking short noise for trend
- Use delta windows and runway, not single-tick value.

2. Watching only stock count, not target ratio
- Ratios normalize by target; absolute counts alone can mislead.

3. Ignoring source provenance in explainability
- `action` vs `default` matters when diagnosing policy behavior.

4. Overreacting to one shortage without pressure context
- Check total shortage pressure + risk components + utilization.

## 14) Telemetry internals quick reference for developers 🛠️

For contributors, this section is the fast map of where telemetry truth is produced and cached. If you extend metrics, treat determinism, placeholder safety, and cross-page coherence as non-negotiable invariants.

Main sources:

- `src/telemetry/telemetry.js`
- `src/telemetry/telemetry_panel.js`
- `src/render/colors.js`

Important runtime caches in `state.renderState`:

- `telemetryDashboardHistory`
- `telemetryDashboardHistoryMeta`
- `telemetryStockHistory`

When adding a telemetry metric, verify:

1. Data is deterministic and safe when missing
2. Placeholder behavior is explicit
3. Labels are readable and compact
4. `telemetry_panel.js` and section telemetry stay coherent
5. Documentation stays synchronized

## 15) Final mental model 🧭

The most productive way to use NodeDwarves telemetry is to read it as a three-layer story: state, direction, consequence. When all three align, decisions become obvious; when they diverge, that divergence is usually the clue you need.

Think of telemetry in 3 layers:

- **State now**: KPI/section values
- **Direction**: trends, deltas, momentum
- **Consequence**: runway, bottlenecks, reset/readiness gates

If you read all three layers together, telemetry becomes a full operator console rather than a static wall of numbers. 🍺
