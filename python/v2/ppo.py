"""GAE and the clipped PPO update, ported unchanged from the old python/train.py (bit parity checked in E38)."""

import torch
import torch.nn as nn

from v2.model import entropy_of, log_prob_of, value_scale


# Generalized advantage estimation. `dones[i]` marks a true terminal transition (extinction); time
# limits are not terminal and bootstrap from `last_value`.
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


# Elementwise value loss (Huber when delta > 0, squared error otherwise).
def value_loss_elements(prediction, target, huber_delta):
    error = prediction - target
    if huber_delta > 0:
        abs_error = torch.abs(error)
        quadratic = torch.clamp(abs_error, max=huber_delta)
        return 0.5 * quadratic.pow(2) + huber_delta * (abs_error - quadratic)
    return error.pow(2)


# One PPO update over a batch of transitions. `hp` holds the algorithm hyperparameters; returns
# averaged statistics plus the critic's explained variance before the update.
def ppo_update(model, optimizer, batch, low, high, hp, entropy_coef, return_stats):
    obs = torch.tensor(batch["obs"], dtype=torch.float32)
    actions = torch.tensor(batch["actions"], dtype=torch.float32)
    old_log_probs = torch.tensor(batch["log_probs"], dtype=torch.float32)
    returns_raw = torch.tensor(batch["returns"], dtype=torch.float32)
    old_values_raw = torch.tensor(batch["values"], dtype=torch.float32)
    advantages = torch.tensor(batch["advantages"], dtype=torch.float32)
    if advantages.numel() > 1:
        advantages = (advantages - advantages.mean()) / (advantages.std(unbiased=False) + 1e-8)
    else:
        advantages = advantages * 0.0
    batch_size = obs.shape[0]

    # Critic health before this update: 1 - Var(R - V) / Var(R) on raw returns.
    explained_variance = None
    if returns_raw.numel() > 1:
        returns_var = float(returns_raw.var(unbiased=False).item())
        if returns_var > 1e-12:
            explained_variance = 1.0 - float((returns_raw - old_values_raw).var(unbiased=False).item()) / returns_var

    # The value head predicts normalized returns, so only targets are clipped: clamping predictions
    # would zero their gradients and freeze the critic.
    value_mean, value_std = value_scale(return_stats)
    returns_norm = (returns_raw - value_mean) / value_std
    if return_stats["enabled"] and return_stats["clip"] > 0:
        returns_norm = torch.clamp(returns_norm, -return_stats["clip"], return_stats["clip"])
    old_values_norm = (old_values_raw - value_mean) / value_std

    clip_range = hp["clip_range"]
    value_clip = hp["value_clip_range"]
    stats = {"policy_loss": 0.0, "value_loss": 0.0, "entropy": 0.0, "approx_kl": 0.0, "clip_frac": 0.0,
             "updates": 0, "epochs": 0, "early_stop": False, "explained_variance": explained_variance}
    for _ in range(hp["epochs"]):
        epoch_kl = 0.0
        epoch_batches = 0
        indices = torch.randperm(batch_size)
        for start in range(0, batch_size, hp["mini_batch_size"]):
            idx = indices[start:start + hp["mini_batch_size"]]
            mean = model.policy(obs[idx])
            log_prob = log_prob_of(mean, model.log_std, actions[idx], low, high)
            log_ratio = log_prob - old_log_probs[idx]
            ratio = torch.exp(log_ratio)
            approx_kl = ((ratio - 1.0) - log_ratio).mean()
            clip_frac = (torch.abs(ratio - 1.0) > clip_range).float().mean()
            batch_adv = advantages[idx]
            policy_loss = -torch.min(ratio * batch_adv,
                                     torch.clamp(ratio, 1 - clip_range, 1 + clip_range) * batch_adv).mean()

            value_pred = model.value(obs[idx]).squeeze(-1)
            loss_unclipped = value_loss_elements(value_pred, returns_norm[idx], hp["value_huber_delta"])
            if value_clip > 0:
                old = old_values_norm[idx]
                clipped_pred = old + torch.clamp(value_pred - old, -value_clip, value_clip)
                loss_clipped = value_loss_elements(clipped_pred, returns_norm[idx], hp["value_huber_delta"])
                value_loss = torch.max(loss_unclipped, loss_clipped).mean()
            else:
                value_loss = loss_unclipped.mean()

            entropy = entropy_of(model.log_std, mean).mean()
            loss = policy_loss + hp["value_coef"] * value_loss - entropy_coef * entropy
            optimizer.zero_grad()
            loss.backward()
            if hp["max_grad_norm"] > 0:
                nn.utils.clip_grad_norm_(model.parameters(), hp["max_grad_norm"])
            optimizer.step()

            stats["policy_loss"] += float(policy_loss.item())
            stats["value_loss"] += float(value_loss.item())
            stats["entropy"] += float(entropy.item())
            stats["approx_kl"] += float(approx_kl.item())
            stats["clip_frac"] += float(clip_frac.item())
            stats["updates"] += 1
            epoch_kl += float(approx_kl.item())
            epoch_batches += 1
        stats["epochs"] += 1
        if hp["target_kl"] > 0 and epoch_batches > 0 and epoch_kl / epoch_batches > hp["target_kl"]:
            stats["early_stop"] = True
            break
    for key in ("policy_loss", "value_loss", "entropy", "approx_kl", "clip_frac"):
        stats[key] /= max(1, stats["updates"])
    return stats
