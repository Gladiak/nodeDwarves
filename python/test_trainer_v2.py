"""Contracts for the lean v2 trainer (STRATEGY.md T2), run by scripts/test_recipe_contracts.js.

1. Numeric parity with the old python/train.py (while it exists): GAE, running statistics,
   return normalization and a full PPO update give bit-identical results.
2. Train/serve parity: a policy saved by the v2 trainer produces in the game's JS inference
   (src/ai/policy.js) the same outputs Python computes, on real game states.
3. Policy round trip: save then load restores every parameter and statistic.
"""

import json
import os
import random
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

import torch  # noqa: E402

from v2 import env  # noqa: E402
from v2 import model as v2m  # noqa: E402
from v2.ppo import compute_gae, ppo_update  # noqa: E402

CONFIG = json.load(open(os.path.join(ROOT, "config.json"), "r", encoding="utf-8"))
TRAINER = CONFIG["ai"]["training"]["trainer"]
ACTIONS = env.action_ids(CONFIG)
FEATURES = list(TRAINER["featureNames"])
OBS = env.observation_size(ACTIONS, FEATURES)
HIDDEN = [int(size) for size in TRAINER["hiddenSizes"]]
passed = []


def same_tensors(a, b):
    return all(torch.equal(a[key], b[key]) for key in a) and a.keys() == b.keys()


def test_old_trainer_parity():
    if not os.path.exists(os.path.join(HERE, "train.py")):
        passed.append("old_parity_skipped")
        return
    import train as old  # noqa: E402

    rng = random.Random(5)
    rewards = [rng.uniform(-1, 3) for _ in range(200)]
    values = [rng.uniform(0, 50) for _ in range(200)]
    dones = [rng.random() < 0.02 for _ in range(200)]
    assert compute_gae(rewards, values, dones, 0.999, 0.97, 12.5) == old.compute_gae(rewards, values, dones, 0.999, 0.97, 12.5)

    new_stats = v2m.create_stats(6, True, 5.0, 1e-8, max_count=50.0)
    old_stats = old.create_running_stats(6, enabled=True, clip=5.0, epsilon=1e-8)
    old_stats["max_count"] = 50.0
    for _ in range(3):
        samples = [[rng.gauss(2, 3) for _ in range(6)] for _ in range(40)]
        v2m.update_stats(new_stats, samples)
        old.update_running_stats(old_stats, samples)
    assert new_stats["mean"] == old_stats["mean"] and new_stats["var"] == old_stats["var"]
    probe = [rng.gauss(0, 10) for _ in range(6)]
    assert v2m.normalize(probe, new_stats) == old.normalize_vector(probe, old_stats)

    torch.manual_seed(11)
    old_model = old.ActorCritic(OBS, len(ACTIONS), HIDDEN, "tanh", float(TRAINER["logStdInit"]))
    new_model = v2m.ActorCritic(OBS, len(ACTIONS), HIDDEN, float(TRAINER["logStdInit"]))
    new_model.load_state_dict(old_model.state_dict())
    n = 700
    gen = torch.Generator().manual_seed(3)
    obs = torch.randn(n, OBS, generator=gen)
    with torch.no_grad():
        actions, log_probs, values_raw = old_model.act(obs, 0.0, 2.0)
    batch = {"obs": obs.tolist(), "actions": actions.tolist(), "log_probs": log_probs.tolist(),
             "returns": (torch.randn(n, generator=gen) * 40 + 300).tolist(),
             "advantages": torch.randn(n, generator=gen).tolist(), "values": values_raw.tolist()}
    hp = {"clip_range": float(TRAINER["clipRange"]), "value_coef": float(TRAINER["valueCoef"]),
          "epochs": 3, "mini_batch_size": 256, "max_grad_norm": float(TRAINER["maxGradNorm"]),
          "value_clip_range": float(TRAINER["valueClipRange"]), "value_huber_delta": float(TRAINER["valueHuberDelta"]),
          "target_kl": float(TRAINER["targetKl"])}
    old_ret = old.create_running_stats(1, enabled=True, clip=5.0, epsilon=1e-8)
    new_ret = v2m.create_stats(1, True, 5.0, 1e-8)
    for step in range(2):  # second round exercises the PopArt rescale on a non-empty history
        old.update_return_normalization(old_model, old_ret, batch["returns"])
        v2m.update_return_normalization(new_model, new_ret, batch["returns"])
        assert same_tensors(old_model.state_dict(), new_model.state_dict()), f"return normalization differs (round {step})"
        old_opt = torch.optim.Adam(old_model.parameters(), lr=2.5e-4)
        new_opt = torch.optim.Adam(new_model.parameters(), lr=2.5e-4)
        torch.manual_seed(99 + step)
        old_stats_ppo = old.apply_ppo_update(old_model, old_opt, batch, 0.0, 2.0, hp["clip_range"], hp["value_coef"],
                                             0.008, hp["epochs"], hp["mini_batch_size"], hp["max_grad_norm"],
                                             value_clip_range=hp["value_clip_range"],
                                             value_huber_delta=hp["value_huber_delta"], target_kl=hp["target_kl"],
                                             return_normalization=old_ret)
        torch.manual_seed(99 + step)
        new_stats_ppo = ppo_update(new_model, new_opt, batch, 0.0, 2.0, hp, 0.008, new_ret)
        assert same_tensors(old_model.state_dict(), new_model.state_dict()), f"PPO update differs (round {step})"
        for key in ("policy_loss", "value_loss", "entropy", "approx_kl", "clip_frac"):
            assert old_stats_ppo[key] == new_stats_ppo[key], key
    passed.append("old_trainer_bit_parity")


# A v2 policy with non-trivial observation statistics, saved to `path`.
def make_policy(path):
    torch.manual_seed(21)
    policy = v2m.ActorCritic(OBS, len(ACTIONS), HIDDEN, float(TRAINER["logStdInit"]))
    obs_stats = v2m.create_stats(OBS, True, float(TRAINER["obsNormClip"]), float(TRAINER["obsNormEpsilon"]))
    v2m.update_stats(obs_stats, (torch.rand(64, OBS) * 3).tolist())
    ret_stats = v2m.create_stats(1, True, 5.0, 1e-8, 200000)
    v2m.update_return_normalization(policy, ret_stats, (torch.randn(64) * 30 + 200).tolist())
    v2m.save_policy(path, policy, ACTIONS, FEATURES, 0.0, 2.0, obs_stats, ret_stats, 10)
    return policy, obs_stats, ret_stats


def test_train_serve_parity(directory):
    path = os.path.join(directory, "policy.json")
    policy, obs_stats, _ = make_policy(path)
    script = r"""
const path = require('path');
const root = process.argv[1];
const { loadConfig } = require(path.join(root, 'src', 'config'));
const { buildRuntime } = require(path.join(root, 'src', 'runtime'));
const { createInitialState } = require(path.join(root, 'src', 'state'));
const { stepState } = require(path.join(root, 'src', 'simulation'));
const { loadPolicy, policyForward } = require(path.join(root, 'src', 'ai', 'policy'));
const policy = loadPolicy(process.argv[2]);
const config = loadConfig();
const out = [];
for (const [seed, ticks] of [[11, 0], [22, 300], [33, 900]]) {
  config.display.terrain = { ...(config.display.terrain || {}), seed };
  const runtime = buildRuntime({ ...config.display, autoSize: false, width: 120, height: 40 }, { columns: 120, rows: 40 });
  const state = createInitialState(config, runtime);
  for (let t = 0; t < ticks; t += 1) stepState(state, config, runtime, null);
  out.push(policyForward(state, config, policy));
}
process.stdout.write(JSON.stringify(out));
"""
    result = subprocess.run(["node", "-e", script, ROOT, path], cwd=ROOT, capture_output=True, text=True, check=True)
    samples = json.loads(result.stdout)
    worst = 0.0
    for sample in samples:
        assert len(sample["rawInput"]) == OBS, f"JS input has {len(sample['rawInput'])} values, trainer expects {OBS}"
        x = torch.tensor([v2m.normalize(sample["rawInput"], obs_stats)], dtype=torch.float32)
        with torch.no_grad():
            expected = torch.tanh(policy.policy(x))[0].tolist()
        worst = max(worst, max(abs(a - b) for a, b in zip(expected, sample["output"])))
    assert worst < 1e-5, f"JS and Python outputs differ by {worst}"
    passed.append(f"train_serve_parity(max_diff={worst:.1e})")


def test_round_trip(directory):
    path = os.path.join(directory, "round_trip.json")
    policy, obs_stats, ret_stats = make_policy(path)
    loaded = v2m.ActorCritic(OBS, len(ACTIONS), HIDDEN, 0.0)
    obs_loaded = v2m.create_stats(OBS, True, 5.0, 1e-8)
    ret_loaded = v2m.create_stats(1, True, 5.0, 1e-8, 200000)
    v2m.load_policy(path, loaded, ACTIONS, FEATURES, 10, obs_loaded, ret_loaded)
    for key, value in policy.state_dict().items():
        assert torch.equal(value, loaded.state_dict()[key]), key
    assert obs_loaded["mean"] == obs_stats["mean"] and ret_loaded["var"] == ret_stats["var"]
    try:
        v2m.load_policy(path, loaded, ACTIONS, FEATURES, 2, obs_loaded, ret_loaded)
    except SystemExit as exc:
        assert "stepTicks" in str(exc)
    else:
        raise AssertionError("load_policy accepted a different cadence")
    passed.append("policy_round_trip")


def test_episode_specs_are_pure():
    scenarios = env.training_scenarios(CONFIG)
    phase = {"difficulty_start": 0.12, "difficulty_end": 1.0, "difficulty_ramp": 100, "snapshot_prob": 0.5}
    files = [f"s{i}" for i in range(10)]
    first = [env.episode_spec(8000, e, phase, scenarios, files) for e in range(1, 60)]
    again = [env.episode_spec(8000, e, phase, scenarios, files) for e in reversed(range(1, 60))][::-1]
    assert first == again, "episode settings depend on call order"
    assert len({spec["scenario"] for spec in first}) > 3 and any(spec["snapshot"] for spec in first)
    passed.append("episode_specs_pure")


def main():
    test_old_trainer_parity()
    test_episode_specs_are_pure()
    with tempfile.TemporaryDirectory() as directory:
        test_train_serve_parity(directory)
        test_round_trip(directory)
    print("[test:trainer-v2] PASS " + " ".join(passed))


if __name__ == "__main__":
    main()
