"""Actor-critic, running statistics and the policy JSON read by the game (src/ai/policy.js).

Numerics are ported unchanged from the old python/train.py (checked by the T2 parity test):
tanh-squashed Gaussian heads with a state-independent log std, a critic that predicts normalized
returns, PopArt-style output-preserving rescaling when the return statistics move, and observation
normalization with the same mean/var/clip/epsilon semantics as the JS inference.
"""

import json
import math
import os
import time

import torch
import torch.nn as nn
from torch.distributions import Normal

POLICY_FORMAT_VERSION = 3
NORMALIZATION_VERSION = 1
VALUE_HEAD_NORMALIZED = "normalized_returns"
OBSERVATION_LAYOUT = "factored"


# ----------------------------------------------------------------------------------------------
# Running statistics (plain dicts, so they serialize into the policy JSON unchanged).

# New running statistics for vectors of `size` values.
def create_stats(size, enabled, clip, epsilon, max_count=0.0):
    return {
        "enabled": bool(enabled),
        "size": int(size),
        "mean": [0.0] * int(size),
        "var": [1.0] * int(size),
        "count": 0.0,
        "clip": max(0.0, float(clip)),
        "epsilon": max(1e-12, float(epsilon)),
        "max_count": max(0.0, float(max_count)),
    }


# Merge a batch of samples (rows of `size` values) into the statistics (parallel Welford).
def update_stats(stats, samples):
    if not stats["enabled"] or not samples:
        return
    tensor = torch.as_tensor(samples, dtype=torch.float32)
    if tensor.ndim == 1:
        tensor = tensor.unsqueeze(0)
    if int(tensor.shape[1]) != stats["size"]:
        raise ValueError(f"stats size {stats['size']} but samples have {int(tensor.shape[1])} values")
    batch_count = float(tensor.shape[0])
    batch_mean = tensor.mean(dim=0)
    batch_var = tensor.var(dim=0, unbiased=False)
    count = float(stats["count"])
    # Bounded memory: cap the historical weight so the statistics keep tracking a moving target.
    if stats["max_count"] > 0.0:
        count = min(count, stats["max_count"])
    if count <= 0.0:
        stats["mean"] = batch_mean.tolist()
        stats["var"] = torch.clamp(batch_var, min=1e-12).tolist()
        stats["count"] = batch_count
        return
    mean = torch.tensor(stats["mean"], dtype=torch.float32)
    var = torch.clamp(torch.tensor(stats["var"], dtype=torch.float32), min=1e-12)
    total = count + batch_count
    delta = batch_mean - mean
    new_mean = mean + delta * (batch_count / total)
    m2 = var * count + batch_var * batch_count + delta.pow(2) * (count * batch_count / total)
    stats["mean"] = new_mean.tolist()
    stats["var"] = torch.clamp(m2 / total, min=1e-12).tolist()
    stats["count"] = total


# Normalize one observation vector (identity when the statistics are disabled).
def normalize(vector, stats):
    if not stats["enabled"]:
        return list(vector)
    epsilon = stats["epsilon"]
    clip = stats["clip"]
    out = []
    for value, mu, sigma2 in zip(vector, stats["mean"], stats["var"]):
        scaled = (float(value) - float(mu)) / math.sqrt(max(1e-12, float(sigma2)) + epsilon)
        if clip > 0.0:
            scaled = max(-clip, min(clip, scaled))
        out.append(scaled)
    return out


# Statistics as stored in the policy JSON `normalization` block.
def export_stats(stats):
    return {
        "enabled": bool(stats["enabled"]),
        "count": float(stats["count"]),
        "mean": [float(value) for value in stats["mean"]],
        "var": [max(1e-12, float(value)) for value in stats["var"]],
        "clip": float(stats["clip"]),
        "epsilon": float(stats["epsilon"]),
    }


# Restore statistics saved by export_stats into `stats` (shape checked).
def import_stats(stats, payload):
    if len(payload["mean"]) != stats["size"] or len(payload["var"]) != stats["size"]:
        raise ValueError(f"normalization shape mismatch: expected {stats['size']} values")
    stats["mean"] = [float(value) for value in payload["mean"]]
    stats["var"] = [max(1e-12, float(value)) for value in payload["var"]]
    stats["count"] = max(0.0, float(payload.get("count", 0.0)))
    stats["enabled"] = bool(payload.get("enabled", stats["enabled"]))
    stats["clip"] = max(0.0, float(payload.get("clip", stats["clip"])))
    stats["epsilon"] = max(1e-12, float(payload.get("epsilon", stats["epsilon"])))


# (mean, std) that map normalized value predictions back to raw returns.
def value_scale(stats):
    if not stats["enabled"]:
        return 0.0, 1.0
    return float(stats["mean"][0]), math.sqrt(max(1e-12, float(stats["var"][0])) + stats["epsilon"])


# ----------------------------------------------------------------------------------------------
# Networks.

class Mlp(nn.Module):
    def __init__(self, input_size, hidden_sizes, output_size):
        super().__init__()
        layers = []
        last = input_size
        for size in hidden_sizes:
            layers.append(nn.Linear(last, size))
            layers.append(nn.Tanh())
            last = size
        layers.append(nn.Linear(last, output_size))
        self.model = nn.Sequential(*layers)
        self.hidden_sizes = list(hidden_sizes)

    def forward(self, inputs):
        return self.model(inputs)

    def linear_layers(self):
        return [module for module in self.model if isinstance(module, nn.Linear)]

    def export_layers(self):
        return [{"weights": layer.weight.detach().cpu().tolist(), "biases": layer.bias.detach().cpu().tolist()}
                for layer in self.linear_layers()]

    def load_layers(self, layers):
        modules = self.linear_layers()
        if len(layers) != len(modules):
            raise ValueError("layer count mismatch")
        for module, payload in zip(modules, layers):
            weights = torch.tensor(payload["weights"], dtype=torch.float32)
            biases = torch.tensor(payload["biases"], dtype=torch.float32)
            if module.weight.shape != weights.shape or module.bias.shape != biases.shape:
                raise ValueError("layer shape mismatch")
            module.weight.data.copy_(weights)
            module.bias.data.copy_(biases)


# Map tanh output in [-1, 1] to the action range and back.
def scale_action(action, low, high):
    return low + (action + 1.0) * 0.5 * (high - low)


def unscale_action(action, low, high):
    scale = high - low
    if scale <= 0:
        return torch.zeros_like(action)
    return (action - low) * 2.0 / scale - 1.0


class ActorCritic(nn.Module):
    def __init__(self, input_size, action_size, hidden_sizes, log_std_init):
        super().__init__()
        self.policy = Mlp(input_size, hidden_sizes, action_size)
        # The value head predicts normalized returns; value_mean/value_std map it back to raw scale.
        self.value = Mlp(input_size, hidden_sizes, 1)
        self.log_std = nn.Parameter(torch.full((action_size,), float(log_std_init)))
        self.register_buffer("value_mean", torch.zeros(1))
        self.register_buffer("value_std", torch.ones(1))

    def value_raw(self, obs):
        return self.value(obs).squeeze(-1) * self.value_std + self.value_mean

    # Sample an action. `noise` (standard normal, shape of the mean) lets the rollout hold
    # exploration noise across decisions; every draw stays N(0, 1), so log_prob is unchanged.
    def act(self, obs, low, high, noise=None):
        mean = self.policy(obs)
        std = self.log_std.exp()
        dist = Normal(mean, std)
        pre_tanh = dist.rsample() if noise is None else mean + std * noise
        tanh_action = torch.tanh(pre_tanh)
        action = scale_action(tanh_action, low, high)
        log_prob = (dist.log_prob(pre_tanh) - torch.log(1 - tanh_action.pow(2) + 1e-6)).sum(-1)
        return action, log_prob, self.value_raw(obs)


# Log-probability of stored actions under the current policy (tanh-corrected).
def log_prob_of(mean, log_std, actions, low, high):
    scaled = torch.clamp(unscale_action(actions, low, high), -0.999, 0.999)
    pre_tanh = 0.5 * torch.log((1 + scaled) / (1 - scaled))
    dist = Normal(mean, log_std.exp())
    return (dist.log_prob(pre_tanh) - torch.log(1 - scaled.pow(2) + 1e-6)).sum(-1)


# Entropy of the pre-tanh Gaussian (depends on log std only).
def entropy_of(log_std, mean):
    std = log_std.exp().expand_as(mean)
    return Normal(torch.zeros_like(mean), std).entropy().sum(-1)


# Copy the return scale into the model so value_raw() denormalizes consistently.
def set_value_scale(model, mean, std):
    model.value_mean.fill_(float(mean))
    model.value_std.fill_(max(1e-6, float(std)))


# PopArt-style output preservation: rescale the critic's output layer so raw predictions are
# unchanged when the return statistics move from (old_mean, old_std) to (new_mean, new_std).
def rescale_value_head(model, old_mean, old_std, new_mean, new_std):
    new_std = max(1e-6, float(new_std))
    old_std = max(1e-6, float(old_std))
    output = model.value.linear_layers()[-1]
    with torch.no_grad():
        output.weight.mul_(old_std / new_std)
        output.bias.mul_(old_std).add_(float(old_mean) - float(new_mean)).div_(new_std)
    set_value_scale(model, new_mean, new_std)


# Update return statistics from one batch and keep the critic's raw predictions continuous.
def update_return_normalization(model, stats, returns):
    if not stats["enabled"]:
        set_value_scale(model, 0.0, 1.0)
        return
    first_batch = float(stats["count"]) <= 0.0
    old_mean, old_std = value_scale(stats)
    update_stats(stats, [[value] for value in returns])
    new_mean, new_std = value_scale(stats)
    if first_batch:
        # Fresh critic: start predicting the batch mean instead of preserving an arbitrary init.
        set_value_scale(model, new_mean, new_std)
    else:
        rescale_value_head(model, old_mean, old_std, new_mean, new_std)


# ----------------------------------------------------------------------------------------------
# Policy JSON (game inference format) and training state.

# Write the policy JSON read by src/ai/policy.js; the cadence travels with the policy.
def save_policy(path, model, actions, feature_names, low, high, obs_stats, return_stats, step_ticks):
    payload = {
        "version": POLICY_FORMAT_VERSION,
        "type": "mlp",
        "resources": list(actions),
        "featureNames": list(feature_names),
        "observationLayout": OBSERVATION_LAYOUT,
        "minWeight": low,
        "maxWeight": high,
        "activation": "tanh",
        "outputActivation": "tanh",
        "hiddenSizes": model.policy.hidden_sizes,
        "layers": model.policy.export_layers(),
        "valueLayers": model.value.export_layers(),
        "valueHead": VALUE_HEAD_NORMALIZED,
        "logStd": model.log_std.detach().cpu().tolist(),
        "trainedAt": int(time.time()),
        "stepTicks": int(step_ticks),
        "normalization": {
            "version": NORMALIZATION_VERSION,
            "observation": export_stats(obs_stats),
            "returns": export_stats(return_stats),
        },
    }
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    temporary = f"{path}.tmp"
    with open(temporary, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)
    os.replace(temporary, path)


# Load a policy JSON written by save_policy into the model and statistics; refuses any mismatch.
def load_policy(path, model, actions, feature_names, step_ticks, obs_stats, return_stats):
    with open(path, "r", encoding="utf-8") as handle:
        payload = json.load(handle)
    checks = (
        ("resources", list(actions)),
        ("featureNames", list(feature_names)),
        ("observationLayout", OBSERVATION_LAYOUT),
        ("valueHead", VALUE_HEAD_NORMALIZED),
        ("stepTicks", int(step_ticks)),
    )
    for key, expected in checks:
        if payload.get(key) != expected:
            raise SystemExit(f"{path}: {key} is {payload.get(key)!r}, expected {expected!r}; start a fresh run")
    model.policy.load_layers(payload["layers"])
    model.value.load_layers(payload["valueLayers"])
    model.log_std.data.copy_(torch.tensor(payload["logStd"], dtype=torch.float32))
    normalization = payload.get("normalization") or {}
    if normalization.get("version") != NORMALIZATION_VERSION:
        raise SystemExit(f"{path}: unsupported normalization block; start a fresh run")
    import_stats(obs_stats, normalization["observation"])
    import_stats(return_stats, normalization["returns"])
    set_value_scale(model, *value_scale(return_stats))


def save_training_state(path, optimizer, episode):
    torch.save({"optimizer": optimizer.state_dict(), "episode": int(episode), "savedAt": int(time.time())}, path)


# Restore the optimizer state saved next to a policy; False when there is none.
def load_training_state(path, optimizer):
    if not os.path.exists(path):
        return False
    optimizer.load_state_dict(torch.load(path, map_location="cpu")["optimizer"])
    return True
