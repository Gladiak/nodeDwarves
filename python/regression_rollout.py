#!/usr/bin/env python3
import argparse
import json
import os
import random
import subprocess
import sys
import time

import torch

import train


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


# Function: build_ai_server_command.
def build_ai_server_command(config_path):
    command = ["node", "ai_server.js"]
    if config_path:
        command.extend(["--config", str(config_path)])
    return command


# Function: parse_args.
def parse_args():
    pre_parser = argparse.ArgumentParser(add_help=False)
    pre_parser.add_argument("--config", type=str, default="config.json")
    pre_args, _ = pre_parser.parse_known_args()

    config = train.load_config(pre_args.config)
    defaults = train.build_training_defaults(config)

    parser = argparse.ArgumentParser(
        description="Run policy rollouts for randomized regression without PPO updates."
    )
    parser.add_argument("--config", type=str, default=pre_args.config)
    parser.add_argument("--model-path", type=str, default=defaults["best_model_path"])
    parser.add_argument("--episodes", type=int, default=defaults["episodes"])
    parser.add_argument("--max-steps", type=int, default=defaults["max_steps"])
    parser.add_argument("--step-ticks", type=int, default=defaults["step_ticks"])
    parser.add_argument("--transport", type=str, default=defaults.get("transport", train.TRANSPORT_LEGACY))
    parser.add_argument("--seed", type=int, default=defaults["seed"])
    parser.add_argument("--difficulty-start", type=float, default=defaults["difficulty_start"])
    parser.add_argument("--difficulty-end", type=float, default=defaults["difficulty_end"])
    parser.add_argument("--difficulty-ramp", type=int, default=defaults["difficulty_ramp"])
    parser.add_argument("--gamma", type=float, default=defaults["gamma"])
    parser.add_argument("--gae-lambda", type=float, default=defaults["gae_lambda"])
    parser.add_argument("--lr", type=float, default=defaults["lr"])
    parser.add_argument("--lr-final", type=float, default=defaults["lr_final"])
    parser.add_argument("--debug-mode", type=str, default=defaults["debug_mode"])
    parser.add_argument("--full-sim", action="store_true", default=False)
    parser.add_argument("--summary-path", type=str, required=True)
    return parser.parse_args()


# Function: build_model_and_policy_settings.
def build_model_and_policy_settings(args, config, defaults):
    resources = train.get_resources_from_config(config)
    resources = train.append_festival_action(resources, config)
    resources = train.append_governor_actions(resources, config)
    if not resources:
        raise SystemExit("No resources available for rollout. Check config.json.")

    payload = load_policy_payload(args.model_path)
    feature_names, invalid_features = train.resolve_feature_names(
        payload.get("featureNames"),
        defaults["feature_names"],
    )
    if invalid_features:
        print(
            "Warning: ignoring unknown feature names in policy: "
            + ", ".join(invalid_features),
            file=sys.stderr,
        )
    policy_resources = resolve_policy_list(payload.get("resources"), resources)
    if policy_resources != list(resources):
        raise SystemExit(
            "Policy action head does not match config resources. "
            "Run training with --fresh before regression."
        )

    hidden_sizes = resolve_hidden_sizes(payload.get("hiddenSizes"), defaults["hidden_sizes"])
    activation = str(payload.get("activation") or defaults["activation"] or "tanh").lower()
    ai_config = (config.get("ai") or {}) if isinstance(config, dict) else {}
    min_weight = resolve_weight_limit(payload.get("minWeight"), ai_config.get("minWeight", 0.0))
    max_weight = resolve_weight_limit(payload.get("maxWeight"), ai_config.get("maxWeight", 2.0))
    if max_weight < min_weight:
        min_weight, max_weight = max_weight, min_weight

    input_size = len(resources) * len(feature_names)
    action_size = len(resources)
    model = train.ActorCritic(
        input_size,
        action_size,
        hidden_sizes,
        activation,
        -0.5,
    )
    obs_fallback = train.create_running_stats(
        input_size,
        enabled=defaults["obs_norm"],
        clip=defaults["obs_norm_clip"],
        epsilon=defaults["obs_norm_epsilon"],
    )
    return_fallback = train.create_running_stats(
        1,
        enabled=defaults["return_norm"],
        clip=defaults["return_norm_clip"],
        epsilon=defaults["return_norm_epsilon"],
    )
    load_meta = train.load_policy(
        args.model_path,
        model,
        obs_fallback=obs_fallback,
        return_fallback=return_fallback,
    )
    if load_meta.get("normalization_obs_mismatch"):
        raise SystemExit(
            "Policy observation normalization shape mismatch. "
            "Run training with --fresh before regression."
        )
    if load_meta.get("normalization_return_mismatch"):
        raise SystemExit(
            "Policy return normalization shape mismatch. "
            "Run training with --fresh before regression."
        )
    if load_meta.get("normalization_version") not in (None, 1):
        raise SystemExit("Unsupported policy normalization metadata version.")
    obs_normalization = load_meta.get("obs_normalization") or obs_fallback
    return model, resources, feature_names, min_weight, max_weight, obs_normalization


# Function: run_rollouts.
def run_rollouts(
    args,
    config,
    model,
    resources,
    feature_names,
    min_weight,
    max_weight,
    obs_normalization,
):
    scenario_defs = train.get_scenario_definitions(config)
    training_scenarios = train.get_training_scenarios(scenario_defs)
    scenario_rng = random.Random(args.seed) if args.seed is not None else random.Random()
    episodes = max(1, int(args.episodes))
    max_steps = max(1, int(args.max_steps))
    difficulty_ramp = max(1, int(args.difficulty_ramp))

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

    total_reward = 0.0
    total_steps = 0.0
    total_births = 0.0
    total_deaths = 0.0
    debug_acc = train.init_debug_accumulator()
    last_info = {}
    last_difficulty = 0.0
    started_at = time.perf_counter()

    try:
        with train.inference_mode():
            for episode in range(1, episodes + 1):
                progress = min(1.0, (episode - 1) / difficulty_ramp)
                difficulty = args.difficulty_start + (
                    args.difficulty_end - args.difficulty_start
                ) * progress
                difficulty = train.clamp(float(difficulty), 0.0, 1.0)
                seed = (args.seed + episode) if args.seed is not None else None
                scenario = train.select_scenario(training_scenarios, scenario_rng, difficulty)
                _, reward, steps, info = train.run_episode(
                    proc,
                    model,
                    resources,
                    feature_names,
                    max_steps,
                    args.step_ticks,
                    seed,
                    difficulty,
                    min_weight,
                    max_weight,
                    scenario,
                    args.full_sim,
                    args.gamma,
                    args.gae_lambda,
                    obs_normalization=obs_normalization,
                    transport=args.transport,
                )
                total_reward += reward
                total_steps += float(steps)
                total_births += float(info.get("births", 0) or 0)
                total_deaths += float(info.get("deaths", 0) or 0)
                train.accumulate_debug(debug_acc, info)
                last_info = info or {}
                last_difficulty = difficulty
    finally:
        try:
            train.send(proc, {"cmd": "close"})
        except Exception:
            pass
        proc.terminate()

    elapsed = max(0.0, time.perf_counter() - started_at)
    avg_reward = total_reward / episodes
    avg_steps = total_steps / episodes
    avg_births = total_births / episodes
    avg_deaths = total_deaths / episodes
    final_lr = args.lr_final if args.lr_final is not None else args.lr
    debug_avg = train.average_debug(debug_acc) or {}
    summary_line = train.format_summary_line(
        episodes,
        1,
        episodes,
        avg_reward,
        avg_steps,
        avg_births,
        avg_deaths,
        final_lr,
        last_difficulty,
        last_info,
        debug_avg,
        [],
        train.get_scenario_target_mix(scenario_defs),
    )
    return {
        "summary_line": summary_line,
        "avg_reward": avg_reward,
        "avg_steps": avg_steps,
        "avg_births": avg_births,
        "avg_deaths": avg_deaths,
        "elapsed": elapsed,
    }


# Function: write_summary.
def write_summary(path, summary_line, config_path):
    summary_path = os.path.expanduser(path)
    if not os.path.isabs(summary_path):
        summary_path = os.path.join(train.get_project_root(), summary_path)
    os.makedirs(os.path.dirname(summary_path), exist_ok=True)
    with open(summary_path, "w", encoding="utf-8") as handle:
        handle.write("# NodeDwarves regression random rollout log\n")
        handle.write(f"start_time={time.strftime('%Y-%m-%d %H:%M:%S')}\n")
        handle.write(f"config={config_path}\n")
        handle.write(summary_line + "\n")


# Function: main.
def main():
    args = parse_args()
    train.configure_torch_threads()
    if args.seed is not None:
        random.seed(args.seed)
        torch.manual_seed(args.seed)

    config = train.load_config(args.config)
    defaults = train.build_training_defaults(config)
    args.transport = train.normalize_transport_mode(
        args.transport,
        defaults.get("transport", train.TRANSPORT_LEGACY),
    )
    model, resources, feature_names, min_weight, max_weight, obs_normalization = build_model_and_policy_settings(
        args, config, defaults
    )
    metrics = run_rollouts(
        args,
        config,
        model,
        resources,
        feature_names,
        min_weight,
        max_weight,
        obs_normalization,
    )
    write_summary(args.summary_path, metrics["summary_line"], args.config)
    print(
        "rollout "
        f"episodes={max(1, int(args.episodes))} "
        f"avg_reward={metrics['avg_reward']:.3f} "
        f"avg_steps={metrics['avg_steps']:.3f} "
        f"avg_births={metrics['avg_births']:.3f} "
        f"avg_deaths={metrics['avg_deaths']:.3f} "
        f"elapsed={metrics['elapsed']:.2f}s"
    )


if __name__ == "__main__":
    main()
