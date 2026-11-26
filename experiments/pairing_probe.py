"""Pairing probe (STRATEGY.md E40): do paired branches make lever effects cheaper to measure?

From each start state (bank snapshots), four rollouts of `--ticks` play the council-midpoint levers
plus held exploration noise (one draw per `--hold` decisions, the pre-tanh sigma of the trainer):

    R(+e, s)  R(-e, s)    same game seed s, antithetic lever noise
    R(+e, t)  R(-e, t)    another game seed t

The lever-effect estimate is a return difference. Paired: R(+e,s) - R(-e,s). Unpaired: R(+e,s) - R(-e,t).
Var(unpaired) / Var(paired) is the sample-efficiency multiplier pairing would give the trainer: how
many independent episodes one antithetic pair is worth. Var(R(+e,s) - R(+e,t)) is the pure game noise.

    .venv/bin/python experiments/pairing_probe.py --config <phase config> --bank <bank dir> \
        --starts 48 --ticks 2800 --hold 20 --workers 7 --out <file.json>
"""

import argparse
import json
import math
import os
import random
import sys
from multiprocessing import Pool

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "python"))

from v2 import env  # noqa: E402

_SERVER = None
_SETTINGS = None


def init_worker(settings):
    global _SERVER, _SETTINGS
    _SETTINGS = settings
    _SERVER = env.Server(settings["config"])


# One rollout: midpoint levers plus sign * held noise, job weights neutral; returns the reward sum.
def rollout(task):
    snapshot, game_seed, noise_seed, sign = task
    s = _SETTINGS
    rng = random.Random(noise_seed)
    steps = s["ticks"] // s["step_ticks"]
    holds = math.ceil(steps / s["hold"])
    noise = [[rng.gauss(0.0, s["sigma"]) for _ in s["levers"]] for _ in range(holds)]
    spec = {"episode": 0, "seed": game_seed, "difficulty": 1.0, "scenario": None, "snapshot": snapshot}
    response = _SERVER.reset(spec, s["actions"], s["features"], False)
    total = 0.0
    played = 0
    for step in range(steps):
        draw = noise[step // s["hold"]]
        values = []
        lever_index = 0
        for action in s["actions"]:
            if env.is_lever(action):
                values.append(1.0 + math.tanh(sign * draw[lever_index]))
                lever_index += 1
            else:
                values.append(1.0)
        response = _SERVER.step(values, s["step_ticks"])
        total += float(response.get("reward", 0.0))
        played = step + 1
        if response.get("done"):
            break
    return {"snapshot": os.path.basename(snapshot), "seed": game_seed, "sign": sign, "reward": total,
            "steps": played, "population": (response.get("info") or {}).get("population")}


def variance(values):
    mean = sum(values) / len(values)
    return sum((value - mean) ** 2 for value in values) / max(1, len(values) - 1)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    parser.add_argument("--bank", required=True)
    parser.add_argument("--starts", type=int, default=48)
    parser.add_argument("--ticks", type=int, default=2800)
    parser.add_argument("--hold", type=int, default=20)
    parser.add_argument("--step-ticks", type=int, default=10)
    parser.add_argument("--sigma", type=float, default=math.exp(-0.8))
    parser.add_argument("--workers", type=int, default=7)
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    config = json.load(open(args.config, "r", encoding="utf-8"))
    actions = env.action_ids(config)
    files = env.list_snapshots(args.bank)
    rng = random.Random(args.seed)
    starts = sorted(rng.sample(files, min(args.starts, len(files))))
    settings = {"config": os.path.abspath(args.config), "actions": actions, "levers": [a for a in actions if env.is_lever(a)],
                "features": config["ai"]["training"]["trainer"]["featureNames"], "ticks": args.ticks,
                "hold": args.hold, "step_ticks": args.step_ticks, "sigma": args.sigma}
    tasks = []
    for index, snapshot in enumerate(starts):
        s, t, noise = 500000 + index * 2, 500001 + index * 2, 900000 + index
        for seed in (s, t):
            for sign in (1.0, -1.0):
                tasks.append((snapshot, seed, noise, sign))
    with Pool(args.workers, initializer=init_worker, initargs=(settings,)) as pool:
        results = pool.map(rollout, tasks, chunksize=1)

    groups = [results[i:i + 4] for i in range(0, len(results), 4)]
    paired, unpaired, game_noise, single = [], [], [], []
    for plus_s, minus_s, plus_t, minus_t in groups:
        r = lambda x: x["reward"]  # noqa: E731
        paired += [r(plus_s) - r(minus_s), r(plus_t) - r(minus_t)]
        unpaired += [r(plus_s) - r(minus_t), r(plus_t) - r(minus_s)]
        game_noise += [r(plus_s) - r(plus_t), r(minus_s) - r(minus_t)]
        single += [r(plus_s), r(minus_s), r(plus_t), r(minus_t)]
    summary = {
        "starts": len(groups), "ticks": args.ticks, "hold": args.hold, "sigma": args.sigma,
        "var_single_return": variance(single),
        "var_paired_diff": variance(paired),
        "var_unpaired_diff": variance(unpaired),
        "var_game_noise_diff": variance(game_noise),
        "efficiency_multiplier": variance(unpaired) / max(1e-9, variance(paired)),
        "paired_share_of_game_noise": variance(paired) / max(1e-9, variance(game_noise)),
    }
    with open(args.out, "w", encoding="utf-8") as handle:
        json.dump({"summary": summary, "rollouts": results}, handle, indent=1)
    print(json.dumps(summary, indent=1))


if __name__ == "__main__":
    main()
