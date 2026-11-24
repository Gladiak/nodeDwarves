"""Paired policy evaluation (see STRATEGY.md, measurement protocol).

Mode A (default): canonical semantics through train.evaluate (one decision every --step-ticks ticks).
Mode B (--hold k): decide every k ticks but advance and reward one tick at a time, so the per-tick
score is comparable across decision cadences.
Mode C (--outcomes, or --policy default): canonical semantics plus final colony outcomes per episode
(population, deaths by cause, stockpile ratios). `--policy default` plays the same plan with the
game's built-in ai.defaultWeights (no policy), the baseline every trained policy must beat.
`--policy const:X` (every action value = X) and `--policy random` (uniform per decision, seeded by
the episode seed) probe how far the action space can move outcomes at all. `--policy group:<name>:X`
sets one governor group (jobs, festival, trade, building, contracts, ruins, underrealm, externalCamps,
warriors) to X and leaves the others on defaults; `--policy jobs:inv` inverts the default job weights.

Example:
  .venv/bin/python experiments/eval_paired.py \
    --policy experiments/runs/current/start.json \
    --config experiments/runs/current/configs/config_canonical_promote.json \
    --out experiments/runs/current/eval_start.json
"""
import argparse
import json
import os
import random
import subprocess
import sys
from concurrent.futures import ProcessPoolExecutor

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
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


# Per-process setup for outcome workers; policy "default" runs the game's built-in default weights.
def init_outcome_worker(policy, config_path):
    torch.set_num_threads(1)
    config = train.load_config(config_path)
    if policy == DEFAULT_POLICY:
        model, settings, mode = None, None, train.TRANSPORT_LEGACY
    elif is_synthetic_policy(policy):
        # Synthetic probes: constant or uniformly random action values over the full action space.
        ai = config.get("ai", {})
        resources = train.append_governor_actions(
            train.append_festival_action(train.get_resources_from_config(config), config), config)
        model, mode = policy, train.TRANSPORT_LEGACY
        settings = {"resources": resources, "feature_names": [], "observation_layout": None,
                    "min_weight": float(ai.get("minWeight", 0)), "max_weight": float(ai.get("maxWeight", 2))}
    else:
        model, settings, defaults = load_policy(policy, config)
        mode = train.normalize_transport_mode(defaults.get("transport", train.TRANSPORT_LEGACY))
    proc = subprocess.Popen(train.build_ai_server_command(config_path), stdin=subprocess.PIPE,
                            stdout=subprocess.PIPE, text=True, bufsize=1, cwd=ROOT)
    STATE.update(model=model, settings=settings, proc=proc, mode=mode)


# One canonical-semantics episode that also records final colony outcomes (not only reward).
def run_outcome_episode(task):
    seed, scenario, max_steps, step_ticks = task
    model, settings, proc, mode = STATE["model"], STATE["settings"], STATE["proc"], STATE["mode"]
    synthetic = isinstance(model, str)
    rng = random.Random(seed)
    layout = {} if settings is None or synthetic else {
        "resources": settings["resources"], "feature_names": settings["feature_names"],
        "observation_layout": settings["observation_layout"]}
    response = train.send(proc, train.build_reset_payload(
        seed, training=True, eval_mode=True, randomize=False, difficulty=1.0, scenario=scenario,
        transport=mode, **layout))
    start_pop = int(response["info"].get("population", 0))
    min_pop, total, steps = start_pop, 0.0, 0
    with train.inference_mode():
        for step in range(max_steps):
            last = step == max_steps - 1
            if model is None:
                # No action fields: the simulation falls back to ai.defaultWeights and governor defaults,
                # exactly as an interactive game started without --ai.
                message = {"cmd": "step", "action": {"ticks": step_ticks, **({"debug": True} if last else {})}}
            elif synthetic:
                message = build_synthetic_message(model, settings, step_ticks, rng, last)
            else:
                vector = train.normalize_vector(train.vector_from_response(
                    response, settings["resources"], settings["feature_names"], mode,
                    observation_layout=settings["observation_layout"]), settings["obs_normalization"])
                action, _, _ = model.act(torch.as_tensor(vector, dtype=torch.float32).unsqueeze(0),
                                         settings["min_weight"], settings["max_weight"], deterministic=True)
                message = train.build_step_message(action.squeeze(0).tolist(), settings["resources"],
                                                   step_ticks, transport=mode, debug=last)
            response = train.send(proc, message)
            total += float(response.get("reward", 0.0))
            steps += 1
            min_pop = min(min_pop, int(response["info"].get("population", 0)))
            if response.get("done"):
                break
    info = response.get("info", {})
    debug = info.get("debug") or {}
    stock = debug.get("stockpile") or {}
    # rpp = reward per planned tick, the promotion score: an early extinction counts as zero afterwards.
    return {"seed": seed, "scenario": scenario, "score": total / max(1, steps * step_ticks),
            "rpp": total / max(1, max_steps * step_ticks),
            "ticks": info.get("tick"), "done_reason": info.get("doneReason"),
            "start_pop": start_pop, "min_pop": min_pop, "pop": info.get("population"),
            "births": info.get("births"), "deaths": info.get("deaths"),
            "deaths_by_cause": debug.get("deathsByCause"),
            "stock_avg": stock.get("avgRatio"), "stock_min": stock.get("minRatio")}


DEFAULT_POLICY = "default"


# Action-envelope keys per governor group, for one-group probes (`group:<name>:<value>`).
GROUP_KEYS = {"jobs": "weights", "festival": "festivalIntent", "trade": "trade", "building": "building",
              "contracts": "contracts", "ruins": "ruins", "underrealm": "underrealm",
              "externalCamps": "externalCamps", "warriors": "warriors"}
# Job-weight probe that inverts the default priorities (essentials low, materials high).
JOBS_INVERTED = {"food": 0.4, "water": 0.4, "wood": 2.0, "stone": 2.0}


# Synthetic probe policies used to measure how much the action space can move outcomes.
def is_synthetic_policy(policy):
    text = str(policy)
    return text in ("random", "jobs:inv") or text.startswith("const:") or text.startswith("group:")


# Build one step message for a synthetic probe. Group probes set only one governor group and leave
# every other group on the game's defaults (missing action fields).
def build_synthetic_message(model, settings, step_ticks, rng, last):
    low, high = settings["min_weight"], settings["max_weight"]
    resources = settings["resources"]
    if model == "jobs:inv":
        action = {"ticks": step_ticks, "weights": dict(JOBS_INVERTED)}
        if last:
            action["debug"] = True
        return {"cmd": "step", "action": action}
    if model == "random":
        values = [rng.uniform(low, high) for _ in resources]
    else:
        values = [min(high, max(low, float(model.rsplit(":", 1)[1])))] * len(resources)
    message = train.build_step_message(values, resources, step_ticks, transport=train.TRANSPORT_LEGACY,
                                       debug=last)
    if model.startswith("group:"):
        key = GROUP_KEYS[model.split(":")[1]]
        message["action"] = {k: v for k, v in message["action"].items() if k in ("ticks", "debug", key)}
    return message


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
    parser.add_argument("--outcomes", action="store_true",
                        help="record final colony outcomes per episode (implied by --policy default)")
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    config = train.load_config(args.config)
    scenarios = train.get_eval_scenarios(config, train.get_scenario_definitions(config))
    plan = train.build_eval_plan(args.episodes, scenarios, args.seed_base)
    if args.policy == DEFAULT_POLICY or is_synthetic_policy(args.policy) or args.outcomes:
        if args.hold > 0:
            parser.error("--hold cannot be combined with --outcomes or --policy default")
        tasks = [(seed, scenario, args.max_steps, args.step_ticks) for seed, scenario in plan]
        with ProcessPoolExecutor(args.workers, initializer=init_outcome_worker,
                                 initargs=(args.policy, args.config)) as executor:
            episodes = list(executor.map(run_outcome_episode, tasks))
        scores = [episode["score"] for episode in episodes]
        extra = {"episodes_detail": episodes}
    elif args.hold > 0:
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
