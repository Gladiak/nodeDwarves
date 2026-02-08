import argparse
import json
import multiprocessing as mp
import os
import queue
import random
import subprocess
import sys
import time

try:
    import torch
    from torch import nn
    from torch.distributions import Normal
except ImportError as exc:
    raise SystemExit(
        "PyTorch is required. Install with: pip install torch"
    ) from exc


DEFAULT_FEATURE_NAMES = [
    "shortage",
    "nodeScarcity",
    "criticalNeeds",
    "idleAdults",
    "populationBalance",
    "seasonIndex",
    "seasonProgress",
    "weatherSeverity",
    "weatherTimeLeft",
    "raidActive",
    "raidTimeLeft",
    "raidExposed",
    "raidDefense",
    "housingShortage",
    "seasonEligible",
    "festivalActive",
    "festivalTimeLeft",
    "festivalEligible",
    "festivalCostRatio",
]
EXTENDED_FEATURE_NAMES = [
    "ruinsActive",
    "ruinsCooldown",
    "ruinsProgress",
    "ruinsArtifacts",
    "mythsActiveRatio",
    "mythsSeverity",
]
DYNAMIC_FEATURE_PREFIXES = ("mythFlag_", "clanShare_")
FEATURE_NAME_SET = set(DEFAULT_FEATURE_NAMES + EXTENDED_FEATURE_NAMES)
FESTIVAL_ACTION_ID = "festival"
TRADE_RESERVE_BIAS_ACTION_ID = "gov_trade_reserve_ratio_bias"
TRADE_CONTEST_INTENT_ACTION_ID = "gov_trade_contest_intent"
TRADE_OPPORTUNITY_INTENT_ACTION_ID = "gov_trade_opportunity_intent"
BUILDING_HOUSING_WEIGHT_ACTION_ID = "gov_building_housing_weight"
BUILDING_ECONOMY_WEIGHT_ACTION_ID = "gov_building_economy_weight"
BUILDING_DEFENSE_WEIGHT_ACTION_ID = "gov_building_defense_weight"
BUILDING_SPECIAL_WEIGHT_ACTION_ID = "gov_building_special_weight"
BUILDING_MINE_BIAS_ACTION_ID = "gov_building_mine_bias"
BUILDING_UPGRADE_BIAS_ACTION_ID = "gov_building_upgrade_bias"
GOVERNOR_ACTION_ID_SET = {
    TRADE_RESERVE_BIAS_ACTION_ID,
    TRADE_CONTEST_INTENT_ACTION_ID,
    TRADE_OPPORTUNITY_INTENT_ACTION_ID,
    BUILDING_HOUSING_WEIGHT_ACTION_ID,
    BUILDING_ECONOMY_WEIGHT_ACTION_ID,
    BUILDING_DEFENSE_WEIGHT_ACTION_ID,
    BUILDING_SPECIAL_WEIGHT_ACTION_ID,
    BUILDING_MINE_BIAS_ACTION_ID,
    BUILDING_UPGRADE_BIAS_ACTION_ID,
}

DEBUG_LOG_DIRNAME = "debug"
DEBUG_LOG_EVERY = 500
SUMMARY_LOG_EVERY = max(1, int(os.getenv("SUMMARY_LOG_EVERY", DEBUG_LOG_EVERY)))
LOG_RATE = os.getenv("TRAIN_LOG_RATE", "").strip().lower() in ("1", "true", "yes", "on")
DEBUG_LOG_KEEP = 5
TRAINING_LOGS_ENABLED = True
DETAIL_EVAL_REGRESSION_ABS = 25.0
DETAIL_EVAL_REGRESSION_REL = 0.01
DETAIL_SCENARIO_SHIFT = 0.2
BEST_EVAL_COLOR = "\033[96m"
COLOR_RESET = "\033[0m"
USE_COLOR = sys.stdout.isatty()


def tint(text, color, enabled=USE_COLOR):
    return f"{color}{text}{COLOR_RESET}" if enabled else text


def print_best_saved_line(episode, score, avg_reward, model_path, meta_path):
    if not TRAINING_LOGS_ENABLED:
        return
    line = (
        f"[BEST SAVED] episode={episode} score={score:.3f} avg_reward={avg_reward:.2f} "
        f"model={model_path} meta={meta_path}"
    )
    print(tint(line, BEST_EVAL_COLOR))


def send(proc, payload):
    proc.stdin.write(json.dumps(payload) + "\n")
    proc.stdin.flush()
    line = proc.stdout.readline()
    if not line:
        raise RuntimeError("Server closed")
    return json.loads(line)


def clamp(value, low, high):
    return max(low, min(high, value))


def inference_mode():
    if hasattr(torch, "inference_mode"):
        return torch.inference_mode()
    return torch.no_grad()


def configure_torch_threads(default_threads=2, default_interop=1):
    threads_env = os.getenv("TORCH_NUM_THREADS")
    interop_env = os.getenv("TORCH_NUM_INTEROP_THREADS")
    try:
        threads = int(threads_env) if threads_env is not None else default_threads
        torch.set_num_threads(max(1, threads))
    except (TypeError, ValueError, RuntimeError):
        pass
    try:
        interop = int(interop_env) if interop_env is not None else default_interop
        torch.set_num_interop_threads(max(1, interop))
    except (TypeError, ValueError, RuntimeError):
        pass


def format_debug(info, resources):
    debug = info.get("debug") or {}
    if not debug:
        return ""

    def fmt(value, digits=2):
        try:
            return f"{float(value):.{digits}f}"
        except (TypeError, ValueError):
            return f"{0.0:.{digits}f}"

    def fmt_map(values, keys):
        parts = []
        for key in keys:
            if key in values:
                parts.append(f"{key}={fmt(values.get(key))}")
        if not parts:
            for key in sorted(values.keys()):
                parts.append(f"{key}={fmt(values.get(key))}")
        return " ".join(parts) if parts else "n/a"

    reproduction = debug.get("reproduction") or {}
    deaths = debug.get("deaths") or {}
    raid = debug.get("raid") or {}
    stockpile = debug.get("stockpile") or {}
    ratios = stockpile.get("ratios") or {}
    raid = debug.get("raid") or {}
    raid_loot = raid.get("loot") or {}
    nodes = debug.get("nodes") or {}
    needs_avg = debug.get("needsAvg") or {}
    housing = debug.get("housing") or {}
    fields = debug.get("fields") or {}
    merchant = debug.get("merchant") or {}
    crit = debug.get("criticalNeedsFraction", 0.0)
    idle = debug.get("idleAdultsFraction", 0.0)
    attempts = int(reproduction.get("attempts", 0) or 0)
    successes = int(reproduction.get("successes", 0) or 0)
    success_rate = successes / attempts if attempts > 0 else 0.0
    blocked = reproduction.get("blocked") or {}
    blocked_str = (
        f"inf={int(blocked.get('infertile', 0) or 0)} "
        f"preg={int(blocked.get('pregnant', 0) or 0)} "
        f"cool={int(blocked.get('cooldown', 0) or 0)} "
        f"noRes={int(blocked.get('noResources', 0) or 0)} "
        f"house={int(blocked.get('noHousing', 0) or 0)} "
        f"chance={int(blocked.get('chance', 0) or 0)}"
    )

    merchant_trades = merchant.get("tradesPerTick", 0.0)
    merchant_given = merchant.get("givenPerTick") or {}
    merchant_received = merchant.get("receivedPerTick") or {}

    return (
        "diag "
        f"deaths[starv={int(deaths.get('starvation', 0) or 0)} "
        f"old={int(deaths.get('oldAge', 0) or 0)} "
        f"raid={int(deaths.get('raid', 0) or 0)}] "
        f"raid[cnt={fmt(raid.get('count', 0), 2)} "
        f"deaths={fmt(raid.get('deaths', 0), 2)} "
        f"exp={fmt(raid.get('exposedRatio', 0), 2)} "
        f"def={fmt(raid.get('defenseRatio', 0), 2)}] "
        f"repro[ticks={int(reproduction.get('ticks', 0) or 0)} "
        f"couples/t={fmt(reproduction.get('couplesPerTick', 0))} "
        f"fertile/t={fmt(reproduction.get('fertileAdultsPerTick', 0))} "
        f"preg/t={fmt(reproduction.get('pregnanciesPerTick', 0))} "
        f"cool/t={fmt(reproduction.get('cooldownsPerTick', 0))} "
        f"chance={fmt(reproduction.get('chance', 0), 4)} "
        f"resF={fmt(reproduction.get('resourceFactor', 0))} "
        f"crowdF={fmt(reproduction.get('crowdingFactor', 0))} "
        f"moraleF={fmt(reproduction.get('moraleFactor', 0))} "
        f"seasonF={fmt(reproduction.get('seasonFactor', 0))} "
        f"attempts={attempts} succ={successes} rate={fmt(success_rate)} "
        f"blocked[{blocked_str}]] "
        f"stock[min={fmt(stockpile.get('minRatio', 0))} "
        f"avg={fmt(stockpile.get('avgRatio', 0))} {fmt_map(ratios, resources)}] "
        f"merchant[trades/t={fmt(merchant_trades)} "
        f"give[{fmt_map(merchant_given, resources)}] "
        f"recv[{fmt_map(merchant_received, resources)}]] "
        f"housing[houses={int(housing.get('houses', 0) or 0)} "
        f"beds={int(housing.get('beds', 0) or 0)} "
        f"ratio={fmt(housing.get('ratio', 0))} "
        f"unshel={fmt(housing.get('unshelteredFraction', 0))}] "
        f"fields[nodes={int(fields.get('nodes', 0) or 0)} "
        f"ratio={fmt(fields.get('nodeRatio', 0))} "
        f"water={fmt(fields.get('waterRatio', 0))} "
        f"irr={fmt(fields.get('irrigationMultiplier', 0))} "
        f"season={fmt(fields.get('seasonMultiplier', 0))} "
        f"regen={fmt(fields.get('regenMultiplier', 0))}] "
        f"nodes[{fmt_map(nodes, resources)}] "
        f"needs[{fmt_map(needs_avg, sorted(needs_avg.keys()))}] "
        f"crit={fmt(crit)} idle={fmt(idle)}"
    )


def format_debug_file_entry(
    episode,
    window_start,
    window_count,
    avg_reward,
    avg_steps,
    avg_births,
    avg_deaths,
    lr,
    difficulty,
    info,
    debug,
    resources,
    events,
):
    def fmt(value, digits=2):
        try:
            return f"{float(value):.{digits}f}"
        except (TypeError, ValueError):
            return f"{0.0:.{digits}f}"

    def fmt_map_lines(values, keys, indent="  "):
        if not values:
            return [f"{indent}n/a"]
        use_keys = [key for key in keys if key in values]
        if not use_keys:
            use_keys = sorted(values.keys())
        width = max(len(str(key)) for key in use_keys) if use_keys else 0
        lines = []
        for key in use_keys:
            lines.append(f"{indent}{str(key).ljust(width)}: {fmt(values.get(key))}")
        return lines

    raid = debug.get("raid") or {}
    raid_loot = raid.get("loot") or {}
    reproduction = debug.get("reproduction") or {}
    blocked = reproduction.get("blocked") or {}
    stockpile = debug.get("stockpile") or {}
    ratios = stockpile.get("ratios") or {}
    nodes = debug.get("nodes") or {}
    needs_avg = debug.get("needsAvg") or {}
    housing = debug.get("housing") or {}
    fields = debug.get("fields") or {}
    merchant = debug.get("merchant") or {}
    merchant_given = merchant.get("givenPerTick") or {}
    merchant_received = merchant.get("receivedPerTick") or {}
    crit = debug.get("criticalNeedsFraction", 0.0)
    idle = debug.get("idleAdultsFraction", 0.0)
    scenario_counts = debug.get("scenarioCounts") or {}
    weather_counts = debug.get("weatherCounts") or {}

    def fmt_scenario_lines(counts, total, indent="  "):
        if not counts:
            return [f"{indent}n/a"]
        names = sorted(counts.keys())
        width = max(len(str(name)) for name in names) if names else 0
        lines = []
        for name in names:
            count = int(counts.get(name, 0) or 0)
            pct = (count / total * 100.0) if total > 0 else 0.0
            lines.append(f"{indent}{str(name).ljust(width)}: {count} ({pct:.1f}%)")
        return lines

    event_label = ", ".join(events) if events else "n/a"
    lines = [
        f"=== episode={episode} window={window_start}-{episode} count={window_count} ===",
        f"Events: {event_label}",
        "Summary:",
        f"  avg_reward: {fmt(avg_reward)}",
        f"  avg_steps: {fmt(avg_steps, 1)}",
        f"  avg_births: {fmt(avg_births)}",
        f"  avg_deaths: {fmt(avg_deaths)}",
        f"  lr: {fmt(lr, 6)}",
        f"  difficulty: {fmt(difficulty, 2)}",
        f"  tick: {info.get('tick')}",
        f"  pop: {info.get('population')}",
        "Weather mix:",
    ]
    lines.extend(fmt_scenario_lines(weather_counts, window_count, indent="  "))
    lines.extend([
        "Scenario mix:",
    ])
    lines.extend(fmt_scenario_lines(scenario_counts, window_count, indent="  "))
    lines.extend([
        "Stockpile ratios:",
        f"  avg: {fmt(stockpile.get('avgRatio', 0))}",
        f"  min: {fmt(stockpile.get('minRatio', 0))}",
    ])
    lines.extend(fmt_map_lines(ratios, resources, indent="  "))
    lines.append("Nodes ratio:")
    lines.extend(fmt_map_lines(nodes, resources, indent="  "))
    lines.append("Needs avg:")
    lines.extend(fmt_map_lines(needs_avg, sorted(needs_avg.keys()), indent="  "))
    lines.extend([
        "Housing:",
        f"  houses: {int(housing.get('houses', 0) or 0)}",
        f"  beds: {int(housing.get('beds', 0) or 0)}",
        f"  ratio: {fmt(housing.get('ratio', 0))}",
        f"  unsheltered: {fmt(housing.get('unshelteredFraction', 0))}",
        "Raid:",
        f"  count: {fmt(raid.get('count', 0))}",
        f"  deaths: {fmt(raid.get('deaths', 0))}",
        f"  active_ratio: {fmt(raid.get('active', 0))}",
        f"  season_eligible: {fmt(raid.get('seasonEligible', 0))}",
        f"  exposed_ratio: {fmt(raid.get('exposedRatio', 0))}",
        f"  defense_ratio: {fmt(raid.get('defenseRatio', 0))}",
        "  loot:",
    ])
    lines.extend(fmt_map_lines(raid_loot, resources, indent="  "))
    lines.extend([
        "Reproduction:",
        f"  ticks: {int(reproduction.get('ticks', 0) or 0)}",
        f"  couples_per_tick: {fmt(reproduction.get('couplesPerTick', 0))}",
        f"  fertile_per_tick: {fmt(reproduction.get('fertileAdultsPerTick', 0))}",
        f"  pregnancies_per_tick: {fmt(reproduction.get('pregnanciesPerTick', 0))}",
        f"  cooldowns_per_tick: {fmt(reproduction.get('cooldownsPerTick', 0))}",
        f"  chance: {fmt(reproduction.get('chance', 0), 4)}",
        f"  resource_factor: {fmt(reproduction.get('resourceFactor', 0))}",
        f"  crowding_factor: {fmt(reproduction.get('crowdingFactor', 0))}",
        f"  morale_factor: {fmt(reproduction.get('moraleFactor', 0))}",
        f"  season_factor: {fmt(reproduction.get('seasonFactor', 0))}",
        f"  attempts: {int(reproduction.get('attempts', 0) or 0)}",
        f"  successes: {int(reproduction.get('successes', 0) or 0)}",
        "  blocked:",
        f"    infertile: {int(blocked.get('infertile', 0) or 0)}",
        f"    pregnant: {int(blocked.get('pregnant', 0) or 0)}",
        f"    cooldown: {int(blocked.get('cooldown', 0) or 0)}",
        f"    no_resources: {int(blocked.get('noResources', 0) or 0)}",
        f"    no_housing: {int(blocked.get('noHousing', 0) or 0)}",
        f"    chance: {int(blocked.get('chance', 0) or 0)}",
        "Merchant:",
        f"  trades_per_tick: {fmt(merchant.get('tradesPerTick', 0))}",
        "  given_per_tick:",
    ])
    lines.extend(fmt_map_lines(merchant_given, resources, indent="    "))
    lines.extend([
        "  received_per_tick:",
    ])
    lines.extend(fmt_map_lines(merchant_received, resources, indent="    "))
    lines.extend([
        "Fields:",
        f"  nodes: {int(fields.get('nodes', 0) or 0)}",
        f"  node_ratio: {fmt(fields.get('nodeRatio', 0))}",
        f"  water_ratio: {fmt(fields.get('waterRatio', 0))}",
        f"  irrigation: {fmt(fields.get('irrigationMultiplier', 0))}",
        f"  season: {fmt(fields.get('seasonMultiplier', 0))}",
        f"  regen: {fmt(fields.get('regenMultiplier', 0))}",
        "Signals:",
        f"  critical_needs: {fmt(crit)}",
        f"  idle_adults: {fmt(idle)}",
    ])
    return "\n" + "\n".join(lines) + "\n"


def format_summary_line(
    episode,
    window_start,
    window_count,
    avg_reward,
    avg_steps,
    avg_births,
    avg_deaths,
    lr,
    difficulty,
    info,
    debug,
    events,
    scenario_target_mix,
    eps_per_min=None,
):
    def fmt(value, digits=2):
        try:
            return f"{float(value):.{digits}f}"
        except (TypeError, ValueError):
            return f"{0.0:.{digits}f}"

    raid = debug.get("raid") or {}
    raid_loot = raid.get("loot") or {}
    stockpile = debug.get("stockpile") or {}
    weather_counts = debug.get("weatherCounts") or {}
    scenario_counts = debug.get("scenarioCounts") or {}
    signals = debug.get("signals") or {}
    crit = signals.get("criticalAvg", debug.get("criticalNeedsFraction", 0.0))
    idle = signals.get("idleAvg", debug.get("idleAdultsFraction", 0.0))
    pop_balance = signals.get("populationBalanceAvg", None)
    ticks_avg = debug.get("ticksAvg", 0.0)
    reward_per_step = avg_reward / avg_steps if avg_steps > 0 else 0.0
    reward_per_tick = avg_reward / ticks_avg if ticks_avg else 0.0
    shortage_label = format_map_label(debug.get("shortageAvg") or {}, digits=2)
    nodes_label = format_map_label(debug.get("nodes") or {}, digits=2)
    termination_label = format_termination_label(debug.get("terminationCounts") or {}, window_count)
    weather_label = format_mix_label(weather_counts, window_count)
    scenario_label = format_mix_label(scenario_counts, window_count)
    scenario_target_label = format_ratio_label(scenario_target_mix)
    scenario_delta = 0.0
    if window_count > 0 and scenario_counts:
        scenario_mix = {name: count / window_count for name, count in scenario_counts.items()}
        scenario_delta = mix_distance(scenario_target_mix, scenario_mix)
    event_label = ",".join(events) if events else "-"
    raid_loot_label = format_map_label(raid_loot, digits=1)

    rate_label = f" eps_pm={fmt(eps_per_min, 1)}" if eps_per_min is not None else ""

    return (
        f"ep={episode} win={window_start}-{episode} count={window_count} "
        f"avg_reward={fmt(avg_reward)} avg_steps={fmt(avg_steps, 1)} avg_ticks={fmt(ticks_avg, 1)}{rate_label} "
        f"rps={fmt(reward_per_step, 3)} rpt={fmt(reward_per_tick, 3)} "
        f"avg_births={fmt(avg_births)} avg_deaths={fmt(avg_deaths)} "
        f"lr={fmt(lr, 6)} diff={fmt(difficulty, 2)} "
        f"tick={info.get('tick')} pop={info.get('population')} "
        f"stock[min={fmt(stockpile.get('minRatio', 0))} avg={fmt(stockpile.get('avgRatio', 0))}] "
        f"crit={fmt(crit)} idle={fmt(idle)} "
        f"pop_bal={fmt(pop_balance) if pop_balance is not None else fmt(0.0)} "
        f"raid[count={fmt(raid.get('count', 0))} "
        f"deaths={fmt(raid.get('deaths', 0))} "
        f"exp={fmt(raid.get('exposedRatio', 0))} "
        f"def={fmt(raid.get('defenseRatio', 0))} "
        f"loot={raid_loot_label}] "
        f"short={shortage_label} nodes={nodes_label} term={termination_label} "
        f"weather={weather_label} scenario={scenario_label} "
        f"scenario_target={scenario_target_label} scenario_delta={scenario_delta:.2f} "
        f"events={event_label}"
    )


def format_mix_label(counts, total):
    if not counts or total <= 0:
        return "n/a"
    name, count = max(counts.items(), key=lambda item: item[1])
    pct = count / total * 100.0
    return f"{name}:{pct:.0f}%"


def format_map_label(values, digits=2, keys=None):
    if not values:
        return "n/a"

    def fmt(value):
        try:
            return f"{float(value):.{digits}f}"
        except (TypeError, ValueError):
            return f"{0.0:.{digits}f}"

    use_keys = keys if keys else sorted(values.keys())
    parts = [f"{key}={fmt(values.get(key))}" for key in use_keys]
    return " ".join(parts)


def format_termination_label(counts, total):
    if not counts or total <= 0:
        return "n/a"
    items = sorted(counts.items(), key=lambda item: item[1], reverse=True)
    parts = []
    for name, count in items[:3]:
        pct = count / total * 100.0
        parts.append(f"{name}:{pct:.0f}%")
    return " ".join(parts)


def format_ratio_label(ratios):
    if not ratios:
        return "n/a"
    name, value = max(ratios.items(), key=lambda item: item[1])
    try:
        pct = float(value) * 100.0
    except (TypeError, ValueError):
        pct = 0.0
    return f"{name}:{pct:.0f}%"


def mix_distance(prev_mix, next_mix):
    if not prev_mix:
        return 0.0
    keys = set(prev_mix.keys()) | set(next_mix.keys())
    distance = 0.0
    for key in keys:
        distance += abs(prev_mix.get(key, 0.0) - next_mix.get(key, 0.0))
    return 0.5 * distance


def get_project_root():
    return os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def init_debug_run(keep=DEBUG_LOG_KEEP, run_dir=None, summary_name=None):
    if run_dir:
        run_dir = os.path.expanduser(run_dir)
        if not os.path.isabs(run_dir):
            run_dir = os.path.join(get_project_root(), run_dir)
        os.makedirs(run_dir, exist_ok=True)
        summary_name = summary_name or "summary.log"
        summary_path = os.path.join(run_dir, summary_name)
        return run_dir, summary_path

    debug_dir = os.path.join(get_project_root(), DEBUG_LOG_DIRNAME)
    os.makedirs(debug_dir, exist_ok=True)
    timestamp = time.strftime("%Y%m%d_%H%M%S")
    run_dir = os.path.join(debug_dir, f"run_{timestamp}_{os.getpid()}")
    prune_debug_runs(debug_dir, max(0, keep - 1))
    os.makedirs(run_dir, exist_ok=True)
    summary_name = summary_name or "summary.log"
    summary_path = os.path.join(run_dir, summary_name)
    return run_dir, summary_path


def prune_debug_runs(debug_dir, keep):
    try:
        entries = []
        for name in os.listdir(debug_dir):
            path = os.path.join(debug_dir, name)
            if os.path.isdir(path) or os.path.isfile(path):
                try:
                    entries.append((os.path.getmtime(path), path))
                except OSError:
                    continue
        entries.sort(key=lambda item: item[0])
        while len(entries) > keep:
            _, path = entries.pop(0)
            try:
                if os.path.isdir(path):
                    for root, dirs, files in os.walk(path, topdown=False):
                        for filename in files:
                            try:
                                os.remove(os.path.join(root, filename))
                            except OSError:
                                pass
                        for dirname in dirs:
                            try:
                                os.rmdir(os.path.join(root, dirname))
                            except OSError:
                                pass
                    os.rmdir(path)
                else:
                    os.remove(path)
            except OSError:
                pass
    except OSError:
        pass


def write_summary_header(
    handle,
    args,
    resources,
    min_weight,
    max_weight,
    scenario_defs,
    eval_scenarios,
    scenario_sampling,
):
    handle.write("# NodeDwarves training summary log\n")
    handle.write(f"start_time={time.strftime('%Y-%m-%d %H:%M:%S')}\n")
    handle.write(f"config={args.config}\n")
    handle.write(
        "settings "
        f"episodes={args.episodes} max_steps={args.max_steps} step_ticks={args.step_ticks} "
        f"batch_episodes={args.batch_episodes} workers={args.workers} "
        f"gamma={args.gamma} gae_lambda={args.gae_lambda} clip_range={args.clip_range} "
        f"entropy_coef={args.entropy_coef} entropy_coef_final={args.entropy_coef_final} "
        f"entropy_ramp={args.entropy_ramp} value_coef={args.value_coef} "
        f"lr={args.lr} lr_final={args.lr_final} "
        f"difficulty_start={args.difficulty_start} difficulty_end={args.difficulty_end} "
        f"difficulty_ramp={args.difficulty_ramp} min_weight={min_weight} max_weight={max_weight} "
        f"eval_max_steps={args.eval_max_steps} eval_difficulty={args.eval_difficulty} "
        f"eval_score={args.eval_score} sample_score={args.sample_score} "
        f"full_sim={args.full_sim}\n"
    )
    handle.write(f"resources={' '.join(resources)}\n")
    handle.write(f"scenarios={format_scenario_weights(scenario_defs)}\n")
    handle.write(f"scenario_target_mix={format_ratio_map(get_scenario_target_mix(scenario_defs))}\n")
    if scenario_sampling:
        sampling_label = (
            f"{scenario_sampling.get('mode', 'static')}"
            f" update_every={scenario_sampling.get('update_every')}"
            f" ema_alpha={scenario_sampling.get('ema_alpha')}"
            f" boost={scenario_sampling.get('boost')}"
            f" exponent={scenario_sampling.get('exponent')}"
            f" min_ratio={scenario_sampling.get('min_ratio')}"
            f" max_ratio={scenario_sampling.get('max_ratio')}"
        )
        handle.write(f"scenario_sampling={sampling_label}\n")
    handle.write(f"eval_scenarios={' '.join(eval_scenarios) if eval_scenarios else 'n/a'}\n")
    handle.write(f"log_every_console={args.log_every} log_every_summary={SUMMARY_LOG_EVERY}\n")
    if LOG_RATE:
        handle.write("log_rate=enabled\n")
    handle.write("\n# Legend (values are averaged over each summary window)\n")
    handle.write("# ep: end episode of the window.\n")
    handle.write("# win: window start-end episodes.\n")
    handle.write("# count: episodes in the window.\n")
    handle.write("# avg_reward/avg_steps/avg_ticks/avg_births/avg_deaths: mean episode metrics.\n")
    handle.write("# rps/rpt: reward per step / reward per tick.\n")
    if LOG_RATE:
        handle.write("# eps_pm: episodes per minute in the summary window.\n")
    handle.write("# lr: optimizer learning rate at log time.\n")
    handle.write("# diff: curriculum difficulty factor (0..1).\n")
    handle.write("# tick/pop: last tick and population seen in the window.\n")
    handle.write("# stock[min|avg]: min/mean stockpile ratio across resources.\n")
    handle.write("# crit/idle/pop_bal: avg critical needs, idle adults, and population balance.\n")
    handle.write("# raid: avg raid count/deaths/loot/exposure/defense in the window.\n")
    handle.write("# short: average shortage per resource (1 - stockpile ratio).\n")
    handle.write("# term: termination reason mix within the window.\n")
    handle.write("# scenario_target_mix: target distribution based on base weights.\n")
    handle.write("# weather/scenario: top label and share in the window.\n")
    handle.write("# scenario_delta: L1/2 distance between target mix and window mix.\n")
    handle.write("# events: notable triggers (best_eval, eval_regression, scenario_shift).\n")


def write_detail_header(
    handle,
    args,
    resources,
    min_weight,
    max_weight,
    scenario_defs,
    eval_scenarios,
    scenario_sampling,
):
    handle.write("# NodeDwarves training detail log\n")
    handle.write(f"start_time={time.strftime('%Y-%m-%d %H:%M:%S')}\n")
    handle.write(f"config={args.config}\n")
    handle.write(
        "settings "
        f"episodes={args.episodes} max_steps={args.max_steps} step_ticks={args.step_ticks} "
        f"batch_episodes={args.batch_episodes} workers={args.workers} "
        f"gamma={args.gamma} gae_lambda={args.gae_lambda} clip_range={args.clip_range} "
        f"entropy_coef={args.entropy_coef} entropy_coef_final={args.entropy_coef_final} "
        f"entropy_ramp={args.entropy_ramp} value_coef={args.value_coef} "
        f"lr={args.lr} lr_final={args.lr_final} "
        f"difficulty_start={args.difficulty_start} difficulty_end={args.difficulty_end} "
        f"difficulty_ramp={args.difficulty_ramp} min_weight={min_weight} max_weight={max_weight}\n"
    )
    handle.write(f"resources={' '.join(resources)}\n")
    handle.write(f"scenarios={format_scenario_weights(scenario_defs)}\n")
    handle.write(f"scenario_target_mix={format_ratio_map(get_scenario_target_mix(scenario_defs))}\n")
    if scenario_sampling:
        sampling_label = (
            f"{scenario_sampling.get('mode', 'static')}"
            f" update_every={scenario_sampling.get('update_every')}"
            f" ema_alpha={scenario_sampling.get('ema_alpha')}"
            f" boost={scenario_sampling.get('boost')}"
            f" exponent={scenario_sampling.get('exponent')}"
            f" min_ratio={scenario_sampling.get('min_ratio')}"
            f" max_ratio={scenario_sampling.get('max_ratio')}"
        )
        handle.write(f"scenario_sampling={sampling_label}\n")
    handle.write(f"eval_scenarios={' '.join(eval_scenarios) if eval_scenarios else 'n/a'}\n")
    handle.write("\n# Legend (all values are averaged over each detail window)\n")
    handle.write("# Summary.avg_reward: mean episode reward in the window.\n")
    handle.write("# Summary.avg_steps: mean episode steps in the window.\n")
    handle.write("# Summary.avg_births: mean births per episode in the window.\n")
    handle.write("# Summary.avg_deaths: mean deaths per episode in the window.\n")
    handle.write("# Summary.lr: optimizer learning rate at log time.\n")
    handle.write("# Summary.difficulty: curriculum difficulty factor (0..1).\n")
    handle.write("# Summary.tick: last tick observed in the window.\n")
    handle.write("# Summary.pop: population at the last tick in the window.\n")
    handle.write("# Weather mix.<name>: weather counts and share within the window.\n")
    handle.write("# Scenario mix.<name>: scenario counts and share within the window.\n")
    handle.write("# Stockpile.avg: mean of stockpile ratios across resources.\n")
    handle.write("# Stockpile.min: minimum stockpile ratio across resources.\n")
    handle.write("# Stockpile.<resource>: current/target ratio per resource.\n")
    handle.write("# Nodes.<resource>: remaining/total capacity ratio per resource node.\n")
    handle.write("# Needs.<need>: average need value (0..1).\n")
    handle.write("# Housing.houses: total houses.\n")
    handle.write("# Housing.beds: total bed capacity.\n")
    handle.write("# Housing.ratio: beds/population ratio.\n")
    handle.write("# Housing.unsheltered: fraction of population without beds.\n")
    handle.write("# Raid.count: average raids per episode in the window.\n")
    handle.write("# Raid.deaths: average raid deaths per episode in the window.\n")
    handle.write("# Raid.active_ratio: fraction of ticks with an active raid.\n")
    handle.write("# Raid.season_eligible: fraction of ticks in raid-eligible seasons.\n")
    handle.write("# Raid.exposed_ratio: average exposed population ratio.\n")
    handle.write("# Raid.defense_ratio: average defense ratio (adults + watchtowers).\n")
    handle.write("# Raid.loot.<resource>: average loot per episode in the window.\n")
    handle.write("# Reproduction.ticks: ticks accumulated in the window.\n")
    handle.write("# Reproduction.couples_per_tick: average couples per tick.\n")
    handle.write("# Reproduction.fertile_per_tick: average fertile adults per tick.\n")
    handle.write("# Reproduction.pregnancies_per_tick: average pregnancies per tick.\n")
    handle.write("# Reproduction.cooldowns_per_tick: average cooldowns per tick.\n")
    handle.write("# Reproduction.chance: average conception chance per tick.\n")
    handle.write("# Reproduction.resource_factor: average resource factor for conception.\n")
    handle.write("# Reproduction.crowding_factor: average crowding factor for conception.\n")
    handle.write("# Reproduction.morale_factor: average morale factor for conception.\n")
    handle.write("# Reproduction.season_factor: average season factor for conception.\n")
    handle.write("# Reproduction.attempts: average attempts per episode.\n")
    handle.write("# Reproduction.successes: average successes per episode.\n")
    handle.write("# Reproduction.blocked.<reason>: average blocked counts per episode.\n")
    handle.write("# Merchant.trades_per_tick: average trades per tick.\n")
    handle.write("# Merchant.given_per_tick.<resource>: average units given per tick.\n")
    handle.write("# Merchant.received_per_tick.<resource>: average units received per tick.\n")
    handle.write("# Fields.nodes: count of field nodes.\n")
    handle.write("# Fields.node_ratio: remaining/total capacity ratio for field nodes.\n")
    handle.write("# Fields.water_ratio: water stockpile ratio used for irrigation.\n")
    handle.write("# Fields.irrigation: irrigation multiplier.\n")
    handle.write("# Fields.season: seasonal multiplier applied to field regen.\n")
    handle.write("# Fields.regen: irrigation * season multiplier.\n")
    handle.write("# Signals.critical_needs: fraction of dwarves at critical needs.\n")
    handle.write("# Signals.idle_adults: fraction of idle adults.\n")


def init_debug_accumulator():
    return {
        "count": 0,
        "deaths": {},
        "raids": {},
        "raid_loot": {},
        "reproduction": {},
        "reproduction_blocked": {},
        "stockpile": {},
        "stockpile_ratios": {},
        "housing": {},
        "fields": {},
        "merchant": {},
        "merchant_given": {},
        "merchant_received": {},
        "nodes": {},
        "needsAvg": {},
        "scenarios": {},
        "weather": {},
        "criticalNeedsFraction": 0.0,
        "idleAdultsFraction": 0.0,
        "termination": {},
        "shortage": {},
        "signals": {},
        "ticks": 0.0,
    }


def add_numeric(target, key, value):
    try:
        target[key] = target.get(key, 0.0) + float(value)
    except (TypeError, ValueError):
        return


def add_map(target, values):
    if not isinstance(values, dict):
        return
    for key, value in values.items():
        try:
            target[key] = target.get(key, 0.0) + float(value)
        except (TypeError, ValueError):
            continue


def accumulate_debug(accumulator, info):
    if not isinstance(info, dict):
        return
    debug = info.get("debug") or {}
    if not debug:
        return
    accumulator["count"] += 1
    done_reason = info.get("doneReason")
    if done_reason:
        accumulator["termination"][done_reason] = accumulator["termination"].get(done_reason, 0) + 1
    episode_metrics = info.get("episodeMetrics") or {}
    add_numeric(accumulator, "ticks", episode_metrics.get("ticks"))
    add_map(accumulator["shortage"], episode_metrics.get("shortageAvg") or {})
    add_numeric(accumulator["signals"], "criticalAvg", episode_metrics.get("criticalAvg"))
    add_numeric(accumulator["signals"], "idleAvg", episode_metrics.get("idleAvg"))
    add_numeric(accumulator["signals"], "populationBalanceAvg", episode_metrics.get("populationBalanceAvg"))
    scenario_meta = info.get("scenario")
    scenario_name = None
    if isinstance(scenario_meta, dict):
        scenario_name = scenario_meta.get("name") or scenario_meta.get("scenario")
    elif isinstance(scenario_meta, str):
        scenario_name = scenario_meta
    if scenario_name:
        accumulator["scenarios"][scenario_name] = accumulator["scenarios"].get(scenario_name, 0) + 1
    weather = debug.get("weather") or {}
    weather_type = None
    if isinstance(weather, dict):
        weather_type = weather.get("type")
    if weather_type:
        accumulator["weather"][weather_type] = accumulator["weather"].get(weather_type, 0) + 1

    deaths = debug.get("deaths") or {}
    add_numeric(accumulator["deaths"], "starvation", deaths.get("starvation"))
    add_numeric(accumulator["deaths"], "oldAge", deaths.get("oldAge"))
    add_numeric(accumulator["deaths"], "raid", deaths.get("raid"))

    raid = debug.get("raid") or {}
    add_numeric(accumulator["raids"], "count", raid.get("count"))
    add_numeric(accumulator["raids"], "deaths", raid.get("deaths"))
    add_numeric(accumulator["raids"], "exposedRatio", raid.get("exposedRatio"))
    add_numeric(accumulator["raids"], "defenseRatio", raid.get("defenseRatio"))
    add_numeric(accumulator["raids"], "seasonEligible", raid.get("seasonEligible"))
    add_numeric(accumulator["raids"], "active", 1.0 if raid.get("active") else 0.0)
    add_map(accumulator["raid_loot"], raid.get("loot") or {})

    reproduction = debug.get("reproduction") or {}
    for key in (
        "ticks",
        "couplesPerTick",
        "fertileAdultsPerTick",
        "pregnanciesPerTick",
        "cooldownsPerTick",
        "chance",
        "resourceFactor",
        "crowdingFactor",
        "moraleFactor",
        "seasonFactor",
        "attempts",
        "successes",
    ):
        add_numeric(accumulator["reproduction"], key, reproduction.get(key))
    blocked = reproduction.get("blocked") or {}
    for key in ("infertile", "pregnant", "cooldown", "noResources", "noHousing", "chance"):
        add_numeric(accumulator["reproduction_blocked"], key, blocked.get(key))

    stockpile = debug.get("stockpile") or {}
    add_numeric(accumulator["stockpile"], "avgRatio", stockpile.get("avgRatio"))
    add_numeric(accumulator["stockpile"], "minRatio", stockpile.get("minRatio"))
    add_map(accumulator["stockpile_ratios"], stockpile.get("ratios") or {})

    housing = debug.get("housing") or {}
    for key in ("houses", "beds", "ratio", "unshelteredFraction"):
        add_numeric(accumulator["housing"], key, housing.get(key))

    fields = debug.get("fields") or {}
    for key in (
        "nodes",
        "nodeRatio",
        "waterRatio",
        "irrigationMultiplier",
        "seasonMultiplier",
        "regenMultiplier",
    ):
        add_numeric(accumulator["fields"], key, fields.get(key))

    merchant = debug.get("merchant") or {}
    add_numeric(accumulator["merchant"], "tradesPerTick", merchant.get("tradesPerTick"))
    add_map(accumulator["merchant_given"], merchant.get("givenPerTick") or {})
    add_map(accumulator["merchant_received"], merchant.get("receivedPerTick") or {})

    add_map(accumulator["nodes"], debug.get("nodes") or {})
    add_map(accumulator["needsAvg"], debug.get("needsAvg") or {})
    add_numeric(accumulator, "criticalNeedsFraction", debug.get("criticalNeedsFraction"))
    add_numeric(accumulator, "idleAdultsFraction", debug.get("idleAdultsFraction"))


def extract_scenario_name(info):
    if not isinstance(info, dict):
        return None
    scenario_meta = info.get("scenario")
    if isinstance(scenario_meta, dict):
        return scenario_meta.get("name") or scenario_meta.get("scenario")
    if isinstance(scenario_meta, str):
        return scenario_meta
    return None


def average_debug(accumulator):
    count = int(accumulator.get("count") or 0)
    if count <= 0:
        return None

    def avg_map(values):
        return {key: value / count for key, value in values.items()}

    reproduction = avg_map(accumulator["reproduction"])
    reproduction["blocked"] = avg_map(accumulator["reproduction_blocked"])
    signals = accumulator.get("signals") or {}

    return {
        "deaths": avg_map(accumulator["deaths"]),
        "raid": {
            "count": accumulator["raids"].get("count", 0.0) / count,
            "deaths": accumulator["raids"].get("deaths", 0.0) / count,
            "loot": avg_map(accumulator["raid_loot"]),
            "exposedRatio": accumulator["raids"].get("exposedRatio", 0.0) / count,
            "defenseRatio": accumulator["raids"].get("defenseRatio", 0.0) / count,
            "seasonEligible": accumulator["raids"].get("seasonEligible", 0.0) / count,
            "active": accumulator["raids"].get("active", 0.0) / count,
        },
        "reproduction": reproduction,
        "stockpile": {
            "avgRatio": accumulator["stockpile"].get("avgRatio", 0.0) / count,
            "minRatio": accumulator["stockpile"].get("minRatio", 0.0) / count,
            "ratios": avg_map(accumulator["stockpile_ratios"]),
        },
        "housing": avg_map(accumulator["housing"]),
        "fields": avg_map(accumulator["fields"]),
        "merchant": {
            "tradesPerTick": accumulator["merchant"].get("tradesPerTick", 0.0) / count,
            "givenPerTick": avg_map(accumulator["merchant_given"]),
            "receivedPerTick": avg_map(accumulator["merchant_received"]),
        },
        "nodes": avg_map(accumulator["nodes"]),
        "needsAvg": avg_map(accumulator["needsAvg"]),
        "scenarioCounts": dict(accumulator["scenarios"]),
        "weatherCounts": dict(accumulator["weather"]),
        "criticalNeedsFraction": accumulator.get("criticalNeedsFraction", 0.0) / count,
        "idleAdultsFraction": accumulator.get("idleAdultsFraction", 0.0) / count,
        "terminationCounts": dict(accumulator.get("termination") or {}),
        "shortageAvg": avg_map(accumulator.get("shortage") or {}),
        "signals": {
            "criticalAvg": signals.get("criticalAvg", 0.0) / count,
            "idleAvg": signals.get("idleAvg", 0.0) / count,
            "populationBalanceAvg": signals.get("populationBalanceAvg", 0.0) / count,
        },
        "ticksAvg": accumulator.get("ticks", 0.0) / count,
    }


def extract_resources(obs):
    targets = obs.get("targets", {}) or {}
    if targets:
        return sorted(targets.keys())
    ratios = obs.get("stockpileRatio", {}) or {}
    return sorted(ratios.keys())


def get_resources_from_config(config):
    if not isinstance(config, dict):
        return []
    resources = config.get("resources", {}) or {}
    targets = resources.get("targets", {}) or {}
    if targets:
        return sorted(targets.keys())
    stockpile = resources.get("stockpile", {}) or {}
    if stockpile:
        return sorted(stockpile.keys())
    return []


def append_festival_action(resources, config):
    festivals = (config or {}).get("festivals") or {}
    if festivals.get("enabled", True) is False:
        return resources
    ai = festivals.get("ai") or {}
    if ai.get("enabled", True) is False:
        return resources
    if FESTIVAL_ACTION_ID in resources:
        return resources
    return list(resources) + [FESTIVAL_ACTION_ID]


def append_governor_actions(resources, config):
    merged = list(resources)
    ai_config = (config or {}).get("ai") or {}
    governors = ai_config.get("governors") or {}

    trade = governors.get("trade") or {}
    if trade.get("enabled", True) is not False:
        for action_id in (
            TRADE_RESERVE_BIAS_ACTION_ID,
            TRADE_CONTEST_INTENT_ACTION_ID,
            TRADE_OPPORTUNITY_INTENT_ACTION_ID,
        ):
            if action_id not in merged:
                merged.append(action_id)

    building = governors.get("building") or {}
    if building.get("enabled", True) is not False:
        for action_id in (
            BUILDING_HOUSING_WEIGHT_ACTION_ID,
            BUILDING_ECONOMY_WEIGHT_ACTION_ID,
            BUILDING_DEFENSE_WEIGHT_ACTION_ID,
            BUILDING_SPECIAL_WEIGHT_ACTION_ID,
            BUILDING_MINE_BIAS_ACTION_ID,
            BUILDING_UPGRADE_BIAS_ACTION_ID,
        ):
            if action_id not in merged:
                merged.append(action_id)

    return merged


def is_policy_resource_id(resource):
    return resource != FESTIVAL_ACTION_ID and resource not in GOVERNOR_ACTION_ID_SET


def split_action_payload(action, resources):
    weights = {}
    festival_intent = None
    trade = {}
    building = {}
    for idx, resource in enumerate(resources):
        raw = action[idx] if idx < len(action) else 0.0
        try:
            value = float(raw)
        except (TypeError, ValueError):
            value = 0.0
        if resource == FESTIVAL_ACTION_ID:
            festival_intent = value
        elif resource == TRADE_RESERVE_BIAS_ACTION_ID:
            trade["reserveRatioBias"] = value
        elif resource == TRADE_CONTEST_INTENT_ACTION_ID:
            trade["contestIntent"] = value
        elif resource == TRADE_OPPORTUNITY_INTENT_ACTION_ID:
            trade["opportunityIntent"] = value
        elif resource == BUILDING_HOUSING_WEIGHT_ACTION_ID:
            building["housingWeight"] = value
        elif resource == BUILDING_ECONOMY_WEIGHT_ACTION_ID:
            building["economyWeight"] = value
        elif resource == BUILDING_DEFENSE_WEIGHT_ACTION_ID:
            building["defenseWeight"] = value
        elif resource == BUILDING_SPECIAL_WEIGHT_ACTION_ID:
            building["specialWeight"] = value
        elif resource == BUILDING_MINE_BIAS_ACTION_ID:
            building["mineBias"] = value
        elif resource == BUILDING_UPGRADE_BIAS_ACTION_ID:
            building["upgradeBias"] = value
        else:
            weights[resource] = value
    return weights, festival_intent, trade, building


def get_scenario_definitions(config):
    if not isinstance(config, dict):
        return []
    training = (config.get("ai") or {}).get("training") or {}
    scenarios = training.get("scenarios") or []
    definitions = []
    if not isinstance(scenarios, list):
        return definitions
    for entry in scenarios:
        if not isinstance(entry, dict):
            continue
        name = entry.get("name")
        if not name:
            continue
        try:
            weight = float(entry.get("weight", 1.0))
        except (TypeError, ValueError):
            weight = 0.0
        definitions.append({
            "name": str(name),
            "weight": weight,
            "base_weight": weight,
            "difficulty_min": to_float(entry.get("difficultyMin"), None),
            "difficulty_max": to_float(entry.get("difficultyMax"), None),
            "difficulty_min_multiplier": to_float(entry.get("difficultyMinMultiplier"), 0.0),
            "difficulty_max_multiplier": to_float(entry.get("difficultyMaxMultiplier"), 1.0),
        })
    return definitions


def get_training_scenarios(scenario_defs):
    return [entry for entry in scenario_defs if entry.get("weight", 0.0) > 0.0]


def get_eval_scenarios(config, scenario_defs):
    if not isinstance(config, dict):
        return []
    training = (config.get("ai") or {}).get("training") or {}
    eval_names = training.get("evalScenarios") or []
    if not eval_names:
        return []
    names = [str(name) for name in eval_names if name]
    if not scenario_defs:
        return names
    scenario_names = {entry.get("name") for entry in scenario_defs}
    return [name for name in names if name in scenario_names]


def scenario_weight_for_difficulty(entry, difficulty):
    try:
        weight = float(entry.get("weight", 0.0))
    except (TypeError, ValueError):
        weight = 0.0
    weight = max(0.0, weight)
    if difficulty is None:
        return weight
    dmin = entry.get("difficulty_min")
    dmax = entry.get("difficulty_max")
    if dmin is None or dmax is None:
        return weight
    if dmax <= dmin:
        return weight
    t = clamp((float(difficulty) - dmin) / (dmax - dmin), 0.0, 1.0)
    min_mult = entry.get("difficulty_min_multiplier", 0.0)
    max_mult = entry.get("difficulty_max_multiplier", 1.0)
    try:
        min_mult = float(min_mult)
        max_mult = float(max_mult)
    except (TypeError, ValueError):
        min_mult = 0.0
        max_mult = 1.0
    multiplier = min_mult + (max_mult - min_mult) * t
    return weight * max(0.0, multiplier)


def select_scenario(scenarios, rng, difficulty=None):
    if not scenarios:
        return None
    weights = [scenario_weight_for_difficulty(entry, difficulty) for entry in scenarios]
    total_weight = sum(weights)
    if total_weight <= 0:
        return None
    pick = rng.random() * total_weight
    cumulative = 0.0
    for entry, weight in zip(scenarios, weights):
        cumulative += weight
        if pick <= cumulative:
            return entry.get("name")
    return scenarios[-1].get("name")


def format_scenario_weights(scenario_defs):
    if not scenario_defs:
        return "n/a"
    parts = []
    for entry in scenario_defs:
        name = entry.get("name")
        weight = entry.get("weight")
        if name is None:
            continue
        parts.append(f"{name}:{weight:.2f}")
    return " ".join(parts) if parts else "n/a"


def get_scenario_target_mix(scenario_defs):
    if not scenario_defs:
        return {}
    weights = {}
    total = 0.0
    for entry in scenario_defs:
        name = entry.get("name")
        if not name:
            continue
        base = entry.get("base_weight", entry.get("weight", 0.0))
        try:
            weight = float(base)
        except (TypeError, ValueError):
            weight = 0.0
        if weight <= 0:
            continue
        weights[name] = weight
        total += weight
    if total <= 0:
        return {}
    return {name: weight / total for name, weight in weights.items()}


def format_ratio_map(ratios):
    if not ratios:
        return "n/a"
    parts = []
    for name in sorted(ratios.keys()):
        try:
            pct = float(ratios[name]) * 100.0
        except (TypeError, ValueError):
            pct = 0.0
        parts.append(f"{name}:{pct:.0f}%")
    return " ".join(parts) if parts else "n/a"


def get_scenario_sampling(config):
    training = (config.get("ai") or {}).get("training") or {}
    sampling = training.get("scenarioSampling") or {}
    mode = str(sampling.get("mode") or "static").lower()
    return {
        "mode": mode,
        "update_every": max(1, to_int(sampling.get("updateEvery"), DEBUG_LOG_EVERY)),
        "ema_alpha": clamp(to_float(sampling.get("emaAlpha"), 0.2), 0.0, 1.0),
        "boost": max(0.0, to_float(sampling.get("boost"), 1.0)),
        "exponent": max(0.1, to_float(sampling.get("exponent"), 1.0)),
        "min_ratio": max(0.0, to_float(sampling.get("minWeightRatio"), 0.4)),
        "max_ratio": max(0.0, to_float(sampling.get("maxWeightRatio"), 2.5)),
    }


def init_scenario_sampler(config, scenario_defs):
    sampling = get_scenario_sampling(config)
    if sampling["mode"] != "adaptive" or not scenario_defs:
        return None
    base_weights = {}
    for entry in scenario_defs:
        name = entry.get("name")
        if not name:
            continue
        base = entry.get("base_weight", entry.get("weight", 0.0))
        base_weights[name] = float(base)
    return {
        "mode": sampling["mode"],
        "update_every": sampling["update_every"],
        "ema_alpha": sampling["ema_alpha"],
        "boost": sampling["boost"],
        "exponent": sampling["exponent"],
        "min_ratio": sampling["min_ratio"],
        "max_ratio": sampling["max_ratio"],
        "base_weights": base_weights,
        "ema": {},
        "counts": {},
        "last_update": 0,
    }


def record_scenario_reward(sampler, scenario_name, reward):
    if not sampler or not scenario_name:
        return
    if scenario_name not in sampler["base_weights"]:
        return
    prev = sampler["ema"].get(scenario_name)
    alpha = sampler["ema_alpha"]
    if prev is None:
        sampler["ema"][scenario_name] = float(reward)
    else:
        sampler["ema"][scenario_name] = (1 - alpha) * prev + alpha * float(reward)
    sampler["counts"][scenario_name] = sampler["counts"].get(scenario_name, 0) + 1


def update_scenario_weights(sampler, scenario_defs):
    if not sampler:
        return False
    ema = sampler["ema"]
    if len(ema) < 2:
        return False
    values = list(ema.values())
    min_value = min(values)
    max_value = max(values)
    span = max(1e-6, max_value - min_value)
    updated = False

    for entry in scenario_defs:
        name = entry.get("name")
        if not name or name not in ema:
            continue
        base = sampler["base_weights"].get(name, entry.get("weight", 0.0))
        if base <= 0:
            continue
        hardness = (max_value - ema[name]) / span
        scale = 1.0 + sampler["boost"] * (hardness ** sampler["exponent"])
        min_weight = base * sampler["min_ratio"]
        max_weight = base * sampler["max_ratio"]
        new_weight = clamp(base * scale, min_weight, max_weight)
        if abs(float(entry.get("weight", 0.0)) - new_weight) > 1e-6:
            entry["weight"] = new_weight
            updated = True
    return updated


def get_model_payload(model):
    return {
        "policy": model.policy.export_layers(),
        "value": model.value.export_layers(),
        "logStd": model.log_std.detach().cpu().tolist(),
    }


def load_model_payload(model, payload):
    if not payload:
        return
    policy_layers = payload.get("policy") or []
    value_layers = payload.get("value") or []
    if policy_layers:
        model.policy.load_layers(policy_layers)
    if value_layers:
        model.value.load_layers(value_layers)
    log_std = payload.get("logStd")
    if isinstance(log_std, list) and len(log_std) == model.log_std.shape[0]:
        model.log_std.data.copy_(torch.tensor(log_std, dtype=torch.float32, device=model.log_std.device))


def queue_get_nowait(queue_obj):
    if hasattr(queue_obj, "get_nowait"):
        return queue_obj.get_nowait()
    reader = getattr(queue_obj, "_reader", None)
    if reader and hasattr(reader, "poll"):
        if not reader.poll(0):
            raise queue.Empty
        return queue_obj.get()
    raise queue.Empty


def queue_put_nowait(queue_obj, payload):
    if hasattr(queue_obj, "put_nowait"):
        return queue_obj.put_nowait(payload)
    return queue_obj.put(payload)


def drain_queue(queue_obj):
    latest = None
    try:
        while True:
            latest = queue_get_nowait(queue_obj)
    except queue.Empty:
        pass
    return latest


def broadcast_weights(queues, payload, processes=None):
    for idx, queue_obj in enumerate(queues):
        if processes and idx < len(processes):
            try:
                if not processes[idx].is_alive():
                    continue
            except Exception:
                pass
        try:
            while True:
                queue_get_nowait(queue_obj)
        except queue.Empty:
            pass
        try:
            queue_put_nowait(queue_obj, payload)
        except (BrokenPipeError, EOFError, OSError, queue.Full):
            pass


def worker_loop(worker_id, task_queue, result_queue, update_queue, resources, settings):
    try:
        devnull = open(os.devnull, "w")
        sys.stdout = devnull
        sys.stderr = devnull
    except OSError:
        pass
    torch.set_num_threads(1)
    env = os.environ.copy()
    debug_mode = settings.get("debug_mode")
    if debug_mode:
        env["NODEDWARVES_DEBUG_MODE"] = str(debug_mode)
    proc = subprocess.Popen(
        ["node", "ai_server.js"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        text=True,
        bufsize=1,
        env=env,
    )

    try:
        try:
            feature_names = settings.get("feature_names") or DEFAULT_FEATURE_NAMES
            input_size = len(resources) * len(feature_names)
            action_size = len(resources)
            model = ActorCritic(
                input_size,
                action_size,
                settings["hidden_sizes"],
                settings["activation"],
                settings["log_std_init"],
            )

            latest_payload = drain_queue(update_queue)
            if latest_payload:
                load_model_payload(model, latest_payload)

            while True:
                try:
                    task = task_queue.get()
                except (EOFError, OSError):
                    break
                if task is None:
                    break

                latest_payload = drain_queue(update_queue)
                if latest_payload:
                    load_model_payload(model, latest_payload)

                episode_number, seed, difficulty, scenario = task
                try:
                    transitions, reward, steps, info, bootstrap_value = run_episode(
                        proc,
                        model,
                        resources,
                        feature_names,
                        settings["max_steps"],
                        settings["step_ticks"],
                        seed,
                        difficulty,
                        settings["min_weight"],
                        settings["max_weight"],
                        scenario,
                        settings.get("full_sim", False),
                    )
                except (BrokenPipeError, EOFError, OSError, RuntimeError):
                    break
                try:
                    result_queue.put((episode_number, transitions, reward, steps, info, bootstrap_value))
                except (BrokenPipeError, EOFError, OSError):
                    break
        except (BrokenPipeError, EOFError, OSError, RuntimeError):
            pass
    finally:
        try:
            send(proc, {"cmd": "close"})
        except Exception:
            pass
        proc.terminate()

def season_features(season):
    if not season:
        return 0.0, 0.0
    index = float(season.get("index", 0))
    season_index = clamp(index / 3.0, 0.0, 1.0)
    tick = float(season.get("tickInSeason", 0))
    duration = max(1.0, float(season.get("duration", 1)))
    season_progress = clamp(tick / duration, 0.0, 1.0)
    return season_index, season_progress


def build_features(obs, resource, feature_names):
    ratios = obs.get("stockpileRatio", {}) or {}
    node_ratios = obs.get("nodes", {}) or {}
    ratio = float(ratios.get(resource, 1.0))
    node_ratio = float(node_ratios.get(resource, 1.0))
    shortage = clamp(1.0 - ratio, 0.0, 1.0)
    node_scarcity = clamp(1.0 - node_ratio, 0.0, 1.0)
    critical = clamp(float(obs.get("criticalNeedsFraction", 0.0)), 0.0, 1.0)
    idle = clamp(float(obs.get("idleAdultsFraction", 0.0)), 0.0, 1.0)
    population_balance = clamp(float(obs.get("populationBalance", 0.0)), 0.0, 1.0)
    season_index, season_progress = season_features(obs.get("season"))
    weather = obs.get("weather") or {}
    weather_severity = clamp(float(weather.get("severity", 0.0)), 0.0, 1.0)
    weather_time_left = clamp(float(weather.get("timeLeft", 0.0)), 0.0, 1.0)
    raid = obs.get("raid") or {}
    raid_active = 1.0 if raid.get("active") else 0.0
    raid_time_left = clamp(float(raid.get("timeLeftRatio", 0.0)), 0.0, 1.0)
    raid_exposed = clamp(float(raid.get("exposedRatio", 0.0)), 0.0, 1.0)
    raid_defense = clamp(float(raid.get("defenseRatio", 0.0)), 0.0, 1.0)
    season_eligible = clamp(float(raid.get("seasonEligible", 0.0)), 0.0, 1.0)
    housing_ratio = float(obs.get("housingRatio", 0.0))
    housing_shortage = clamp(1.0 - housing_ratio, 0.0, 1.0)
    festival = obs.get("festival") or {}
    festival_active = 1.0 if festival.get("active") else 0.0
    festival_time_left = clamp(float(festival.get("timeLeft", 0.0)), 0.0, 1.0)
    festival_eligible = clamp(float(festival.get("eligible", 0.0)), 0.0, 1.0)
    festival_cost_ratio = clamp(float(festival.get("costRatio", 0.0)), 0.0, 1.0)
    ruins = obs.get("ruins") or {}
    ruins_active = 1.0 if ruins.get("active") else 0.0
    ruins_cooldown = clamp(float(ruins.get("cooldownRatio", 0.0)), 0.0, 1.0)
    ruins_progress = clamp(float(ruins.get("progress", 0.0)), 0.0, 1.0)
    ruins_artifacts = clamp(float(ruins.get("artifacts", 0.0)), 0.0, 1.0)
    myths = obs.get("myths") or {}
    myths_active_ratio = clamp(float(myths.get("activeRatio", 0.0)), 0.0, 1.0)
    myths_severity = clamp(float(myths.get("severity", 0.0)), 0.0, 1.0)
    myth_flags = myths.get("flags") or {}
    clan_shares = obs.get("clanShares") or {}

    feature_map = {
        "shortage": shortage,
        "nodeScarcity": node_scarcity,
        "criticalNeeds": critical,
        "idleAdults": idle,
        "populationBalance": population_balance,
        "seasonIndex": season_index,
        "seasonProgress": season_progress,
        "weatherSeverity": weather_severity,
        "weatherTimeLeft": weather_time_left,
        "raidActive": raid_active,
        "raidTimeLeft": raid_time_left,
        "raidExposed": raid_exposed,
        "raidDefense": raid_defense,
        "housingShortage": housing_shortage,
        "seasonEligible": season_eligible,
        "festivalActive": festival_active,
        "festivalTimeLeft": festival_time_left,
        "festivalEligible": festival_eligible,
        "festivalCostRatio": festival_cost_ratio,
        "ruinsActive": ruins_active,
        "ruinsCooldown": ruins_cooldown,
        "ruinsProgress": ruins_progress,
        "ruinsArtifacts": ruins_artifacts,
        "mythsActiveRatio": myths_active_ratio,
        "mythsSeverity": myths_severity,
    }
    values = []
    for name in feature_names:
        if name in feature_map:
            values.append(float(feature_map[name]))
        elif name.startswith("mythFlag_"):
            myth_id = name[len("mythFlag_"):]
            values.append(clamp(float(myth_flags.get(myth_id, 0.0)), 0.0, 1.0))
        elif name.startswith("clanShare_"):
            clan_id = name[len("clanShare_"):]
            values.append(clamp(float(clan_shares.get(clan_id, 0.0)), 0.0, 1.0))
        else:
            values.append(0.0)
    return values


def build_obs_vector(obs, resources, feature_names):
    vector = []
    for resource in resources:
        vector.extend(build_features(obs, resource, feature_names))
    return vector


def atanh(value):
    return 0.5 * torch.log((1 + value) / (1 - value))


def scale_action(action, min_weight, max_weight):
    scale = max_weight - min_weight
    if scale <= 0:
        return torch.full_like(action, min_weight)
    return min_weight + (action + 1) * 0.5 * scale


def unscale_action(action, min_weight, max_weight):
    scale = max_weight - min_weight
    if scale <= 0:
        return torch.zeros_like(action)
    return (action - min_weight) * 2.0 / scale - 1.0


def compute_log_prob(mean, log_std, actions, min_weight, max_weight):
    std = log_std.exp()
    scaled = unscale_action(actions, min_weight, max_weight)
    scaled = torch.clamp(scaled, -0.999, 0.999)
    pre_tanh = atanh(scaled)
    dist = Normal(mean, std)
    log_prob = dist.log_prob(pre_tanh) - torch.log(1 - scaled.pow(2) + 1e-6)
    return log_prob.sum(-1)


def compute_entropy(log_std, mean):
    std = log_std.exp()
    std = std.expand_as(mean)
    dist = Normal(torch.zeros_like(mean), std)
    return dist.entropy().sum(-1)


class Mlp(nn.Module):
    def __init__(self, input_size, hidden_sizes, output_size, activation):
        super().__init__()
        activation = (activation or "tanh").lower()
        layers = []
        last_size = input_size
        for size in hidden_sizes:
            layers.append(nn.Linear(last_size, size))
            if activation == "tanh":
                layers.append(nn.Tanh())
            elif activation == "relu":
                layers.append(nn.ReLU())
            else:
                layers.append(nn.Tanh())
            last_size = size
        layers.append(nn.Linear(last_size, output_size))
        self.model = nn.Sequential(*layers)
        self.hidden_sizes = list(hidden_sizes)
        self.activation = activation

    def forward(self, inputs):
        return self.model(inputs)

    def export_layers(self):
        layers = []
        for module in self.model:
            if isinstance(module, nn.Linear):
                layers.append({
                    "weights": module.weight.detach().cpu().tolist(),
                    "biases": module.bias.detach().cpu().tolist(),
                })
        return layers

    def load_layers(self, layers):
        linear_layers = [m for m in self.model if isinstance(m, nn.Linear)]
        for module, payload in zip(linear_layers, layers):
            device = module.weight.device
            weights = torch.tensor(payload["weights"], dtype=torch.float32, device=device)
            biases = torch.tensor(payload["biases"], dtype=torch.float32, device=device)
            if module.weight.shape != weights.shape or module.bias.shape != biases.shape:
                raise ValueError("Layer shape mismatch")
            module.weight.data.copy_(weights)
            module.bias.data.copy_(biases)


class ActorCritic(nn.Module):
    def __init__(self, input_size, action_size, hidden_sizes, activation, log_std_init):
        super().__init__()
        self.policy = Mlp(input_size, hidden_sizes, action_size, activation)
        self.value = Mlp(input_size, hidden_sizes, 1, activation)
        self.log_std = nn.Parameter(torch.full((action_size,), float(log_std_init)))

    def act(self, obs, min_weight, max_weight, deterministic=False):
        mean = self.policy(obs)
        if deterministic:
            tanh_action = torch.tanh(mean)
            action = scale_action(tanh_action, min_weight, max_weight)
            log_prob = torch.zeros(action.shape[0])
        else:
            std = self.log_std.exp()
            dist = Normal(mean, std)
            pre_tanh = dist.rsample()
            tanh_action = torch.tanh(pre_tanh)
            action = scale_action(tanh_action, min_weight, max_weight)
            log_prob = dist.log_prob(pre_tanh) - torch.log(1 - tanh_action.pow(2) + 1e-6)
            log_prob = log_prob.sum(-1)
        value = self.value(obs).squeeze(-1)
        return action, log_prob, value


def compute_gae(rewards, values, dones, gamma, lam, last_value):
    advantages = [0.0] * len(rewards)
    returns = [0.0] * len(rewards)
    last_gae = 0.0
    next_value = last_value

    for idx in reversed(range(len(rewards))):
        if dones[idx]:
            next_value = 0.0
            last_gae = 0.0
        delta = rewards[idx] + gamma * next_value - values[idx]
        last_gae = delta + gamma * lam * last_gae
        advantages[idx] = last_gae
        returns[idx] = advantages[idx] + values[idx]
        next_value = values[idx]

    return advantages, returns


def compute_score(total_reward, steps, ticks, mode):
    mode = str(mode or "reward").lower()
    if mode == "rps":
        return total_reward / steps if steps and steps > 0 else 0.0
    if mode == "rpt":
        return total_reward / ticks if ticks and ticks > 0 else 0.0
    return total_reward


def run_episode(
    proc,
    model,
    resources,
    feature_names,
    max_steps,
    step_ticks,
    seed,
    difficulty,
    min_weight,
    max_weight,
    scenario,
    full_sim,
):
    reset_payload = {"cmd": "reset", "seed": seed, "training": True}
    if full_sim:
        reset_payload["eval"] = True
    if difficulty is not None:
        reset_payload["difficulty"] = difficulty
    if scenario:
        reset_payload["scenario"] = scenario
    response = send(proc, reset_payload)
    start_tick = 0
    try:
        start_tick = int((response.get("info") or {}).get("tick", 0) or 0)
    except (TypeError, ValueError):
        start_tick = 0

    transitions = []
    total_reward = 0.0
    steps = 0
    done = False
    tracked_resources = [resource for resource in resources if is_policy_resource_id(resource)]
    shortage_sum = {resource: 0.0 for resource in tracked_resources}
    critical_sum = 0.0
    idle_sum = 0.0
    population_balance_sum = 0.0

    with inference_mode():
        for step in range(max_steps):
            obs = response.get("obs", {})
            vector = build_obs_vector(obs, resources, feature_names)
            obs_tensor = torch.tensor([vector], dtype=torch.float32)
            action_tensor, log_prob, value = model.act(
                obs_tensor,
                min_weight,
                max_weight,
                deterministic=False,
            )
            action = action_tensor.squeeze(0).tolist()
            weights, festival_intent, trade_payload, building_payload = split_action_payload(action, resources)
            action_payload = {"weights": weights, "ticks": step_ticks}
            if festival_intent is not None:
                action_payload["festivalIntent"] = festival_intent
            if trade_payload:
                action_payload["trade"] = trade_payload
            if building_payload:
                action_payload["building"] = building_payload
            if step == max_steps - 1:
                action_payload["debug"] = True
            response = send(proc, {"cmd": "step", "action": action_payload})
            reward = float(response.get("reward", 0.0))
            done = bool(response.get("done"))
            obs = response.get("obs", {}) or {}
            critical_sum += float(obs.get("criticalNeedsFraction", 0.0) or 0.0)
            idle_sum += float(obs.get("idleAdultsFraction", 0.0) or 0.0)
            population_balance_sum += float(obs.get("populationBalance", 0.0) or 0.0)
            ratios = obs.get("stockpileRatio", {}) or {}
            for resource in tracked_resources:
                ratio = float(ratios.get(resource, 1.0) or 0.0)
                shortage_sum[resource] += clamp(1.0 - ratio, 0.0, 1.0)

            transitions.append({
                "obs": vector,
                "actions": action,
                "log_prob": float(log_prob.item()),
                "value": float(value.item()),
                "reward": reward,
                "done": done,
            })
            total_reward += reward
            steps = step + 1
            if done:
                break

        bootstrap_value = 0.0
        if not done and steps > 0:
            obs = response.get("obs", {})
            vector = build_obs_vector(obs, resources, feature_names)
            obs_tensor = torch.tensor([vector], dtype=torch.float32)
            bootstrap_value = float(model.value(obs_tensor).squeeze(-1).item())

    info = response.get("info", {})
    done_reason = info.get("doneReason")
    if not done_reason and done:
        pop = info.get("population")
        done_reason = "extinction" if int(pop or 0) <= 0 else "done"
    if not done_reason and not done and steps >= max_steps:
        done_reason = "max_steps"
    info["doneReason"] = done_reason
    end_tick = 0
    try:
        end_tick = int(info.get("tick", 0) or 0)
    except (TypeError, ValueError):
        end_tick = 0
    ticks_elapsed = max(0, end_tick - start_tick) if end_tick >= start_tick else steps * step_ticks
    if steps > 0:
        shortage_avg = {key: value / steps for key, value in shortage_sum.items()}
        critical_avg = critical_sum / steps
        idle_avg = idle_sum / steps
        population_balance_avg = population_balance_sum / steps
    else:
        shortage_avg = {key: 0.0 for key in shortage_sum}
        critical_avg = 0.0
        idle_avg = 0.0
        population_balance_avg = 0.0
    info["episodeMetrics"] = {
        "steps": steps,
        "ticks": ticks_elapsed,
        "shortageAvg": shortage_avg,
        "criticalAvg": critical_avg,
        "idleAvg": idle_avg,
        "populationBalanceAvg": population_balance_avg,
    }
    return transitions, total_reward, steps, info, bootstrap_value


def evaluate(
    proc,
    model,
    resources,
    feature_names,
    max_steps,
    step_ticks,
    episodes,
    seed_base,
    difficulty,
    min_weight,
    max_weight,
    scenarios,
):
    total_reward = 0.0
    total_steps = 0.0
    total_ticks = 0.0
    total_births = 0.0
    total_deaths = 0.0
    scenario_plan = []
    if scenarios:
        per_scenario = max(1, episodes // max(1, len(scenarios)))
        remainder = max(0, episodes - per_scenario * len(scenarios))
        for idx, name in enumerate(scenarios):
            count = per_scenario + (1 if idx < remainder else 0)
            if count > 0:
                scenario_plan.append((name, count))
    else:
        scenario_plan.append((None, episodes))

    episode_idx = 0
    with inference_mode():
        for scenario_name, scenario_episodes in scenario_plan:
            for _ in range(scenario_episodes):
                seed = seed_base + episode_idx if seed_base is not None else None
                episode_idx += 1
                reset_payload = {
                    "cmd": "reset",
                    "seed": seed,
                    "training": True,
                    "eval": True,
                    "randomize": False,
                }
                if difficulty is not None:
                    reset_payload["difficulty"] = difficulty
                if scenario_name:
                    reset_payload["scenario"] = scenario_name
                response = send(proc, reset_payload)

                for step in range(max_steps):
                    obs = response.get("obs", {})
                    vector = build_obs_vector(obs, resources, feature_names)
                    obs_tensor = torch.tensor([vector], dtype=torch.float32)
                    action_tensor, _, _ = model.act(
                        obs_tensor,
                        min_weight,
                        max_weight,
                        deterministic=True,
                    )
                    action = action_tensor.squeeze(0).tolist()
                    weights, festival_intent, trade_payload, building_payload = split_action_payload(
                        action,
                        resources,
                    )
                    action_payload = {"weights": weights, "ticks": step_ticks}
                    if festival_intent is not None:
                        action_payload["festivalIntent"] = festival_intent
                    if trade_payload:
                        action_payload["trade"] = trade_payload
                    if building_payload:
                        action_payload["building"] = building_payload
                    response = send(proc, {"cmd": "step", "action": action_payload})
                    reward = float(response.get("reward", 0.0))
                    total_reward += reward
                    total_steps += 1
                    total_ticks += float(step_ticks)
                    if response.get("done"):
                        break

                info = response.get("info", {})
                total_births += int(info.get("births", 0))
                total_deaths += int(info.get("deaths", 0))

    return {
        "avg_reward": total_reward / max(1, episodes),
        "avg_steps": total_steps / max(1, episodes),
        "avg_ticks": total_ticks / max(1, episodes),
        "avg_births": total_births / max(1, episodes),
        "avg_deaths": total_deaths / max(1, episodes),
    }


def apply_ppo_update(
    model,
    optimizer,
    batch,
    min_weight,
    max_weight,
    clip_range,
    value_coef,
    entropy_coef,
    epochs,
    mini_batch_size,
    max_grad_norm,
):
    obs = torch.tensor(batch["obs"], dtype=torch.float32)
    actions = torch.tensor(batch["actions"], dtype=torch.float32)
    old_log_probs = torch.tensor(batch["log_probs"], dtype=torch.float32)
    returns = torch.tensor(batch["returns"], dtype=torch.float32)
    advantages = torch.tensor(batch["advantages"], dtype=torch.float32)

    advantages = (advantages - advantages.mean()) / (advantages.std() + 1e-8)

    batch_size = obs.shape[0]
    for _ in range(epochs):
        indices = torch.randperm(batch_size)
        for start in range(0, batch_size, mini_batch_size):
            idx = indices[start:start + mini_batch_size]
            batch_obs = obs[idx]
            batch_actions = actions[idx]
            batch_old_log = old_log_probs[idx]
            batch_returns = returns[idx]
            batch_adv = advantages[idx]

            mean = model.policy(batch_obs)
            log_prob = compute_log_prob(mean, model.log_std, batch_actions, min_weight, max_weight)
            ratio = torch.exp(log_prob - batch_old_log)

            unclipped = ratio * batch_adv
            clipped = torch.clamp(ratio, 1 - clip_range, 1 + clip_range) * batch_adv
            policy_loss = -torch.min(unclipped, clipped).mean()

            value_pred = model.value(batch_obs).squeeze(-1)
            value_loss = (batch_returns - value_pred).pow(2).mean()

            entropy = compute_entropy(model.log_std, mean).mean()

            loss = policy_loss + value_coef * value_loss - entropy_coef * entropy

            optimizer.zero_grad()
            loss.backward()
            if max_grad_norm > 0:
                nn.utils.clip_grad_norm_(model.parameters(), max_grad_norm)
            optimizer.step()


def load_config(path):
    if not path or not os.path.exists(path):
        return {}
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def to_int(value, fallback):
    try:
        return int(value)
    except (TypeError, ValueError):
        return fallback


def to_float(value, fallback):
    try:
        return float(value)
    except (TypeError, ValueError):
        return fallback


def to_str(value, fallback):
    return str(value) if value is not None else fallback


def to_bool(value, fallback):
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in ("true", "1", "yes", "y", "on"):
            return True
        if normalized in ("false", "0", "no", "n", "off"):
            return False
    return fallback


def to_int_list(value, fallback):
    if value is None:
        return fallback
    if isinstance(value, list):
        parsed = []
        for item in value:
            try:
                parsed.append(int(item))
            except (TypeError, ValueError):
                continue
        return parsed or fallback
    if isinstance(value, (int, float)):
        return [int(value)]
    if isinstance(value, str):
        parts = [part.strip() for part in value.replace(" ", ",").split(",") if part.strip()]
        parsed = []
        for part in parts:
            try:
                parsed.append(int(part))
            except ValueError:
                continue
        return parsed or fallback
    return fallback


def to_str_list(value, fallback):
    if value is None:
        return fallback
    if isinstance(value, list):
        parsed = []
        for item in value:
            if item is None:
                continue
            text = str(item).strip()
            if text:
                parsed.append(text)
        return parsed or fallback
    if isinstance(value, str):
        parts = [part.strip() for part in value.replace(" ", ",").split(",") if part.strip()]
        return parts or fallback
    return fallback


def is_dynamic_feature_name(name):
    text = str(name or "").strip()
    if not text:
        return False
    return any(text.startswith(prefix) and len(text) > len(prefix) for prefix in DYNAMIC_FEATURE_PREFIXES)


def resolve_feature_names(value, fallback):
    names = to_str_list(value, None)
    if not names:
        return list(fallback), []
    seen = set()
    invalid = []
    filtered = []
    for name in names:
        if name in FEATURE_NAME_SET or is_dynamic_feature_name(name):
            if name not in seen:
                filtered.append(name)
                seen.add(name)
        else:
            invalid.append(name)
    if not filtered:
        return list(fallback), invalid
    return filtered, invalid


def build_training_defaults(config):
    ai = config.get("ai", {}) if isinstance(config, dict) else {}
    training = ai.get("training", {}) if isinstance(ai, dict) else {}
    trainer = training.get("trainer", {}) if isinstance(training, dict) else {}

    feature_names, _ = resolve_feature_names(trainer.get("featureNames"), DEFAULT_FEATURE_NAMES)
    defaults = {
        "episodes": to_int(trainer.get("episodes"), 20000),
        "max_steps": to_int(trainer.get("maxSteps"), 900),
        "step_ticks": to_int(trainer.get("stepTicks"), to_int(ai.get("stepTicks"), 10)),
        "gamma": to_float(trainer.get("gamma"), 0.99),
        "gae_lambda": to_float(trainer.get("gaeLambda"), 0.95),
        "clip_range": to_float(trainer.get("clipRange"), 0.2),
        "entropy_coef": to_float(trainer.get("entropyCoef"), 0.01),
        "entropy_coef_final": to_float(trainer.get("entropyCoefFinal"), None),
        "entropy_ramp": to_int(trainer.get("entropyRampEpisodes"), None),
        "value_coef": to_float(trainer.get("valueCoef"), 0.5),
        "lr": to_float(trainer.get("lr"), 0.0003),
        "lr_final": to_float(trainer.get("lrFinal"), 0.0001),
        "epochs": to_int(trainer.get("epochs"), 4),
        "mini_batch_size": to_int(trainer.get("miniBatchSize"), 512),
        "batch_episodes": to_int(trainer.get("batchEpisodes"), 8),
        "hidden_sizes": to_int_list(trainer.get("hiddenSizes"), [128, 128]),
        "feature_names": feature_names,
        "activation": to_str(trainer.get("activation"), "tanh"),
        "log_std_init": to_float(trainer.get("logStdInit"), -0.5),
        "max_grad_norm": to_float(trainer.get("maxGradNorm"), 0.5),
        "workers": to_int(trainer.get("workers"), 1),
        "difficulty_start": to_float(
            trainer.get("difficultyStart"),
            to_float(training.get("difficultyStart"), 0.1),
        ),
        "difficulty_end": to_float(
            trainer.get("difficultyEnd"),
            to_float(training.get("difficultyEnd"), 1.0),
        ),
        "difficulty_ramp": to_int(
            trainer.get("difficultyRampEpisodes"),
            to_int(training.get("difficultyRampEpisodes"), 60000),
        ),
        "model_path": to_str(trainer.get("modelPath"), "models/policy.json"),
        "best_model_path": to_str(trainer.get("bestModelPath"), "models/policy_best.json"),
        "best_model_meta_path": to_str(
            trainer.get("bestModelMetaPath"),
            "models/policy_best.meta.json",
        ),
        "resume_from_best": to_bool(trainer.get("resumeFromBest"), False),
        "seed": to_int(trainer.get("seed"), 0),
        "log_every": to_int(trainer.get("logEvery"), 500),
        "debug_mode": to_str(
            trainer.get("debugMode", trainer.get("debug_mode")),
            "full",
        ),
        "eval_every": to_int(trainer.get("evalEvery"), 500),
        "eval_episodes": to_int(trainer.get("evalEpisodes"), 5),
        "eval_max_steps": to_int(trainer.get("evalMaxSteps"), 0),
        "eval_difficulty": to_float(trainer.get("evalDifficulty"), None),
        "eval_score": to_str(trainer.get("evalScore"), "rpt"),
        "sample_score": to_str(trainer.get("sampleScore"), "rpt"),
    }

    if defaults["entropy_coef_final"] is None:
        defaults["entropy_coef_final"] = defaults["entropy_coef"]
    if defaults["entropy_ramp"] is None:
        defaults["entropy_ramp"] = defaults["episodes"]

    return defaults


def parse_args():
    pre_parser = argparse.ArgumentParser(add_help=False)
    pre_parser.add_argument("--config", type=str, default="config.json")
    pre_args, _ = pre_parser.parse_known_args()

    config = load_config(pre_args.config)
    defaults = build_training_defaults(config)

    parser = argparse.ArgumentParser(description="Train PPO policy with PyTorch.")
    parser.add_argument("--config", type=str, default=pre_args.config)
    parser.add_argument("--episodes", type=int, default=defaults["episodes"])
    parser.add_argument("--max-steps", type=int, default=defaults["max_steps"])
    parser.add_argument("--step-ticks", type=int, default=defaults["step_ticks"])
    parser.add_argument("--gamma", type=float, default=defaults["gamma"])
    parser.add_argument("--gae-lambda", type=float, default=defaults["gae_lambda"])
    parser.add_argument("--clip-range", type=float, default=defaults["clip_range"])
    parser.add_argument("--entropy-coef", type=float, default=defaults["entropy_coef"])
    parser.add_argument("--entropy-coef-final", type=float, default=defaults["entropy_coef_final"])
    parser.add_argument("--entropy-ramp", type=int, default=defaults["entropy_ramp"])
    parser.add_argument("--value-coef", type=float, default=defaults["value_coef"])
    parser.add_argument("--lr", type=float, default=defaults["lr"])
    parser.add_argument("--lr-final", type=float, default=defaults["lr_final"])
    parser.add_argument("--epochs", type=int, default=defaults["epochs"])
    parser.add_argument("--mini-batch-size", type=int, default=defaults["mini_batch_size"])
    parser.add_argument("--batch-episodes", type=int, default=defaults["batch_episodes"])
    parser.add_argument("--hidden-sizes", type=str, default=None)
    parser.add_argument("--feature-names", type=str, default=None)
    parser.add_argument("--activation", type=str, default=defaults["activation"])
    parser.add_argument("--log-std-init", type=float, default=defaults["log_std_init"])
    parser.add_argument("--max-grad-norm", type=float, default=defaults["max_grad_norm"])
    parser.add_argument("--workers", type=int, default=defaults["workers"])
    parser.add_argument("--difficulty-start", type=float, default=defaults["difficulty_start"])
    parser.add_argument("--difficulty-end", type=float, default=defaults["difficulty_end"])
    parser.add_argument("--difficulty-ramp", type=int, default=defaults["difficulty_ramp"])
    parser.add_argument("--model-path", type=str, default=defaults["model_path"])
    parser.add_argument("--best-model-path", type=str, default=defaults["best_model_path"])
    parser.add_argument("--best-model-meta-path", type=str, default=defaults["best_model_meta_path"])
    parser.add_argument("--resume-from-best", action="store_true", default=defaults["resume_from_best"])
    parser.add_argument("--seed", type=int, default=defaults["seed"])
    parser.add_argument("--log-every", type=int, default=defaults["log_every"])
    parser.add_argument("--debug-mode", type=str, default=defaults["debug_mode"])
    parser.add_argument("--eval-every", type=int, default=defaults["eval_every"])
    parser.add_argument("--eval-episodes", type=int, default=defaults["eval_episodes"])
    parser.add_argument("--eval-max-steps", type=int, default=defaults["eval_max_steps"])
    parser.add_argument("--eval-difficulty", type=float, default=defaults["eval_difficulty"])
    parser.add_argument("--eval-score", type=str, default=defaults["eval_score"])
    parser.add_argument("--sample-score", type=str, default=defaults["sample_score"])
    parser.add_argument("--full-sim", action="store_true", default=False)
    parser.add_argument("--fresh", action="store_true", default=False)
    parser.add_argument("--debug-run-dir", type=str, default=None)
    parser.add_argument("--debug-summary-name", type=str, default=None)
    parser.add_argument("--debug-prefix", type=str, default=None)
    args = parser.parse_args()
    args.hidden_sizes = (
        to_int_list(args.hidden_sizes, defaults["hidden_sizes"])
        if args.hidden_sizes
        else defaults["hidden_sizes"]
    )
    args.activation = to_str(args.activation, defaults["activation"]).lower()
    feature_source = args.feature_names if args.feature_names is not None else defaults["feature_names"]
    args.feature_names, invalid = resolve_feature_names(feature_source, defaults["feature_names"])
    if invalid:
        print(
            "Warning: ignoring unknown feature names: " + ", ".join(invalid),
            file=sys.stderr,
        )
    args.debug_mode = to_str(args.debug_mode, defaults["debug_mode"]).lower()
    if args.eval_difficulty is not None:
        args.eval_difficulty = clamp(float(args.eval_difficulty), 0.0, 1.0)
    args.eval_score = to_str(args.eval_score, defaults["eval_score"]).lower()
    args.sample_score = to_str(args.sample_score, defaults["sample_score"]).lower()
    return args


def load_best_meta(path, model_path):
    if not path:
        return None
    if not os.path.exists(path):
        return None
    if model_path and not os.path.exists(model_path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as handle:
            payload = json.load(handle)
    except (OSError, json.JSONDecodeError):
        return None
    value = payload.get("bestScore", payload.get("bestReward"))
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def save_best_meta(path, stats, episode, score=None, score_mode=None):
    if not path:
        return
    directory = os.path.dirname(path)
    if directory:
        os.makedirs(directory, exist_ok=True)
    payload = {
        "bestReward": float(stats["avg_reward"]),
        "bestScore": float(score) if score is not None else None,
        "scoreMode": score_mode,
        "bestEpisode": int(episode),
        "avgSteps": float(stats["avg_steps"]),
        "avgTicks": float(stats.get("avg_ticks", 0.0)),
        "avgBirths": float(stats["avg_births"]),
        "avgDeaths": float(stats["avg_deaths"]),
        "savedAt": int(time.time()),
    }
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)


def save_policy(path, model, resources, feature_names, min_weight, max_weight, activation, log_std):
    payload = {
        "version": 2,
        "type": "mlp",
        "resources": resources,
        "featureNames": feature_names,
        "minWeight": min_weight,
        "maxWeight": max_weight,
        "activation": activation,
        "outputActivation": "tanh",
        "hiddenSizes": getattr(model.policy, "hidden_sizes", []),
        "layers": model.policy.export_layers(),
        "valueLayers": model.value.export_layers(),
        "logStd": log_std.detach().cpu().tolist(),
        "trainedAt": int(time.time()),
    }
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)


def load_policy(path, model):
    with open(path, "r", encoding="utf-8") as handle:
        payload = json.load(handle)
    layers = payload.get("layers") or []
    value_layers = payload.get("valueLayers") or []
    if layers:
        model.policy.load_layers(layers)
    if value_layers:
        model.value.load_layers(value_layers)
    log_std = payload.get("logStd")
    if isinstance(log_std, list) and len(log_std) == model.log_std.shape[0]:
        model.log_std.data.copy_(torch.tensor(log_std, dtype=torch.float32, device=model.log_std.device))


def load_policy_feature_names(path):
    if not path or not os.path.exists(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as handle:
            payload = json.load(handle)
    except (OSError, json.JSONDecodeError):
        return None
    names = payload.get("featureNames")
    if not isinstance(names, list):
        return None
    parsed = []
    for name in names:
        text = str(name).strip()
        if text:
            parsed.append(text)
    return parsed or None


def load_policy_resources(path):
    if not path or not os.path.exists(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as handle:
            payload = json.load(handle)
    except (OSError, json.JSONDecodeError):
        return None
    names = payload.get("resources")
    if not isinstance(names, list):
        return None
    parsed = []
    for name in names:
        text = str(name).strip()
        if text:
            parsed.append(text)
    return parsed or None


def main():
    args = parse_args()
    configure_torch_threads()
    if args.seed is not None:
        random.seed(args.seed)
        torch.manual_seed(args.seed)

    config = load_config(args.config)
    scenario_defs = get_scenario_definitions(config)
    training_scenarios = get_training_scenarios(scenario_defs)
    eval_scenarios = get_eval_scenarios(config, scenario_defs)
    scenario_rng = random.Random(args.seed) if args.seed is not None else random.Random()

    if args.fresh:
        for stale_path in (args.model_path, args.best_model_path, args.best_model_meta_path):
            if stale_path and os.path.exists(stale_path):
                try:
                    os.remove(stale_path)
                except OSError:
                    pass

    resources = get_resources_from_config(config)
    if not resources:
        temp_proc = subprocess.Popen(
            ["node", "ai_server.js"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            text=True,
            bufsize=1,
        )
        try:
            reset = send(temp_proc, {"cmd": "reset", "training": True})
            obs = reset.get("obs", {})
            resources = extract_resources(obs)
        finally:
            try:
                send(temp_proc, {"cmd": "close"})
            except Exception:
                pass
            temp_proc.terminate()

    if not resources:
        raise SystemExit("No resources available for training. Check config.json.")

    resources = append_festival_action(resources, config)
    resources = append_governor_actions(resources, config)

    feature_names = args.feature_names or list(DEFAULT_FEATURE_NAMES)
    input_size = len(resources) * len(feature_names)
    action_size = len(resources)
    model = ActorCritic(
        input_size,
        action_size,
        args.hidden_sizes,
        args.activation,
        args.log_std_init,
    )

    min_weight = float(config.get("ai", {}).get("minWeight", 0.0))
    max_weight = float(config.get("ai", {}).get("maxWeight", 2.0))

    optimizer = torch.optim.Adam(model.parameters(), lr=args.lr)

    resume_path = None
    if not args.fresh:
        if args.resume_from_best and os.path.exists(args.best_model_path):
            resume_path = args.best_model_path
        elif os.path.exists(args.model_path):
            resume_path = args.model_path

    if resume_path:
        resume_features = load_policy_feature_names(resume_path)
        if resume_features and resume_features != feature_names:
            raise SystemExit(
                "Feature names mismatch with resume policy. "
                "Update ai.training.trainer.featureNames or run with --fresh."
            )
        resume_resources = load_policy_resources(resume_path)
        if resume_resources and resume_resources != resources:
            raise SystemExit(
                "Action head mismatch with resume policy (resource/action ids differ). "
                "Run with --fresh."
            )
        try:
            load_policy(resume_path, model)
        except ValueError as exc:
            raise SystemExit(
                "Resume checkpoint shape mismatch. Run with --fresh."
            ) from exc

    best_eval = None if args.fresh else load_best_meta(args.best_model_meta_path, args.best_model_path)

    reward_window = 0.0
    steps_window = 0
    births_window = 0
    deaths_window = 0
    debug_window = init_debug_accumulator()
    window_start = 1
    window_start_time = time.perf_counter()
    file_reward_window = 0.0
    file_steps_window = 0
    file_births_window = 0
    file_deaths_window = 0
    file_debug_window = init_debug_accumulator()
    file_window_start = 1
    file_window_start_time = time.perf_counter()
    eval_seed_base = (args.seed + 100000) if args.seed is not None else None
    detail_prefix = (args.debug_prefix or "").strip()
    if detail_prefix:
        detail_prefix = detail_prefix.replace(os.sep, "_")
    debug_run_dir = None
    summary_log_path = None
    if TRAINING_LOGS_ENABLED:
        debug_run_dir, summary_log_path = init_debug_run(
            run_dir=args.debug_run_dir,
            summary_name=args.debug_summary_name,
        )
    summary_log_handle = None
    scenario_sampling = get_scenario_sampling(config)
    scenario_sampler = init_scenario_sampler(config, scenario_defs)

    if TRAINING_LOGS_ENABLED and summary_log_path:
        try:
            summary_log_handle = open(summary_log_path, "a", encoding="utf-8")
            write_summary_header(
                summary_log_handle,
                args,
                resources,
                min_weight,
                max_weight,
                scenario_defs,
                eval_scenarios,
                scenario_sampling,
            )
            summary_log_handle.flush()
        except OSError:
            summary_log_handle = None
            debug_run_dir = None
    pending_detail_events = []
    last_eval_score = None
    prev_scenario_mix = None

    batch_obs = []
    batch_actions = []
    batch_log_probs = []
    batch_rewards = []
    batch_values = []
    batch_episode_count = 0

    worker_count = max(1, int(args.workers))
    ctx = mp.get_context("spawn")
    task_queue = ctx.SimpleQueue()
    result_queue = ctx.SimpleQueue()
    update_queues = [ctx.Queue(maxsize=1) for _ in range(worker_count)]
    for queue_obj in update_queues:
        try:
            queue_obj._ignore_epipe = True
        except Exception:
            pass

    worker_settings = {
        "max_steps": args.max_steps,
        "step_ticks": args.step_ticks,
        "min_weight": min_weight,
        "max_weight": max_weight,
        "hidden_sizes": args.hidden_sizes,
        "feature_names": feature_names,
        "activation": args.activation,
        "log_std_init": args.log_std_init,
        "full_sim": args.full_sim,
        "debug_mode": args.debug_mode,
    }

    processes = []
    for idx in range(worker_count):
        process = ctx.Process(
            target=worker_loop,
            args=(
                idx,
                task_queue,
                result_queue,
                update_queues[idx],
                resources,
                worker_settings,
            ),
        )
        process.start()
        processes.append(process)

    broadcast_weights(update_queues, get_model_payload(model), processes)

    eval_proc = None
    if args.eval_every > 0:
        eval_env = os.environ.copy()
        if args.debug_mode:
            eval_env["NODEDWARVES_DEBUG_MODE"] = str(args.debug_mode)
        eval_proc = subprocess.Popen(
            ["node", "ai_server.js"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            text=True,
            bufsize=1,
            env=eval_env,
        )

    try:
        next_episode = 1
        in_flight = 0
        completed = 0
        next_expected = 1
        results_buffer = {}

        def schedule_tasks():
            nonlocal next_episode, in_flight
            while in_flight < worker_count and next_episode <= args.episodes:
                progress = min(1.0, (next_episode - 1) / max(1, args.difficulty_ramp))
                difficulty = args.difficulty_start + (args.difficulty_end - args.difficulty_start) * progress
                difficulty = clamp(difficulty, 0.0, 1.0)
                seed = (args.seed + next_episode) if args.seed is not None else None
                scenario = select_scenario(training_scenarios, scenario_rng, difficulty)
                task_queue.put((next_episode, seed, difficulty, scenario))
                in_flight += 1
                next_episode += 1

        schedule_tasks()

        while completed < args.episodes:
            result = result_queue.get()
            episode_number, transitions, reward, steps, info, bootstrap_value = result
            in_flight -= 1
            results_buffer[episode_number] = (transitions, reward, steps, info, bootstrap_value)
            schedule_tasks()

            while next_expected in results_buffer:
                transitions, reward, steps, info, bootstrap_value = results_buffer.pop(next_expected)
                completed += 1

                progress = min(1.0, (next_expected - 1) / max(1, args.difficulty_ramp))
                difficulty = args.difficulty_start + (args.difficulty_end - args.difficulty_start) * progress
                difficulty = clamp(difficulty, 0.0, 1.0)

                rewards = [t["reward"] for t in transitions]
                values = [t["value"] for t in transitions]
                dones = [t["done"] for t in transitions]
                advantages, returns = compute_gae(
                    rewards,
                    values,
                    dones,
                    args.gamma,
                    args.gae_lambda,
                    bootstrap_value,
                )

                for idx, transition in enumerate(transitions):
                    batch_obs.append(transition["obs"])
                    batch_actions.append(transition["actions"])
                    batch_log_probs.append(transition["log_prob"])
                    batch_rewards.append(returns[idx])
                    batch_values.append(advantages[idx])

                batch_episode_count += 1

                reward_window += reward
                steps_window += steps
                births_window += int(info.get("births", 0))
                deaths_window += int(info.get("deaths", 0))
                if TRAINING_LOGS_ENABLED:
                    accumulate_debug(debug_window, info)
                    file_reward_window += reward
                    file_steps_window += steps
                    file_births_window += int(info.get("births", 0))
                    file_deaths_window += int(info.get("deaths", 0))
                    accumulate_debug(file_debug_window, info)

                scenario_name = extract_scenario_name(info)
                episode_metrics = info.get("episodeMetrics") or {}
                ticks = float(episode_metrics.get("ticks", steps * args.step_ticks) or 0.0)
                scenario_score = compute_score(reward, steps, ticks, args.sample_score)
                record_scenario_reward(scenario_sampler, scenario_name, scenario_score)
                if (
                    scenario_sampler
                    and next_expected - scenario_sampler["last_update"] >= scenario_sampler["update_every"]
                ):
                    scenario_sampler["last_update"] = next_expected
                    if update_scenario_weights(scenario_sampler, scenario_defs):
                        if TRAINING_LOGS_ENABLED:
                            pending_detail_events.append("scenario_weights")

                if batch_episode_count >= args.batch_episodes:
                    entropy_progress = min(1.0, next_expected / max(1, args.entropy_ramp))
                    entropy_coef = args.entropy_coef + (
                        args.entropy_coef_final - args.entropy_coef
                    ) * entropy_progress
                    batch = {
                        "obs": batch_obs,
                        "actions": batch_actions,
                        "log_probs": batch_log_probs,
                        "returns": batch_rewards,
                        "advantages": batch_values,
                    }
                    apply_ppo_update(
                        model,
                        optimizer,
                        batch,
                        min_weight,
                        max_weight,
                        args.clip_range,
                        args.value_coef,
                        entropy_coef,
                        args.epochs,
                        args.mini_batch_size,
                        args.max_grad_norm,
                    )
                    batch_obs.clear()
                    batch_actions.clear()
                    batch_log_probs.clear()
                    batch_rewards.clear()
                    batch_values.clear()
                    batch_episode_count = 0
                    broadcast_weights(update_queues, get_model_payload(model), processes)

                if args.lr_final is not None:
                    lr_progress = next_expected / max(1, args.episodes)
                    lr_value = args.lr + (args.lr_final - args.lr) * lr_progress
                    for param_group in optimizer.param_groups:
                        param_group["lr"] = lr_value

                if (
                    next_expected == 1
                    or next_expected % args.log_every == 0
                    or next_expected == args.episodes
                ):
                    if TRAINING_LOGS_ENABLED:
                        window_count = next_expected - window_start + 1
                        eps_per_min = None
                        if LOG_RATE:
                            elapsed = time.perf_counter() - window_start_time
                            eps_per_min = window_count / elapsed * 60.0 if elapsed > 0 else 0.0
                        avg_reward = reward_window / window_count
                        avg_steps = steps_window / window_count
                        avg_births = births_window / window_count
                        avg_deaths = deaths_window / window_count
                        rate_label = f" eps_pm={eps_per_min:.1f} " if eps_per_min is not None else ""
                        print(
                            f"\nepisode={next_expected} avg_reward={avg_reward:.2f} avg_steps={avg_steps:.1f} "
                            f"avg_births={avg_births:.2f} avg_deaths={avg_deaths:.2f} "
                            f"{rate_label}lr={optimizer.param_groups[0]['lr']:.6f} diff={difficulty:.2f} "
                            f"tick={info.get('tick')} pop={info.get('population')}"
                        )
                    save_policy(
                        args.model_path,
                        model,
                        resources,
                        feature_names,
                        min_weight,
                        max_weight,
                        args.activation,
                        model.log_std,
                    )
                    reward_window = 0.0
                    steps_window = 0
                    births_window = 0
                    deaths_window = 0
                    debug_window = init_debug_accumulator()
                    window_start = next_expected + 1
                    window_start_time = time.perf_counter()

                if (
                    TRAINING_LOGS_ENABLED
                    and summary_log_handle
                    and (next_expected % SUMMARY_LOG_EVERY == 0 or next_expected == args.episodes)
                ):
                    file_window_count = next_expected - file_window_start + 1
                    eps_per_min = None
                    if LOG_RATE:
                        elapsed = time.perf_counter() - file_window_start_time
                        eps_per_min = file_window_count / elapsed * 60.0 if elapsed > 0 else 0.0
                    file_avg_reward = file_reward_window / file_window_count
                    file_avg_steps = file_steps_window / file_window_count
                    file_avg_births = file_births_window / file_window_count
                    file_avg_deaths = file_deaths_window / file_window_count
                    file_debug = average_debug(file_debug_window) or {}

                    events = list(pending_detail_events)
                    pending_detail_events.clear()

                    scenario_counts = file_debug.get("scenarioCounts") or {}
                    if scenario_counts and file_window_count > 0:
                        scenario_mix = {
                            name: count / file_window_count
                            for name, count in scenario_counts.items()
                        }
                        shift = mix_distance(prev_scenario_mix or {}, scenario_mix)
                        if shift >= DETAIL_SCENARIO_SHIFT:
                            events.append(f"scenario_shift={shift:.2f}")
                        prev_scenario_mix = scenario_mix

                    summary_line = format_summary_line(
                        next_expected,
                        file_window_start,
                        file_window_count,
                        file_avg_reward,
                        file_avg_steps,
                        file_avg_births,
                        file_avg_deaths,
                        optimizer.param_groups[0]["lr"],
                        difficulty,
                        info,
                        file_debug,
                        events,
                        get_scenario_target_mix(scenario_defs),
                        eps_per_min,
                    )
                    summary_log_handle.write(summary_line + "\n")
                    summary_log_handle.flush()

                    if events and debug_run_dir:
                        detail_name = (
                            f"detail_{detail_prefix}_ep{next_expected:05d}.log"
                            if detail_prefix
                            else f"detail_ep{next_expected:05d}.log"
                        )
                        detail_path = os.path.join(debug_run_dir, detail_name)
                        try:
                            with open(detail_path, "w", encoding="utf-8") as detail_handle:
                                write_detail_header(
                                    detail_handle,
                                    args,
                                    resources,
                                    min_weight,
                                    max_weight,
                                    scenario_defs,
                                    eval_scenarios,
                                    scenario_sampling,
                                )
                                detail_entry = format_debug_file_entry(
                                    next_expected,
                                    file_window_start,
                                    file_window_count,
                                    file_avg_reward,
                                    file_avg_steps,
                                    file_avg_births,
                                    file_avg_deaths,
                                    optimizer.param_groups[0]["lr"],
                                    difficulty,
                                    info,
                                    file_debug,
                                    resources,
                                    events,
                                )
                                detail_handle.write(detail_entry)
                        except OSError:
                            pass

                    file_reward_window = 0.0
                    file_steps_window = 0
                    file_births_window = 0
                    file_deaths_window = 0
                    file_debug_window = init_debug_accumulator()
                    file_window_start = next_expected + 1
                    file_window_start_time = time.perf_counter()

                if eval_proc and args.eval_every > 0 and next_expected % args.eval_every == 0:
                    eval_max_steps = (
                        args.eval_max_steps
                        if args.eval_max_steps and args.eval_max_steps > 0
                        else args.max_steps
                    )
                    eval_difficulty = (
                        args.eval_difficulty
                        if args.eval_difficulty is not None
                        else args.difficulty_end
                    )
                    stats = evaluate(
                        eval_proc,
                        model,
                        resources,
                        feature_names,
                        eval_max_steps,
                        args.step_ticks,
                        args.eval_episodes,
                        eval_seed_base,
                        eval_difficulty,
                        min_weight,
                        max_weight,
                        eval_scenarios,
                    )
                    eval_score = compute_score(
                        stats["avg_reward"],
                        stats["avg_steps"],
                        stats.get("avg_ticks", 0.0),
                        args.eval_score,
                    )
                    if TRAINING_LOGS_ENABLED:
                        print(
                            f"eval episode={next_expected} avg_reward={stats['avg_reward']:.2f} "
                            f"avg_steps={stats['avg_steps']:.1f} avg_births={stats['avg_births']:.2f} "
                            f"avg_deaths={stats['avg_deaths']:.2f} score={eval_score:.3f}"
                        )
                    if last_eval_score is not None:
                        drop = last_eval_score - eval_score
                        threshold = max(
                            DETAIL_EVAL_REGRESSION_ABS,
                            abs(last_eval_score) * DETAIL_EVAL_REGRESSION_REL,
                        )
                        if drop >= threshold:
                            if TRAINING_LOGS_ENABLED:
                                pending_detail_events.append(f"eval_regression={drop:.2f}")
                    last_eval_score = eval_score
                    if args.best_model_path:
                        if best_eval is None or eval_score > best_eval:
                            best_eval = eval_score
                            save_policy(
                                args.best_model_path,
                                model,
                                resources,
                                feature_names,
                                min_weight,
                                max_weight,
                                args.activation,
                                model.log_std,
                            )
                            save_best_meta(
                                args.best_model_meta_path,
                                stats,
                                next_expected,
                                eval_score,
                                args.eval_score,
                            )
                            print_best_saved_line(
                                next_expected,
                                best_eval,
                                stats["avg_reward"],
                                args.best_model_path,
                                args.best_model_meta_path,
                            )
                            if TRAINING_LOGS_ENABLED:
                                pending_detail_events.append(f"best_eval={best_eval:.2f}")

                next_expected += 1

    finally:
        try:
            for _ in processes:
                task_queue.put(None)
        except Exception:
            pass
        for process in processes:
            process.join(timeout=5)
        for process in processes:
            if process.is_alive():
                process.terminate()
        for process in processes:
            process.join(timeout=5)
        for queue_obj in [task_queue, result_queue, *update_queues]:
            try:
                if hasattr(queue_obj, "cancel_join_thread"):
                    queue_obj.cancel_join_thread()
                if hasattr(queue_obj, "close"):
                    queue_obj.close()
            except Exception:
                pass
        if eval_proc:
            try:
                send(eval_proc, {"cmd": "close"})
            except Exception:
                pass
            eval_proc.terminate()
        if summary_log_handle:
            try:
                summary_log_handle.close()
            except OSError:
                pass


if __name__ == "__main__":
    main()
