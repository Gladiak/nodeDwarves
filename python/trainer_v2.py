"""Lean PPO trainer for action space v2 (STRATEGY.md step T2).

Runs one phase of a recipe run folder written by scripts/train_recipe.js:

    python python/trainer_v2.py --run <run dir> --phase <name> --rep <n>

Everything else comes from that folder: `recipe.json` (run shape: cadence, gamma, episodes, episode
ticks, snapshot starts, schedules, noise hold, policy lag) and `config_<phase>.json` (the game, plus
the algorithm hyperparameters in `ai.training.trainer`). The phase resumes from `p.json` when the
folder holds one and writes `p.json` / `p.state.pt` back.

Determinism: episode settings are pure functions of the run seed and episode number, every episode
reseeds its RNG, results are consumed in episode order, and episode e always plays the weights of
update max(0, batch(e) - policyLagBatches). Two runs of the same folder give identical weights.
"""

import argparse
import json
import math
import multiprocessing as mp
import os
import random
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import torch  # noqa: E402

from v2 import env  # noqa: E402
from v2.model import (  # noqa: E402
    ActorCritic, create_stats, load_policy, load_training_state, save_policy, save_training_state,
    set_value_scale, update_return_normalization, update_stats, value_scale,
)
from v2.ppo import ppo_update  # noqa: E402
from v2.rollout import weights_payload, worker_main  # noqa: E402


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--run", required=True, help="run folder written by scripts/train_recipe.js")
    parser.add_argument("--phase", required=True)
    parser.add_argument("--rep", type=int, required=True)
    return parser.parse_args()


# Algorithm hyperparameters from ai.training.trainer, with the invariants v2 relies on checked.
def read_hyperparameters(config):
    trainer = config["ai"]["training"]["trainer"]
    for key, expected in (("algorithm", "ppo"), ("observationLayout", "factored"),
                          ("transport", "compact"), ("activation", "tanh")):
        if trainer.get(key) != expected:
            raise SystemExit(f"ai.training.trainer.{key} must be {expected!r} for the v2 trainer")
    return {
        "gae_lambda": float(trainer["gaeLambda"]),
        "clip_range": float(trainer["clipRange"]),
        "target_kl": float(trainer["targetKl"]),
        "value_coef": float(trainer["valueCoef"]),
        "value_clip_range": float(trainer["valueClipRange"]),
        "value_huber_delta": float(trainer["valueHuberDelta"]),
        "max_grad_norm": float(trainer["maxGradNorm"]),
        "obs_norm": bool(trainer["obsNorm"]),
        "obs_clip": float(trainer["obsNormClip"]),
        "obs_epsilon": float(trainer["obsNormEpsilon"]),
        "return_norm": bool(trainer["returnNorm"]),
        "return_clip": float(trainer["returnNormClip"]),
        "return_epsilon": float(trainer["returnNormEpsilon"]),
        "return_max_count": float(trainer["returnNormMaxCount"]),
        "hidden_sizes": [int(size) for size in trainer["hiddenSizes"]],
        "feature_names": list(trainer["featureNames"]),
        "log_std_init": float(trainer["logStdInit"]),
    }


# One-line, parse-stable window summary.
def format_window(episode, window, lr, entropy_coef, ppo, log_std, actions, eps_per_min):
    n = max(1, len(window))
    mean = lambda key: sum(float(item[key] or 0) for item in window) / n  # noqa: E731
    snap = sum(1 for item in window if item["snapshot"]) / n
    ext = sum(1 for item in window if item["reason"] == "extinction") / n
    levers = [round(value, 3) for value, action in zip(log_std, actions) if env.is_lever(action)]
    ppo_label = ""
    if ppo["updates"]:
        u = ppo["updates"]
        ev = ppo["ev_sum"] / ppo["ev_n"] if ppo["ev_n"] else 0.0
        ppo_label = (f" ppo[kl={ppo['approx_kl'] / u:.4f} clip={ppo['clip_frac'] / u:.3f} "
                     f"v={ppo['value_loss'] / u:.4f} pg={ppo['policy_loss'] / u:.4f} "
                     f"ent={ppo['entropy'] / u:.4f} ev={ev:.3f} stop={ppo['early_stops']}]")
    line = (f"episode={episode} reward={mean('reward'):.2f} steps={mean('steps'):.1f} ticks={mean('ticks'):.0f} "
            f"pop={mean('population'):.1f} snap={snap:.2f} ext={ext:.2f} eps_pm={eps_per_min:.1f} "
            f"lr={lr:.6f} ent_coef={entropy_coef:.5f}{ppo_label} lever_log_std={levers}")
    record = {"episode": episode, "reward": mean("reward"), "steps": mean("steps"), "ticks": mean("ticks"),
              "population": mean("population"), "snapshot_share": snap, "extinction_share": ext,
              "eps_per_min": eps_per_min, "lr": lr, "entropy_coef": entropy_coef, "lever_log_std": levers}
    if ppo["updates"]:
        record.update({key: ppo[key] / ppo["updates"]
                       for key in ("approx_kl", "clip_frac", "value_loss", "policy_loss", "entropy")})
        record["explained_variance"] = ppo["ev_sum"] / ppo["ev_n"] if ppo["ev_n"] else None
    return line, record


def empty_ppo_window():
    return {"approx_kl": 0.0, "clip_frac": 0.0, "value_loss": 0.0, "policy_loss": 0.0, "entropy": 0.0,
            "updates": 0, "ev_sum": 0.0, "ev_n": 0, "early_stops": 0}


def main():
    args = parse_args()
    run_dir = os.path.abspath(args.run)
    with open(os.path.join(run_dir, "recipe.json"), "r", encoding="utf-8") as handle:
        run = json.load(handle)
    recipe = run["recipe"]
    names = [phase["name"] for phase in recipe["phases"]]
    if args.phase not in names:
        raise SystemExit(f"phase {args.phase!r} not in recipe ({', '.join(names)})")
    phase_index = names.index(args.phase)
    phase_recipe = recipe["phases"][phase_index]
    config_path = os.path.join(run_dir, f"config_{args.phase}.json")
    with open(config_path, "r", encoding="utf-8") as handle:
        config = json.load(handle)
    hp = read_hyperparameters(config)

    step_ticks = int(recipe["stepTicks"])
    episodes = int(phase_recipe["episodes"])
    batch_episodes = int(phase_recipe["batchEpisodes"])
    lag = int(recipe["policyLagBatches"])
    workers = int(recipe["workers"])
    run_seed = int(recipe["seedBase"]) + args.rep * 1000 + phase_index * 101
    phase = {
        "difficulty_start": float(phase_recipe["difficultyStart"]),
        "difficulty_end": float(phase_recipe["difficultyEnd"]),
        "difficulty_ramp": max(1, round(episodes * float(phase_recipe["difficultyRampRatio"]))),
        "snapshot_prob": float(phase_recipe["snapshotProb"]),
    }
    hp.update({"epochs": int(phase_recipe["epochs"]), "mini_batch_size": int(phase_recipe["miniBatchSize"])})
    lr0, lr1 = float(phase_recipe["lr"]), float(phase_recipe["lrFinal"])
    ent0, ent1 = float(phase_recipe["entropyCoef"]), float(phase_recipe["entropyCoefFinal"])
    ent_ramp = int(phase_recipe["entropyRampEpisodes"])

    torch.set_num_threads(2)
    random.seed(run_seed)
    torch.manual_seed(run_seed)

    actions = env.action_ids(config)
    obs_size = env.observation_size(actions, hp["feature_names"])
    low = float(config["ai"].get("minWeight", 0.0))
    high = float(config["ai"].get("maxWeight", 2.0))
    model = ActorCritic(obs_size, len(actions), hp["hidden_sizes"], hp["log_std_init"])
    obs_stats = create_stats(obs_size, hp["obs_norm"], hp["obs_clip"], hp["obs_epsilon"])
    return_stats = create_stats(1, hp["return_norm"], hp["return_clip"], hp["return_epsilon"], hp["return_max_count"])
    optimizer = torch.optim.Adam(model.parameters(), lr=lr0)
    policy_path = os.path.join(run_dir, "p.json")
    state_path = os.path.join(run_dir, "p.state.pt")
    if os.path.exists(policy_path):
        load_policy(policy_path, model, actions, hp["feature_names"], step_ticks, obs_stats, return_stats)
        resumed_optimizer = load_training_state(state_path, optimizer)
        print(f"resumed from p.json (optimizer {'restored' if resumed_optimizer else 'fresh'})", flush=True)
    elif recipe.get("leverLogStdInit") is not None:
        # Fresh policy: lever heads may explore at their own scale (STRATEGY.md E40); job heads keep logStdInit.
        with torch.no_grad():
            for index, action in enumerate(actions):
                if env.is_lever(action):
                    model.log_std[index] = float(recipe["leverLogStdInit"])
    set_value_scale(model, *value_scale(return_stats))

    snapshots = env.list_snapshots(os.path.join(env.ROOT, run["bank"]) if run.get("bank") and phase["snapshot_prob"] > 0 else None)
    scenarios = env.training_scenarios(config)
    settings = {
        "config_path": config_path, "actions": actions, "feature_names": hp["feature_names"], "obs_size": obs_size,
        "low": low, "high": high, "hidden_sizes": hp["hidden_sizes"], "log_std_init": hp["log_std_init"],
        "obs_norm": hp["obs_norm"], "obs_clip": hp["obs_clip"], "obs_epsilon": hp["obs_epsilon"],
        "max_steps": int(phase_recipe["episodeTicks"]) // step_ticks, "step_ticks": step_ticks,
        "gamma": float(recipe["gamma"]), "gae_lambda": hp["gae_lambda"],
        "lever_noise_hold": int(recipe["leverNoiseHold"]), "full_sim": bool(phase_recipe["fullSim"]),
    }
    print(f"phase={args.phase} episodes={episodes} batch={batch_episodes} lag={lag} workers={workers} "
          f"seed={run_seed} step_ticks={step_ticks} max_steps={settings['max_steps']} obs={obs_size} "
          f"actions={len(actions)} snapshots={len(snapshots)} scenarios={len(scenarios)}", flush=True)

    ctx = mp.get_context("spawn")
    task_queue = ctx.Queue()
    result_queue = ctx.Queue()
    processes = [ctx.Process(target=worker_main, args=(task_queue, result_queue, settings), daemon=True)
                 for _ in range(workers)]
    for process in processes:
        process.start()

    metrics_path = os.path.join(run_dir, f"metrics_{args.phase}.jsonl")
    log_every = max(10, round(episodes / 48))
    versions = {0: weights_payload(model, obs_stats)}
    version = 0
    required = lambda e: max(0, (e - 1) // batch_episodes - lag)  # noqa: E731
    next_episode = 1
    in_flight = 0
    buffered = {}
    batch = {key: [] for key in ("obs", "obs_raw", "actions", "log_probs", "returns", "advantages", "values")}
    batch_count = 0
    window = []
    ppo_window = empty_ppo_window()
    run_start = time.perf_counter()
    entropy_coef = ent0

    def schedule():
        nonlocal next_episode, in_flight
        while in_flight < workers and next_episode <= episodes and required(next_episode) <= version:
            spec = env.episode_spec(run_seed, next_episode, phase, scenarios, snapshots)
            v = required(next_episode)
            task_queue.put((spec, v, versions[v]))
            in_flight += 1
            next_episode += 1
        oldest_needed = required(next_episode) if next_episode <= episodes else version
        for stale in [v for v in versions if v < oldest_needed]:
            del versions[stale]

    def flush(current_episode):
        nonlocal batch_count, version, entropy_coef
        if batch_count == 0:
            return
        entropy_coef = ent0 + (ent1 - ent0) * min(1.0, current_episode / max(1, ent_ramp))
        update_return_normalization(model, return_stats, batch["returns"])
        stats = ppo_update(model, optimizer, batch, low, high, hp, entropy_coef, return_stats)
        update_stats(obs_stats, batch["obs_raw"])
        for key in ("approx_kl", "clip_frac", "value_loss", "policy_loss", "entropy"):
            ppo_window[key] += stats[key] * stats["updates"]
        ppo_window["updates"] += stats["updates"]
        ppo_window["early_stops"] += int(stats["early_stop"])
        if stats["explained_variance"] is not None:
            ppo_window["ev_sum"] += stats["explained_variance"]
            ppo_window["ev_n"] += 1
        for values in batch.values():
            values.clear()
        batch_count = 0
        version += 1
        versions[version] = weights_payload(model, obs_stats)

    try:
        schedule()
        completed = 0
        while completed < episodes:
            kind, episode, rollout, summary = result_queue.get()
            if kind == "error":
                raise RuntimeError(f"worker failed on episode {episode}:\n{rollout}")
            in_flight -= 1
            buffered[episode] = (rollout, summary)
            while completed + 1 in buffered:
                rollout, summary = buffered.pop(completed + 1)
                completed += 1
                for key in ("obs", "obs_raw", "actions", "log_probs", "returns", "advantages", "values"):
                    batch[key].extend(rollout[key])
                batch_count += 1
                window.append(summary)
                if batch_count >= batch_episodes:
                    flush(completed)
                lr = lr0 + (lr1 - lr0) * completed / max(1, episodes)
                for group in optimizer.param_groups:
                    group["lr"] = lr
                if completed == 1 or completed % log_every == 0 or completed == episodes:
                    elapsed = time.perf_counter() - run_start
                    line, record = format_window(completed, window, lr, entropy_coef, ppo_window,
                                                 model.log_std.detach().tolist(), actions,
                                                 completed / elapsed * 60.0 if elapsed > 0 else 0.0)
                    print(line, flush=True)
                    with open(metrics_path, "a", encoding="utf-8") as handle:
                        handle.write(json.dumps(record) + "\n")
                    window = []
                    ppo_window = empty_ppo_window()
            schedule()
        flush(completed)
        save_policy(policy_path, model, actions, hp["feature_names"], low, high, obs_stats, return_stats, step_ticks)
        save_training_state(state_path, optimizer, completed)
        print(f"saved {policy_path} after {completed} episodes", flush=True)
    finally:
        for _ in processes:
            task_queue.put(None)
        for process in processes:
            process.join(timeout=10)
            if process.is_alive():
                process.terminate()


if __name__ == "__main__":
    main()
