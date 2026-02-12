import argparse
import json
import os
import shutil
import subprocess
import sys

import train

BEST_SAVE_COLOR = getattr(train, "BEST_EVAL_COLOR", "\033[96m")


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


# Function: resolve_policy_settings.
def resolve_policy_settings(payload, config, defaults, resources):
    feature_names, invalid = train.resolve_feature_names(
        payload.get("featureNames"),
        defaults["feature_names"],
    )
    ai_config = (config.get("ai", {}) or {}) if isinstance(config, dict) else {}
    min_weight = resolve_weight_limit(payload.get("minWeight"), ai_config.get("minWeight", 0.0))
    max_weight = resolve_weight_limit(payload.get("maxWeight"), ai_config.get("maxWeight", 2.0))
    return {
        "resources": resolve_policy_list(payload.get("resources"), resources),
        "feature_names": feature_names,
        "invalid_features": invalid,
        "hidden_sizes": resolve_hidden_sizes(payload.get("hiddenSizes"), defaults["hidden_sizes"]),
        "activation": str(payload.get("activation") or defaults["activation"] or "tanh").lower(),
        "min_weight": min_weight,
        "max_weight": max_weight,
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
    )
    score = train.compute_score(
        stats["avg_reward"],
        stats["avg_steps"],
        stats.get("avg_ticks", 0.0),
        eval_score_mode,
    )
    return stats, score


# Function: parse_args.
def parse_args():
    pre_parser = argparse.ArgumentParser(add_help=False)
    pre_parser.add_argument("--config", type=str, default="config.json")
    pre_args, _ = pre_parser.parse_known_args()

    config = train.load_config(pre_args.config)
    defaults = train.build_training_defaults(config)

    parser = argparse.ArgumentParser(description="Evaluate latest policy and promote to best if improved.")
    parser.add_argument("--config", type=str, default=pre_args.config)
    parser.add_argument("--model-path", type=str, default=defaults["model_path"])
    parser.add_argument("--best-model-path", type=str, default=defaults["best_model_path"])
    parser.add_argument("--best-model-meta-path", type=str, default=defaults["best_model_meta_path"])
    parser.add_argument("--eval-episodes", type=int, default=defaults["eval_episodes"])
    parser.add_argument("--eval-max-steps", type=int, default=defaults["eval_max_steps"])
    parser.add_argument("--eval-difficulty", type=float, default=defaults["eval_difficulty"])
    parser.add_argument("--eval-score", type=str, default=defaults["eval_score"])
    parser.add_argument("--max-steps", type=int, default=defaults["max_steps"])
    parser.add_argument("--step-ticks", type=int, default=defaults["step_ticks"])
    parser.add_argument("--difficulty-end", type=float, default=defaults["difficulty_end"])
    parser.add_argument("--seed", type=int, default=defaults["seed"])
    parser.add_argument("--debug-mode", type=str, default=defaults["debug_mode"])
    parser.add_argument("--min-improve", type=float, default=0.0)
    parser.add_argument("--eval-only", action="store_true", default=False)
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
def promote_latest_to_best(args, latest_stats, latest_score, eval_score_mode, reason):
    print(
        f"Promoting latest policy (score={latest_score:.4f}) to best: {args.best_model_path}"
    )
    best_dir = os.path.dirname(args.best_model_path)
    if best_dir:
        os.makedirs(best_dir, exist_ok=True)
    shutil.copyfile(args.model_path, args.best_model_path)
    train.save_best_meta(
        args.best_model_meta_path,
        latest_stats,
        0,
        latest_score,
        eval_score_mode,
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
    defaults = train.build_training_defaults(config)

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
    model_settings = resolve_policy_settings(model_payload, config, defaults, resources)
    if config_resources and model_settings["resources"] != config_resources:
        raise SystemExit(
            "Latest policy resources do not match config resources. "
            "Run with --fresh after changing resource lists."
        )
    if best_payload:
        best_settings = resolve_policy_settings(best_payload, config, defaults, resources)
        if config_resources and best_settings["resources"] != config_resources:
            raise SystemExit(
                "Best policy resources do not match config resources. "
                "Run with --fresh after changing resource lists."
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
    eval_score_mode = str(args.eval_score or defaults["eval_score"] or "rpt").lower()
    seed_base = (args.seed + 100000) if args.seed is not None else None

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
        )

        if args.eval_only:
            print("EVAL_ONLY " + json.dumps(build_eval_only_payload(latest_stats, latest_score), sort_keys=True))
            return

        best_stats = None
        best_score = None
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
            )

        if best_score is None:
            promote_latest_to_best(
                args,
                latest_stats,
                latest_score,
                eval_score_mode,
                "best_missing",
            )
            return

        delta = latest_score - best_score
        print(
            "Promotion check: "
            f"latest_score={latest_score:.4f} best_score={best_score:.4f} "
            f"delta={delta:.4f} min_improve={args.min_improve:.4f}"
        )
        if delta >= args.min_improve:
            promote_latest_to_best(
                args,
                latest_stats,
                latest_score,
                eval_score_mode,
                "score_improved",
            )
        else:
            print("Best policy retained.")
    finally:
        try:
            train.send(proc, {"cmd": "close"})
        except Exception:
            pass
        proc.terminate()


if __name__ == "__main__":
    main()
