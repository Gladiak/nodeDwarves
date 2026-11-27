"""Rollout workers. Each task names the exact weight version it must use and carries those weights,
and every episode reseeds its RNG from the episode number, so an episode's trajectory is the same on
any worker and at any timing."""

import io
import os
import random
import sys
import traceback

import torch

from v2 import env
from v2.model import ActorCritic, create_stats, import_stats, normalize
from v2.ppo import compute_gae


# Serialize model weights and observation statistics for one weight version.
def weights_payload(model, obs_stats):
    buffer = io.BytesIO()
    torch.save(model.state_dict(), buffer)
    return {"state": buffer.getvalue(), "obs": {key: obs_stats[key] for key in ("mean", "var", "count")}}


# Play one episode and return its transitions (with GAE) and a summary.
def run_episode(server, model, obs_stats, spec, settings):
    actions_ids = settings["actions"]
    size = settings["obs_size"]
    low, high = settings["low"], settings["high"]
    response = server.reset(spec, actions_ids, settings["feature_names"], settings["full_sim"])
    start_tick = int((response.get("info") or {}).get("tick", 0) or 0)
    hold = settings["lever_noise_hold"]
    lever_mask = torch.tensor([[1.0 if env.is_lever(a) else 0.0 for a in actions_ids]]) if hold > 1 else None
    held_noise = None
    rollout = {"obs": [], "obs_raw": [], "pre_tanh": [], "log_probs": [], "values": [], "rewards": [], "dones": []}
    done = terminated = False
    steps = 0
    total_reward = 0.0
    with torch.inference_mode():
        for step in range(settings["max_steps"]):
            raw = env.observation(response, size)
            vector = normalize(raw, obs_stats)
            obs_tensor = torch.as_tensor(vector, dtype=torch.float32).unsqueeze(0)
            noise = None
            if lever_mask is not None:
                # Lever heads keep one noise draw for `hold` decisions; job heads redraw every step.
                fresh = torch.randn(lever_mask.shape)
                if held_noise is None or step % hold == 0:
                    held_noise = fresh
                noise = lever_mask * held_noise + (1.0 - lever_mask) * fresh
            action, log_prob, value, pre_tanh = model.act(obs_tensor, low, high, noise=noise)
            action_values = action.squeeze(0).tolist()
            response = server.step(action_values, settings["step_ticks"])
            reward = float(response.get("reward", 0.0))
            done = bool(response.get("done"))
            reason = (response.get("info") or {}).get("doneReason")
            # Only true terminal states (extinction) zero the future value; time limits bootstrap.
            terminated = done and reason not in env.TRUNCATION_REASONS
            rollout["obs"].append(vector)
            rollout["obs_raw"].append(raw)
            rollout["pre_tanh"].append(pre_tanh.squeeze(0).tolist())
            rollout["log_probs"].append(float(log_prob.item()))
            rollout["values"].append(float(value.item()))
            rollout["rewards"].append(reward)
            rollout["dones"].append(terminated)
            total_reward += reward
            steps = step + 1
            if done:
                break
        bootstrap = 0.0
        if steps > 0 and not terminated:
            vector = normalize(env.observation(response, size), obs_stats)
            bootstrap = float(model.value_raw(torch.as_tensor(vector, dtype=torch.float32).unsqueeze(0)).item())
    advantages, returns = compute_gae(rollout["rewards"], rollout["values"], rollout["dones"],
                                      settings["gamma"], settings["gae_lambda"], bootstrap)
    rollout["advantages"] = advantages
    rollout["returns"] = returns
    info = response.get("info") or {}
    end_tick = int(info.get("tick", 0) or 0)
    summary = {
        "episode": spec["episode"], "reward": total_reward, "steps": steps,
        "ticks": max(0, end_tick - start_tick), "start_tick": start_tick,
        "population": info.get("population"), "births": int(info.get("births", 0) or 0),
        "deaths": int(info.get("deaths", 0) or 0), "scenario": spec["scenario"],
        "snapshot": bool(spec["snapshot"]),
        "reason": "extinction" if terminated else (info.get("doneReason") or "max_steps"),
    }
    return rollout, summary


# Worker process: one ai_server, one model; plays tasks until it receives None.
def worker_main(task_queue, result_queue, settings):
    sys.stdout = open(os.devnull, "w")
    torch.set_num_threads(1)
    server = None
    episode = None
    try:
        server = env.Server(settings["config_path"])
        model = ActorCritic(settings["obs_size"], len(settings["actions"]), settings["hidden_sizes"],
                            settings["log_std_init"])
        obs_stats = create_stats(settings["obs_size"], settings["obs_norm"], settings["obs_clip"], settings["obs_epsilon"])
        loaded_version = None
        while True:
            task = task_queue.get()
            if task is None:
                break
            spec, version, payload = task
            episode = spec["episode"]
            if version != loaded_version:
                model.load_state_dict(torch.load(io.BytesIO(payload["state"]), map_location="cpu"))
                import_stats(obs_stats, {**payload["obs"], "enabled": settings["obs_norm"],
                                         "clip": settings["obs_clip"], "epsilon": settings["obs_epsilon"]})
                loaded_version = version
            seed = env.mix_seed(spec["seed"], episode)
            random.seed(seed)
            torch.manual_seed(seed)
            rollout, summary = run_episode(server, model, obs_stats, spec, settings)
            result_queue.put(("ok", episode, rollout, summary))
    except Exception:  # Report the failure to the trainer instead of hanging it.
        result_queue.put(("error", episode, traceback.format_exc(), None))
    finally:
        if server is not None:
            server.close()
