"""Paired evaluation for the training workbook.

Mode A (default): canonical semantics through train.evaluate (one decision every --step-ticks ticks).
Mode B (--hold k): decide every k ticks but advance and reward one tick at a time, so the per-tick
score is comparable across decision cadences.

Example:
  .venv/bin/python experiments/training_workbook/eval_paired.py \
    --policy experiments/training_workbook/runs/current/start.json \
    --config experiments/training_workbook/runs/current/configs/config_canonical_promote.json \
    --out experiments/training_workbook/runs/current/eval_start.json
"""
import argparse
import json
import os
import subprocess
import sys
from concurrent.futures import ProcessPoolExecutor

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "python"))
import train  # noqa: E402
import promote_best as pb  # noqa: E402
import torch  # noqa: E402

STATE = {}


# Build the policy model and its resolved settings for one config.
def load_policy(path, config):
    defaults = train.build_training_defaults(config)
    resources = train.append_governor_actions(
        train.append_festival_action(train.get_resources_from_config(config), config), config
    )
    payload = pb.load_policy_payload(path)
    payload["__path"] = path
    settings = pb.resolve_policy_settings(payload, config, defaults, resources)
    model = pb.build_model_from_policy(
        payload, settings["resources"], settings["feature_names"], settings["hidden_sizes"],
        settings["activation"], observation_layout=settings["observation_layout"],
    )
    return model, settings, defaults


# Per-process setup for hold-mode workers.
def init_worker(policy, config_path):
    torch.set_num_threads(1)
    config = train.load_config(config_path)
    model, settings, defaults = load_policy(policy, config)
    proc = subprocess.Popen(train.build_ai_server_command(config_path), stdin=subprocess.PIPE,
                            stdout=subprocess.PIPE, text=True, bufsize=1, cwd=ROOT)
    STATE.update(model=model, settings=settings, proc=proc,
                 transport=defaults.get("transport", train.TRANSPORT_LEGACY))


# One hold-mode episode: decide every `hold` ticks, accumulate reward per tick.
def run_hold_episode(task):
    seed, scenario, hold, max_ticks = task
    settings, model, proc = STATE["settings"], STATE["model"], STATE["proc"]
    mode = train.normalize_transport_mode(STATE["transport"])
    response = train.send(proc, train.build_reset_payload(
        seed, training=True, eval_mode=True, randomize=False, difficulty=1.0, scenario=scenario,
        transport=mode, resources=settings["resources"], feature_names=settings["feature_names"],
        observation_layout=settings["observation_layout"]))
    total, ticks, done = 0.0, 0, False
    with train.inference_mode():
        while ticks < max_ticks and not done:
            vector = train.normalize_vector(train.vector_from_response(
                response, settings["resources"], settings["feature_names"], mode,
                observation_layout=settings["observation_layout"]), settings["obs_normalization"])
            action, _, _ = model.act(torch.as_tensor(vector, dtype=torch.float32).unsqueeze(0),
                                     settings["min_weight"], settings["max_weight"], deterministic=True)
            action = action.squeeze(0).tolist()
            for _ in range(hold):
                response = train.send(proc, train.build_step_message(action, settings["resources"], 1, transport=mode))
                total += float(response.get("reward", 0.0))
                ticks += 1
                if response.get("done") or ticks >= max_ticks:
                    done = bool(response.get("done"))
                    break
    info = response.get("info", {})
    return {"score": total / max(1, ticks), "ticks": ticks, "pop": info.get("population"),
            "births": info.get("births"), "deaths": info.get("deaths")}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--policy", required=True)
    parser.add_argument("--config", required=True)
    parser.add_argument("--episodes", type=int, default=24)
    parser.add_argument("--max-steps", type=int, default=1800)
    parser.add_argument("--step-ticks", type=int, default=2)
    parser.add_argument("--hold", type=int, default=0)
    parser.add_argument("--workers", type=int, default=7)
    parser.add_argument("--seed-base", type=int, default=100000)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    config = train.load_config(args.config)
    scenarios = train.get_eval_scenarios(config, train.get_scenario_definitions(config))
    plan = train.build_eval_plan(args.episodes, scenarios, args.seed_base)
    if args.hold > 0:
        max_ticks = args.max_steps * args.step_ticks
        tasks = [(seed, scenario, args.hold, max_ticks) for seed, scenario in plan]
        with ProcessPoolExecutor(args.workers, initializer=init_worker,
                                 initargs=(args.policy, args.config)) as executor:
            episodes = list(executor.map(run_hold_episode, tasks))
        scores = [episode["score"] for episode in episodes]
        extra = {"episodes_detail": episodes}
    else:
        model, settings, defaults = load_policy(args.policy, config)
        result = train.evaluate(
            None, model, settings["resources"], settings["feature_names"], args.max_steps, args.step_ticks,
            args.episodes, args.seed_base, 1.0, settings["min_weight"], settings["max_weight"], scenarios,
            score_mode="rpt", collect_episode_scores=True, obs_normalization=settings["obs_normalization"],
            transport=defaults.get("transport", train.TRANSPORT_LEGACY),
            observation_layout=settings["observation_layout"],
            parallel={"workers": args.workers, "config_path": args.config},
        )
        scores = result["episode_scores"]
        extra = {key: value for key, value in result.items() if key != "episode_scores"}
    payload = {"policy": args.policy, "config": args.config, "hold": args.hold, "plan": plan,
               "scores": scores, "mean": sum(scores) / len(scores), **extra}
    with open(args.out, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=1)
    print(json.dumps({"out": args.out, "mean": payload["mean"], "n": len(scores)}))


if __name__ == "__main__":
    main()
