import argparse
from datetime import datetime, timezone
import json
import math
import os
import shutil
import subprocess
import sys

import train

BEST_SAVE_COLOR = getattr(train, "BEST_EVAL_COLOR", "\033[96m")
DIAGNOSTIC_RPT_WEIGHT = 1.0
DIAGNOSTIC_DEEP_WEIGHT = 0.05


# Function: build_ai_server_command.
def build_ai_server_command(config_path):
    command = ["node", "ai_server.js"]
    if config_path:
        command.extend(["--config", str(config_path)])
    return command


# Function: load_policy_payload.
def load_policy_payload(path):
    if not path or not os.path.exists(path):
        raise SystemExit(f"Missing policy file: {path}")
    try:
        with open(path, "r", encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, json.JSONDecodeError) as exc:
        raise SystemExit(f"Failed to read policy payload: {path}") from exc


# Function: resolve_policy_list.
def resolve_policy_list(value, fallback):
    if isinstance(value, list) and value:
        parsed = []
        for item in value:
            text = str(item).strip()
            if text:
                parsed.append(text)
        if parsed:
            return parsed
    return list(fallback)


# Function: resolve_hidden_sizes.
def resolve_hidden_sizes(value, fallback):
    if isinstance(value, list) and value:
        parsed = []
        for item in value:
            try:
                parsed.append(int(item))
            except (TypeError, ValueError):
                continue
        if parsed:
            return parsed
    return list(fallback)


# Function: resolve_weight_limit.
def resolve_weight_limit(value, fallback):
    try:
        return float(value)
    except (TypeError, ValueError):
        return float(fallback)


# Function: build_promote_defaults.
def build_promote_defaults(config, train_defaults):
    ai = (config.get("ai", {}) or {}) if isinstance(config, dict) else {}
    training = (ai.get("training", {}) or {}) if isinstance(ai, dict) else {}
    promotion = (training.get("promotion", {}) or {}) if isinstance(training, dict) else {}
    canonical = (promotion.get("canonical", {}) or {}) if isinstance(promotion, dict) else {}

    defaults = {
        "eval_episodes": int(train_defaults["eval_episodes"]),
        "eval_max_steps": int(train_defaults["eval_max_steps"]),
        "eval_difficulty": train_defaults["eval_difficulty"],
        "eval_score": str(train_defaults["eval_score"]),
        "difficulty_end": float(train_defaults["difficulty_end"]),
        "max_steps": int(train_defaults["max_steps"]),
        "step_ticks": int(train_defaults["step_ticks"]),
        "seed": int(train_defaults["seed"]) if train_defaults["seed"] is not None else 0,
        "min_improve": 0.0,
        "require_positive_lcb": False,
        "lcb_z": 1.96,
        "canonical_enabled": False,
        "eval_progress_every": 10,
    }
    if canonical:
        defaults["canonical_enabled"] = train.to_bool(canonical.get("enabled"), True)
    if defaults["canonical_enabled"]:
        defaults["eval_episodes"] = max(
            1,
            int(train.to_int(canonical.get("evalEpisodes"), defaults["eval_episodes"])),
        )
        defaults["eval_max_steps"] = int(
            train.to_int(canonical.get("evalMaxSteps"), defaults["eval_max_steps"])
        )
        defaults["eval_difficulty"] = train.to_float(
            canonical.get("evalDifficulty"),
            defaults["eval_difficulty"],
        )
        defaults["eval_score"] = str(
            train.to_str(canonical.get("evalScore"), defaults["eval_score"])
        )
        defaults["max_steps"] = max(
            1,
            int(train.to_int(canonical.get("maxSteps"), defaults["max_steps"])),
        )
        defaults["step_ticks"] = max(
            1,
            int(train.to_int(canonical.get("stepTicks"), defaults["step_ticks"])),
        )
        defaults["seed"] = int(train.to_int(canonical.get("seed"), defaults["seed"]))
        defaults["min_improve"] = float(
            train.to_float(canonical.get("minImprove"), defaults["min_improve"])
        )
        defaults["require_positive_lcb"] = train.to_bool(
            canonical.get("requirePositiveLcb"),
            True,
        )
        defaults["lcb_z"] = float(train.to_float(canonical.get("lcbZ"), defaults["lcb_z"]))
    return defaults


# Function: resolve_policy_settings.
def resolve_policy_settings(payload, config, defaults, resources):
    feature_names, invalid = train.resolve_feature_names(
        payload.get("featureNames"),
        defaults["feature_names"],
    )
    resolved_resources = resolve_policy_list(payload.get("resources"), resources)
    input_size = len(resolved_resources) * len(feature_names)
    ai_config = (config.get("ai", {}) or {}) if isinstance(config, dict) else {}
    min_weight = resolve_weight_limit(payload.get("minWeight"), ai_config.get("minWeight", 0.0))
    max_weight = resolve_weight_limit(payload.get("maxWeight"), ai_config.get("maxWeight", 2.0))
    normalization_payload = payload.get("normalization")
    obs_payload = None
    ret_payload = None
    normalization_version = None
    obs_mismatch = False
    return_mismatch = False
    if isinstance(normalization_payload, dict):
        normalization_version = train.to_int(normalization_payload.get("version"), None)
        obs_payload = normalization_payload.get("observation")
        ret_payload = normalization_payload.get("returns")
    if isinstance(obs_payload, dict):
        obs_mean = obs_payload.get("mean")
        obs_var = obs_payload.get("var")
        if isinstance(obs_mean, list) and isinstance(obs_var, list):
            if len(obs_mean) != input_size or len(obs_var) != input_size:
                obs_mismatch = True
    if isinstance(ret_payload, dict):
        ret_mean = ret_payload.get("mean")
        ret_var = ret_payload.get("var")
        if isinstance(ret_mean, list) and isinstance(ret_var, list):
            if len(ret_mean) != 1 or len(ret_var) != 1:
                return_mismatch = True
    obs_normalization = train.parse_running_stats(
        obs_payload,
        input_size,
        enabled_fallback=defaults["obs_norm"],
        clip_fallback=defaults["obs_norm_clip"],
        epsilon_fallback=defaults["obs_norm_epsilon"],
    )
    return_normalization = train.parse_running_stats(
        ret_payload,
        1,
        enabled_fallback=defaults["return_norm"],
        clip_fallback=defaults["return_norm_clip"],
        epsilon_fallback=defaults["return_norm_epsilon"],
    )
    return {
        "resources": resolved_resources,
        "feature_names": feature_names,
        "invalid_features": invalid,
        "hidden_sizes": resolve_hidden_sizes(payload.get("hiddenSizes"), defaults["hidden_sizes"]),
        "activation": str(payload.get("activation") or defaults["activation"] or "tanh").lower(),
        "min_weight": min_weight,
        "max_weight": max_weight,
        "obs_normalization": obs_normalization,
        "return_normalization": return_normalization,
        "normalization_version": normalization_version,
        "normalization_obs_mismatch": obs_mismatch,
        "normalization_return_mismatch": return_mismatch,
    }


# Function: build_model_from_policy.
def build_model_from_policy(payload, resources, feature_names, hidden_sizes, activation):
    input_size = len(resources) * len(feature_names)
    action_size = len(resources)
    model = train.ActorCritic(input_size, action_size, hidden_sizes, activation, -0.5)
    train.load_policy(payload["__path"], model)
    return model


# Function: evaluate_policy.
def evaluate_policy(
    proc,
    payload,
    resources,
    feature_names,
    hidden_sizes,
    activation,
    min_weight,
    max_weight,
    eval_steps,
    step_ticks,
    eval_episodes,
    seed_base,
    eval_difficulty,
    eval_score_mode,
    eval_scenarios,
    collect_episode_scores=False,
    progress=False,
    progress_every=0,
    progress_prefix="eval",
    obs_normalization=None,
    transport=train.TRANSPORT_LEGACY,
):
    model = build_model_from_policy(payload, resources, feature_names, hidden_sizes, activation)
    stats = train.evaluate(
        proc,
        model,
        resources,
        feature_names,
        eval_steps,
        step_ticks,
        eval_episodes,
        seed_base,
        eval_difficulty,
        min_weight,
        max_weight,
        eval_scenarios,
        eval_score_mode,
        collect_episode_scores,
        progress=progress,
        progress_every=progress_every,
        progress_prefix=progress_prefix,
        obs_normalization=obs_normalization,
        transport=transport,
    )
    score = train.compute_score(
        stats["avg_reward"],
        stats["avg_steps"],
        stats.get("avg_ticks", 0.0),
        eval_score_mode,
    )
    return stats, score


# Function: compute_paired_delta_stats.
def compute_paired_delta_stats(latest_scores, best_scores, z_value):
    if not isinstance(latest_scores, list) or not isinstance(best_scores, list):
        return None
    if not latest_scores or not best_scores:
        return None
    count = min(len(latest_scores), len(best_scores))
    if count <= 0:
        return None
    deltas = []
    for idx in range(count):
        try:
            deltas.append(float(latest_scores[idx]) - float(best_scores[idx]))
        except (TypeError, ValueError):
            continue
    if not deltas:
        return None
    n = len(deltas)
    mean_delta = sum(deltas) / n
    if n <= 1:
        return {
            "count": n,
            "mean_delta": mean_delta,
            "std_delta": 0.0,
            "se_delta": 0.0,
            "lower_bound": mean_delta,
        }
    variance = sum((value - mean_delta) ** 2 for value in deltas) / (n - 1)
    std_delta = math.sqrt(max(0.0, variance))
    se_delta = std_delta / math.sqrt(n)
    z = max(0.0, float(z_value))
    lower_bound = mean_delta - z * se_delta
    return {
        "count": n,
        "mean_delta": mean_delta,
        "std_delta": std_delta,
        "se_delta": se_delta,
        "lower_bound": lower_bound,
    }


# Function: print_paired_episode_deltas.
def print_paired_episode_deltas(latest_scores, best_scores):
    if not isinstance(latest_scores, list) or not isinstance(best_scores, list):
        return
    count = min(len(latest_scores), len(best_scores))
    if count <= 0:
        return
    print("Paired episodes (latest vs best):", flush=True)
    for idx in range(count):
        try:
            latest_value = float(latest_scores[idx])
            best_value = float(best_scores[idx])
        except (TypeError, ValueError):
            continue
        delta = latest_value - best_value
        print(
            f"  ep={idx + 1} latest={latest_value:.4f} "
            f"best={best_value:.4f} delta={delta:+.4f}",
            flush=True,
        )


# Function: ensure_parent_dir.
def ensure_parent_dir(path):
    if not path:
        return
    directory = os.path.dirname(str(path))
    if directory:
        os.makedirs(directory, exist_ok=True)


# Function: stats_to_payload.
def stats_to_payload(stats, score):
    if not isinstance(stats, dict):
        return None
    payload = {
        "avg_reward": float(stats.get("avg_reward", 0.0)),
        "avg_steps": float(stats.get("avg_steps", 0.0)),
        "avg_ticks": float(stats.get("avg_ticks", 0.0)),
        "avg_births": float(stats.get("avg_births", 0.0)),
        "avg_deaths": float(stats.get("avg_deaths", 0.0)),
        "score": float(score),
    }
    for metric in (
        "avg_under_depthProgress",
        "avg_under_championProgress",
        "avg_under_readinessScore",
        "avg_under_combatPressure",
    ):
        if metric in stats:
            payload[metric] = float(stats.get(metric, 0.0))
    episode_scores = stats.get("episode_scores")
    if isinstance(episode_scores, list):
        payload["episode_scores"] = [float(value) for value in episode_scores]
    return payload


# Function: build_diagnostic_scores.
def build_diagnostic_scores(stats):
    if not isinstance(stats, dict):
        return None
    avg_reward = float(stats.get("avg_reward", 0.0))
    avg_steps = float(stats.get("avg_steps", 0.0))
    avg_ticks = float(stats.get("avg_ticks", 0.0))
    rpt_score = float(train.compute_score(avg_reward, avg_steps, avg_ticks, "rpt"))
    readiness = train.clamp(float(stats.get("avg_under_readinessScore", 0.0) or 0.0), 0.0, 1.0)
    depth = train.clamp(float(stats.get("avg_under_depthProgress", 0.0) or 0.0), 0.0, 1.0)
    champion = train.clamp(float(stats.get("avg_under_championProgress", 0.0) or 0.0), 0.0, 1.0)
    pressure = train.clamp(float(stats.get("avg_under_combatPressure", 0.0) or 0.0), 0.0, 1.0)
    deep_aux = train.clamp(
        (0.45 * readiness) + (0.2 * depth) + (0.15 * champion) + (0.2 * (1.0 - pressure)),
        0.0,
        1.0,
    )
    ensemble = rpt_score + (DIAGNOSTIC_DEEP_WEIGHT * (deep_aux - 0.5))
    return {
        "rpt_score": rpt_score,
        "deep_aux": deep_aux,
        "ensemble_score": ensemble,
        "weights": {
            "rpt": DIAGNOSTIC_RPT_WEIGHT,
            "deep_aux_delta": DIAGNOSTIC_DEEP_WEIGHT,
        },
    }


# Function: build_report_payload.
def build_report_payload(
    args,
    eval_context,
    latest_stats,
    latest_score,
    best_stats,
    best_score,
    promoted,
    reason,
    delta_score=None,
    paired_stats=None,
):
    now = datetime.now(timezone.utc)
    latest_payload = stats_to_payload(latest_stats, latest_score)
    best_payload = stats_to_payload(best_stats, best_score) if best_stats is not None else None
    if promoted:
        best_after_score = float(latest_score)
    elif best_score is not None:
        best_after_score = float(best_score)
    else:
        best_after_score = None
    payload = {
        "version": 1,
        "timestamp": int(now.timestamp()),
        "timestamp_iso": now.isoformat(),
        "promoted": bool(promoted),
        "reason": str(reason or ""),
        "model_path": str(args.model_path),
        "model_state_path": str(args.model_state_path),
        "best_model_path": str(args.best_model_path),
        "best_model_meta_path": str(args.best_model_meta_path),
        "best_model_state_path": str(args.best_model_state_path),
        "eval_context": dict(eval_context or {}),
        "thresholds": {
            "min_improve": float(args.min_improve),
            "require_positive_lcb": bool(args.require_positive_lcb),
            "lcb_z": float(args.lcb_z),
        },
        "latest": latest_payload,
        "best_before": best_payload,
        "best_score_before": float(best_score) if best_score is not None else None,
        "best_score_after": best_after_score,
        "delta_score": float(delta_score) if delta_score is not None else None,
    }
    latest_diag = build_diagnostic_scores(latest_stats)
    best_diag = build_diagnostic_scores(best_stats) if best_stats is not None else None
    if latest_diag:
        diagnostic = {
            "enabled": True,
            "latest": latest_diag,
            "best_before": best_diag,
            "delta_ensemble_score": (
                float(latest_diag["ensemble_score"] - best_diag["ensemble_score"])
                if best_diag is not None
                else None
            ),
            "notes": (
                "Diagnostics only: ensemble score never drives promotion decisions "
                "(promotion remains based on evalScore + existing guardrails)."
            ),
        }
        payload["diagnostic"] = diagnostic
    if paired_stats:
        payload["paired"] = {
            "count": int(paired_stats.get("count", 0)),
            "mean_delta": float(paired_stats.get("mean_delta", 0.0)),
            "std_delta": float(paired_stats.get("std_delta", 0.0)),
            "se_delta": float(paired_stats.get("se_delta", 0.0)),
            "lower_bound": float(paired_stats.get("lower_bound", 0.0)),
        }
    return payload


# Function: render_report_markdown.
def render_report_markdown(payload):
    latest = payload.get("latest") or {}
    best_before = payload.get("best_before") or {}
    thresholds = payload.get("thresholds") or {}
    paired = payload.get("paired") or {}
    eval_context = payload.get("eval_context") or {}
    diagnostic = payload.get("diagnostic") or {}

    def fmt(value, decimals=4):
        if value is None:
            return "-"
        try:
            numeric = float(value)
        except (TypeError, ValueError):
            return str(value)
        return f"{numeric:.{decimals}f}"

    lines = [
        "# Promotion Report",
        "",
        f"- Timestamp (UTC): `{payload.get('timestamp_iso', '-')}`",
        f"- Reason: `{payload.get('reason', '-')}`",
        f"- Promoted: `{payload.get('promoted', False)}`",
        f"- Best score before: `{fmt(payload.get('best_score_before'))}`",
        f"- Best score after: `{fmt(payload.get('best_score_after'))}`",
        f"- Delta score: `{fmt(payload.get('delta_score'))}`",
        "",
        "## Evaluation Context",
        "",
        f"- Config: `{eval_context.get('config', '-')}`",
        f"- Eval episodes: `{eval_context.get('evalEpisodes', '-')}`",
        f"- Eval max steps: `{eval_context.get('evalMaxSteps', '-')}`",
        f"- Eval difficulty: `{fmt(eval_context.get('evalDifficulty'))}`",
        f"- Eval score mode: `{eval_context.get('evalScore', '-')}`",
        f"- Seed base: `{eval_context.get('seedBase', '-')}`",
        "",
        "## Policy Scores",
        "",
        "| Policy | Score | Avg reward | Avg steps | Avg ticks | Avg births | Avg deaths |",
        "|---|---:|---:|---:|---:|---:|---:|",
        (
            f"| latest | {fmt(latest.get('score'))} | {fmt(latest.get('avg_reward'), 2)} | "
            f"{fmt(latest.get('avg_steps'), 2)} | {fmt(latest.get('avg_ticks'), 2)} | "
            f"{fmt(latest.get('avg_births'), 2)} | {fmt(latest.get('avg_deaths'), 2)} |"
        ),
        (
            f"| best_before | {fmt(best_before.get('score'))} | {fmt(best_before.get('avg_reward'), 2)} | "
            f"{fmt(best_before.get('avg_steps'), 2)} | {fmt(best_before.get('avg_ticks'), 2)} | "
            f"{fmt(best_before.get('avg_births'), 2)} | {fmt(best_before.get('avg_deaths'), 2)} |"
        ),
        "",
        "## Promotion Guardrails",
        "",
        f"- `min_improve`: `{fmt(thresholds.get('min_improve'))}`",
        f"- `require_positive_lcb`: `{thresholds.get('require_positive_lcb', False)}`",
        f"- `lcb_z`: `{fmt(thresholds.get('lcb_z'))}`",
    ]

    if paired:
        lines.extend([
            "",
            "## Paired Statistics",
            "",
            f"- Episode pairs: `{paired.get('count', 0)}`",
            f"- Mean delta: `{fmt(paired.get('mean_delta'))}`",
            f"- Standard error: `{fmt(paired.get('se_delta'))}`",
            f"- Lower confidence bound: `{fmt(paired.get('lower_bound'))}`",
        ])

    if diagnostic and diagnostic.get("enabled"):
        latest_diag = diagnostic.get("latest") or {}
        best_diag = diagnostic.get("best_before") or {}
        lines.extend([
            "",
            "## Diagnostic Ensemble (Non-Blocking)",
            "",
            (
                "- `ensemble_score = rpt_score + 0.05 * (deep_aux - 0.5)` "
                "(reported for diagnostics only)."
            ),
            (
                f"- Latest: `rpt={fmt(latest_diag.get('rpt_score'))}`, "
                f"`deep_aux={fmt(latest_diag.get('deep_aux'))}`, "
                f"`ensemble={fmt(latest_diag.get('ensemble_score'))}`"
            ),
            (
                f"- Best before: `rpt={fmt(best_diag.get('rpt_score'))}`, "
                f"`deep_aux={fmt(best_diag.get('deep_aux'))}`, "
                f"`ensemble={fmt(best_diag.get('ensemble_score'))}`"
            ),
            f"- Delta ensemble: `{fmt(diagnostic.get('delta_ensemble_score'))}`",
            (
                "- Deep auxiliary channels use eval aggregates from "
                "`avg_under_*` (`readiness`, `depth`, `champion`, `combat_pressure`)."
            ),
            f"- Note: {diagnostic.get('notes', '-')}",
        ])

    lines.extend([
        "",
        "## Metric Glossary",
        "",
        "- `score`: aggregate promotion metric (`reward`, `rps`, or `rpt` depending on `evalScore`).",
        "- `delta_score`: `latest_score - best_score_before`.",
        "- `min_improve`: minimum score delta required to allow promotion.",
        "- `lower_bound`: one-sided paired confidence lower bound for episode deltas.",
        "- `promoted`: true when latest checkpoint replaces best checkpoint.",
    ])
    return "\n".join(lines) + "\n"


# Function: write_report_files.
def write_report_files(json_path, markdown_path, payload):
    if json_path:
        ensure_parent_dir(json_path)
        with open(json_path, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2)
    if markdown_path:
        ensure_parent_dir(markdown_path)
        with open(markdown_path, "w", encoding="utf-8") as handle:
            handle.write(render_report_markdown(payload))


# Function: parse_args.
def parse_args():
    pre_parser = argparse.ArgumentParser(add_help=False)
    pre_parser.add_argument("--config", type=str, default="config.json")
    pre_args, _ = pre_parser.parse_known_args()

    config = train.load_config(pre_args.config)
    train_defaults = train.build_training_defaults(config)
    defaults = build_promote_defaults(config, train_defaults)

    parser = argparse.ArgumentParser(description="Evaluate latest policy and promote to best if improved.")
    parser.add_argument("--config", type=str, default=pre_args.config)
    parser.add_argument("--model-path", type=str, default=train_defaults["model_path"])
    parser.add_argument("--model-state-path", type=str, default=train_defaults["model_state_path"])
    parser.add_argument("--best-model-path", type=str, default=train_defaults["best_model_path"])
    parser.add_argument("--best-model-meta-path", type=str, default=train_defaults["best_model_meta_path"])
    parser.add_argument("--best-model-state-path", type=str, default=train_defaults["best_model_state_path"])
    parser.add_argument("--eval-episodes", type=int, default=defaults["eval_episodes"])
    parser.add_argument("--eval-max-steps", type=int, default=defaults["eval_max_steps"])
    parser.add_argument("--eval-difficulty", type=float, default=defaults["eval_difficulty"])
    parser.add_argument("--eval-score", type=str, default=defaults["eval_score"])
    parser.add_argument("--max-steps", type=int, default=defaults["max_steps"])
    parser.add_argument("--step-ticks", type=int, default=defaults["step_ticks"])
    parser.add_argument("--transport", type=str, default=train_defaults.get("transport", train.TRANSPORT_LEGACY))
    parser.add_argument("--difficulty-end", type=float, default=defaults["difficulty_end"])
    parser.add_argument("--seed", type=int, default=defaults["seed"])
    parser.add_argument("--debug-mode", type=str, default=train_defaults["debug_mode"])
    parser.add_argument("--min-improve", type=float, default=defaults["min_improve"])
    parser.add_argument(
        "--require-positive-lcb",
        dest="require_positive_lcb",
        action="store_true",
        default=defaults["require_positive_lcb"],
    )
    parser.add_argument(
        "--no-require-positive-lcb",
        dest="require_positive_lcb",
        action="store_false",
        help="Disable paired lower-confidence-bound promotion guard.",
    )
    parser.add_argument("--lcb-z", type=float, default=defaults["lcb_z"])
    parser.add_argument(
        "--eval-progress",
        dest="eval_progress",
        action="store_true",
        default=None,
        help="Enable partial episode progress logs (auto-enabled for --eval-only).",
    )
    parser.add_argument(
        "--no-eval-progress",
        dest="eval_progress",
        action="store_false",
        help="Disable partial episode progress logs.",
    )
    parser.add_argument(
        "--eval-progress-every",
        type=int,
        default=defaults["eval_progress_every"],
        help="Emit partial eval logs every N episodes when progress logs are enabled.",
    )
    parser.add_argument("--eval-only", action="store_true", default=False)
    parser.add_argument("--report-json", type=str, default=None)
    parser.add_argument("--report-md", type=str, default=None)
    parser.add_argument("--report-tag", type=str, default=None)
    return parser.parse_args()


# Function: build_eval_only_payload.
def build_eval_only_payload(stats, score):
    return {
        "avg_reward": float(stats.get("avg_reward", 0.0)),
        "avg_steps": float(stats.get("avg_steps", 0.0)),
        "avg_births": float(stats.get("avg_births", 0.0)),
        "avg_deaths": float(stats.get("avg_deaths", 0.0)),
        "score": float(score),
    }


# Function: print_best_saved_line.
def print_best_saved_line(reason, score, model_path, meta_path):
    line = (
        f"[BEST SAVED] reason={reason} score={score:.4f} "
        f"model={model_path} meta={meta_path}"
    )
    print(train.tint(line, BEST_SAVE_COLOR))


# Function: promote_latest_to_best.
def promote_latest_to_best(
    args,
    latest_stats,
    latest_score,
    eval_score_mode,
    reason,
    eval_context=None,
):
    print(
        f"Promoting latest policy (score={latest_score:.4f}) to best: {args.best_model_path}"
    )
    best_dir = os.path.dirname(args.best_model_path)
    if best_dir:
        os.makedirs(best_dir, exist_ok=True)
    shutil.copyfile(args.model_path, args.best_model_path)
    if (
        args.model_state_path
        and args.best_model_state_path
        and os.path.exists(args.model_state_path)
    ):
        best_state_dir = os.path.dirname(args.best_model_state_path)
        if best_state_dir:
            os.makedirs(best_state_dir, exist_ok=True)
        shutil.copyfile(args.model_state_path, args.best_model_state_path)
        print(
            f"Promoted optimizer state: {args.model_state_path} -> {args.best_model_state_path}"
        )
    train.save_best_meta(
        args.best_model_meta_path,
        latest_stats,
        0,
        latest_score,
        eval_score_mode,
        eval_context,
    )
    print_best_saved_line(
        reason,
        latest_score,
        args.best_model_path,
        args.best_model_meta_path,
    )


# Function: main.
def main():
    args = parse_args()
    train.configure_torch_threads()

    if args.config and not os.path.exists(args.config):
        raise SystemExit(f"Missing config file: {args.config}")

    config = train.load_config(args.config)
    train_defaults = train.build_training_defaults(config)

    resources = train.get_resources_from_config(config)
    resources = train.append_festival_action(resources, config)
    resources = train.append_governor_actions(resources, config)
    if not resources:
        raise SystemExit("No resources available for evaluation. Check config.json.")

    scenario_defs = train.get_scenario_definitions(config)
    eval_scenarios = train.get_eval_scenarios(config, scenario_defs)

    model_payload = load_policy_payload(args.model_path)
    model_payload["__path"] = args.model_path
    best_payload = None
    if args.best_model_path and os.path.exists(args.best_model_path):
        best_payload = load_policy_payload(args.best_model_path)
        best_payload["__path"] = args.best_model_path

    config_resources = resolve_policy_list(None, resources)
    model_settings = resolve_policy_settings(model_payload, config, train_defaults, resources)
    if config_resources and model_settings["resources"] != config_resources:
        raise SystemExit(
            "Latest policy resources do not match config resources. "
            "Run with --fresh after changing resource lists."
        )
    if model_settings.get("normalization_obs_mismatch"):
        raise SystemExit(
            "Latest policy observation normalization shape mismatch. "
            "Run with --fresh."
        )
    if model_settings.get("normalization_return_mismatch"):
        raise SystemExit(
            "Latest policy return normalization shape mismatch. "
            "Run with --fresh."
        )
    if model_settings.get("normalization_version") not in (None, 1):
        raise SystemExit(
            "Latest policy normalization metadata version is unsupported."
        )
    if best_payload:
        best_settings = resolve_policy_settings(best_payload, config, train_defaults, resources)
        if config_resources and best_settings["resources"] != config_resources:
            raise SystemExit(
                "Best policy resources do not match config resources. "
                "Run with --fresh after changing resource lists."
            )
        if best_settings.get("normalization_obs_mismatch"):
            raise SystemExit(
                "Best policy observation normalization shape mismatch. "
                "Run with --fresh."
            )
        if best_settings.get("normalization_return_mismatch"):
            raise SystemExit(
                "Best policy return normalization shape mismatch. "
                "Run with --fresh."
            )
        if best_settings.get("normalization_version") not in (None, 1):
            raise SystemExit(
                "Best policy normalization metadata version is unsupported."
            )
    else:
        best_settings = None

    if model_settings["invalid_features"]:
        print(
            "Warning: ignoring unknown feature names in latest policy: "
            + ", ".join(model_settings["invalid_features"]),
            file=sys.stderr,
        )
    if best_settings and best_settings["invalid_features"]:
        print(
            "Warning: ignoring unknown feature names in best policy: "
            + ", ".join(best_settings["invalid_features"]),
            file=sys.stderr,
        )

    eval_episodes = max(1, int(args.eval_episodes))
    eval_steps = int(args.eval_max_steps)
    if eval_steps <= 0:
        eval_steps = int(args.max_steps)
    eval_difficulty = args.eval_difficulty
    if eval_difficulty is None:
        eval_difficulty = args.difficulty_end
    if eval_difficulty is not None:
        eval_difficulty = train.clamp(float(eval_difficulty), 0.0, 1.0)
    eval_score_mode = str(args.eval_score or train_defaults["eval_score"] or "rpt").lower()
    args.transport = train.normalize_transport_mode(
        args.transport,
        train_defaults.get("transport", train.TRANSPORT_LEGACY),
    )
    eval_progress = args.eval_progress
    if eval_progress is None:
        eval_progress = bool(args.eval_only)
    eval_progress_every = max(1, int(args.eval_progress_every))
    seed_base = (args.seed + 100000) if args.seed is not None else None
    eval_context = {
        "source": "promote_best",
        "config": str(args.config),
        "reportTag": str(args.report_tag) if args.report_tag else None,
        "evalEpisodes": int(eval_episodes),
        "evalMaxSteps": int(eval_steps),
        "evalDifficulty": float(eval_difficulty) if eval_difficulty is not None else None,
        "evalScore": str(eval_score_mode),
        "maxSteps": int(args.max_steps),
        "stepTicks": int(args.step_ticks),
        "seedBase": int(seed_base) if seed_base is not None else None,
        "minImprove": float(args.min_improve),
        "requirePositiveLcb": bool(args.require_positive_lcb),
        "lcbZ": float(args.lcb_z),
        "evalProgress": bool(eval_progress),
        "evalProgressEvery": int(eval_progress_every),
        "transport": str(args.transport),
    }

    env = os.environ.copy()
    if args.debug_mode:
        env["NODEDWARVES_DEBUG_MODE"] = str(args.debug_mode)
    server_command = build_ai_server_command(args.config)

    proc = subprocess.Popen(
        server_command,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        text=True,
        bufsize=1,
        env=env,
    )

    try:
        latest_stats, latest_score = evaluate_policy(
            proc,
            model_payload,
            model_settings["resources"],
            model_settings["feature_names"],
            model_settings["hidden_sizes"],
            model_settings["activation"],
            model_settings["min_weight"],
            model_settings["max_weight"],
            eval_steps,
            args.step_ticks,
            eval_episodes,
            seed_base,
            eval_difficulty,
            eval_score_mode,
            eval_scenarios,
            collect_episode_scores=args.require_positive_lcb,
            progress=eval_progress,
            progress_every=eval_progress_every,
            progress_prefix="eval_latest",
            obs_normalization=model_settings["obs_normalization"],
            transport=args.transport,
        )

        if args.eval_only:
            report_payload = build_report_payload(
                args,
                eval_context,
                latest_stats,
                latest_score,
                None,
                None,
                False,
                "eval_only",
            )
            write_report_files(args.report_json, args.report_md, report_payload)
            if args.report_json:
                print(f"Report JSON: {args.report_json}")
            if args.report_md:
                print(f"Report MD: {args.report_md}")
            print("EVAL_ONLY " + json.dumps(build_eval_only_payload(latest_stats, latest_score), sort_keys=True))
            return

        best_stats = None
        best_score = None
        paired_stats = None
        if best_payload and args.best_model_path != args.model_path:
            best_stats, best_score = evaluate_policy(
                proc,
                best_payload,
                best_settings["resources"],
                best_settings["feature_names"],
                best_settings["hidden_sizes"],
                best_settings["activation"],
                best_settings["min_weight"],
                best_settings["max_weight"],
                eval_steps,
                args.step_ticks,
                eval_episodes,
                seed_base,
                eval_difficulty,
                eval_score_mode,
                eval_scenarios,
                collect_episode_scores=args.require_positive_lcb,
                progress=eval_progress,
                progress_every=eval_progress_every,
                progress_prefix="eval_best",
                obs_normalization=best_settings["obs_normalization"],
                transport=args.transport,
            )

        if best_score is None:
            promote_latest_to_best(
                args,
                latest_stats,
                latest_score,
                eval_score_mode,
                "best_missing",
                eval_context,
            )
            report_payload = build_report_payload(
                args,
                eval_context,
                latest_stats,
                latest_score,
                None,
                None,
                True,
                "best_missing",
            )
            write_report_files(args.report_json, args.report_md, report_payload)
            if args.report_json:
                print(f"Report JSON: {args.report_json}")
            if args.report_md:
                print(f"Report MD: {args.report_md}")
            return

        delta = latest_score - best_score
        if args.require_positive_lcb:
            paired_stats = compute_paired_delta_stats(
                latest_stats.get("episode_scores"),
                best_stats.get("episode_scores"),
                args.lcb_z,
            )
        print(
            "Promotion check: "
            f"latest_score={latest_score:.4f} best_score={best_score:.4f} "
            f"delta={delta:.4f} min_improve={args.min_improve:.4f}"
        )
        if paired_stats:
            print(
                "Paired check: "
                f"n={paired_stats['count']} mean_delta={paired_stats['mean_delta']:.4f} "
                f"se={paired_stats['se_delta']:.4f} lcb={paired_stats['lower_bound']:.4f}"
            )
            print_paired_episode_deltas(
                latest_stats.get("episode_scores"),
                best_stats.get("episode_scores"),
            )
        promote_allowed = delta >= args.min_improve
        promote_reason = "score_improved"
        if args.require_positive_lcb and paired_stats:
            promote_allowed = promote_allowed and paired_stats["lower_bound"] > 0.0
            promote_reason = "score_improved_lcb"
        promoted = False
        if promote_allowed:
            if paired_stats:
                eval_context["paired"] = {
                    "count": int(paired_stats["count"]),
                    "meanDelta": float(paired_stats["mean_delta"]),
                    "stdDelta": float(paired_stats["std_delta"]),
                    "seDelta": float(paired_stats["se_delta"]),
                    "lowerBound": float(paired_stats["lower_bound"]),
                }
            promote_latest_to_best(
                args,
                latest_stats,
                latest_score,
                eval_score_mode,
                promote_reason,
                eval_context,
            )
            promoted = True
        else:
            print("Best policy retained.")
        report_payload = build_report_payload(
            args,
            eval_context,
            latest_stats,
            latest_score,
            best_stats,
            best_score,
            promoted,
            promote_reason if promoted else "best_retained",
            delta_score=delta,
            paired_stats=paired_stats,
        )
        write_report_files(args.report_json, args.report_md, report_payload)
        if args.report_json:
            print(f"Report JSON: {args.report_json}")
        if args.report_md:
            print(f"Report MD: {args.report_md}")
    finally:
        try:
            train.send(proc, {"cmd": "close"})
        except Exception:
            pass
        proc.terminate()


if __name__ == "__main__":
    main()
