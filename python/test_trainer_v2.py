"""Contracts for the lean v2 trainer (STRATEGY.md T2), run by scripts/test_recipe_contracts.js.

1. Train/serve parity: a policy saved by the v2 trainer produces in the game's JS inference
   (src/ai/policy.js) the same outputs Python computes, on real game states.
2. Policy round trip: save then load restores every parameter and statistic.
3. Episode settings are pure functions of the run seed and episode number.
The bit parity with the old python/train.py (E38) was checked until that trainer was deleted (T4).
"""

import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

import torch  # noqa: E402

from v2 import env  # noqa: E402
from v2 import model as v2m  # noqa: E402

CONFIG = json.load(open(os.path.join(ROOT, "config.json"), "r", encoding="utf-8"))
TRAINER = CONFIG["ai"]["training"]["trainer"]
ACTIONS = env.action_ids(CONFIG)
FEATURES = list(TRAINER["featureNames"])
OBS = env.observation_size(ACTIONS, FEATURES)
HIDDEN = [int(size) for size in TRAINER["hiddenSizes"]]
passed = []


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


# With unchanged weights the PPO ratio is exactly 1, saturated lever samples included (E48: inverting
# the squashed action clamped them and gave a KL of 0.29 with no update).
def test_zero_update_ratio():
    torch.manual_seed(5)
    policy = v2m.ActorCritic(OBS, len(ACTIONS), HIDDEN, 0.0)
    with torch.no_grad():
        policy.policy.linear_layers()[-1].bias.fill_(-6.0)  # every head deep in saturation
        obs = torch.randn(256, OBS)
        _, stored, _, pre_tanh = policy.act(obs, 0.0, 2.0)
        replayed = v2m.log_prob_of(policy.policy(obs), policy.log_std, torch.tensor(pre_tanh.tolist()))
    worst = float((replayed - stored).abs().max())
    assert worst < 1e-4, f"zero-update log-ratio reaches {worst}"
    passed.append(f"zero_update_ratio(max={worst:.1e})")


def main():
    test_episode_specs_are_pure()
    test_zero_update_ratio()
    with tempfile.TemporaryDirectory() as directory:
        test_train_serve_parity(directory)
        test_round_trip(directory)
    print("[test:trainer-v2] PASS " + " ".join(passed))


if __name__ == "__main__":
    main()
