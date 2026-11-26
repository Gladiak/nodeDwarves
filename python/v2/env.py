"""ai_server.js protocol for the v2 trainer: compact transport only, so observations are computed by
the same JS code the game uses (src/ai/observation.js); no observation code lives in Python.
Episode settings (seed, difficulty, scenario, snapshot) are pure functions of the run seed and the
episode number, so a run does not depend on worker timing."""

import json
import os
import random
import select
import subprocess

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
LEVER_PREFIX = "lever_"
PER_RESOURCE_FEATURES = frozenset(("shortage", "nodeScarcity"))
SEED_MODULUS = 2147483647
SEED_STEP = 10007
IPC_TIMEOUT_SECONDS = 120.0
TRUNCATION_REASONS = frozenset(("maxTicks", "stable"))


# Action heads of action space v2: the job weights (sorted resource targets) then one head per lever.
def action_ids(config):
    levers = (config.get("ai") or {}).get("levers") or {}
    if levers.get("enabled") is not True:
        raise SystemExit("the v2 trainer needs ai.levers.enabled = true")
    resources = sorted(((config.get("resources") or {}).get("targets") or {}).keys())
    if not resources:
        raise SystemExit("config has no resources.targets")
    return resources + [LEVER_PREFIX + name for name in (levers.get("definitions") or {})]


def is_lever(action_id):
    return str(action_id).startswith(LEVER_PREFIX)


# Size of the factored observation vector the server sends for these heads and features.
def observation_size(actions, feature_names):
    observed = [action for action in actions if not is_lever(action)]
    per_resource = sum(1 for name in feature_names if name in PER_RESOURCE_FEATURES)
    return len(observed) * per_resource + (len(feature_names) - per_resource)


# Deterministic positive seed mixing (same arithmetic as the old trainer).
def mix_seed(seed, salt):
    base = int(seed) % SEED_MODULUS or 1
    return (base + int(salt) * SEED_STEP) % SEED_MODULUS or 1


# Training scenarios with positive weight, as (name, weight, difficulty window) tuples.
def training_scenarios(config):
    entries = []
    for entry in ((config.get("ai") or {}).get("training") or {}).get("scenarios") or []:
        weight = float(entry.get("weight", 1.0))
        if entry.get("name") and weight > 0:
            entries.append({
                "name": str(entry["name"]), "weight": weight,
                "dmin": entry.get("difficultyMin"), "dmax": entry.get("difficultyMax"),
                "min_mult": float(entry.get("difficultyMinMultiplier", 0.0)),
                "max_mult": float(entry.get("difficultyMaxMultiplier", 1.0)),
            })
    return entries


# Scenario weight at a difficulty (linear multiplier inside the scenario's difficulty window).
def scenario_weight(entry, difficulty):
    dmin, dmax = entry["dmin"], entry["dmax"]
    if dmin is None or dmax is None or dmax <= dmin:
        return entry["weight"]
    t = max(0.0, min(1.0, (difficulty - dmin) / (dmax - dmin)))
    return entry["weight"] * max(0.0, entry["min_mult"] + (entry["max_mult"] - entry["min_mult"]) * t)


# Everything that defines one episode, from the run seed and the episode number only.
def episode_spec(run_seed, episode, phase, scenarios, snapshot_files):
    progress = min(1.0, (episode - 1) / max(1, phase["difficulty_ramp"]))
    difficulty = phase["difficulty_start"] + (phase["difficulty_end"] - phase["difficulty_start"]) * progress
    difficulty = max(0.0, min(1.0, difficulty))
    rng = random.Random(mix_seed(run_seed, 1_000_003 + episode))
    scenario = None
    weights = [scenario_weight(entry, difficulty) for entry in scenarios]
    total = sum(weights)
    if total > 0:
        pick = rng.random() * total
        cumulative = 0.0
        scenario = scenarios[-1]["name"]
        for entry, weight in zip(scenarios, weights):
            cumulative += weight
            if pick <= cumulative:
                scenario = entry["name"]
                break
    snapshot = None
    if snapshot_files and rng.random() < phase["snapshot_prob"]:
        snapshot = snapshot_files[rng.randrange(len(snapshot_files))]
    return {"episode": episode, "seed": run_seed + episode, "difficulty": difficulty,
            "scenario": scenario, "snapshot": snapshot}


# Sorted snapshot files of a bank directory.
def list_snapshots(bank_dir):
    if not bank_dir:
        return []
    if not os.path.isdir(bank_dir):
        raise SystemExit(f"snapshot bank {bank_dir} does not exist")
    files = sorted(os.path.join(bank_dir, name) for name in os.listdir(bank_dir) if name.endswith(".v8.gz"))
    if not files:
        raise SystemExit(f"snapshot bank {bank_dir} is empty")
    return files


class Server:
    """One ai_server.js process speaking JSON lines."""

    def __init__(self, config_path):
        self.proc = subprocess.Popen(["node", os.path.join(ROOT, "ai_server.js"), "--config", config_path],
                                     cwd=ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1)

    def send(self, payload):
        self.proc.stdin.write(json.dumps(payload, separators=(",", ":")) + "\n")
        self.proc.stdin.flush()
        readable, _, _ = select.select([self.proc.stdout.fileno()], [], [], IPC_TIMEOUT_SECONDS)
        if not readable:
            raise RuntimeError(f"ai_server read timeout after {IPC_TIMEOUT_SECONDS:.0f}s")
        line = self.proc.stdout.readline()
        if not line:
            raise RuntimeError("ai_server closed")
        response = json.loads(line)
        if isinstance(response, dict) and response.get("error"):
            raise RuntimeError(f"ai_server error: {response['error']}")
        return response

    def reset(self, spec, actions, feature_names, full_sim):
        payload = {"cmd": "reset", "seed": spec["seed"], "training": True, "difficulty": spec["difficulty"],
                   "transport": {"mode": "compact", "resources": list(actions),
                                 "featureNames": list(feature_names), "observationLayout": "factored"}}
        if full_sim:
            payload["eval"] = True
        if spec["scenario"]:
            payload["scenario"] = spec["scenario"]
        if spec["snapshot"]:
            payload["snapshot"] = spec["snapshot"]
        return self.send(payload)

    def step(self, action_values, step_ticks):
        return self.send({"cmd": "step", "actionValues": list(action_values), "ticks": int(step_ticks)})

    def close(self):
        try:
            self.proc.stdin.write(json.dumps({"cmd": "close"}) + "\n")
            self.proc.stdin.flush()
        except (BrokenPipeError, OSError):
            pass
        try:
            self.proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.proc.kill()


# Observation vector of a response, checked against the expected size.
def observation(response, size):
    vector = response.get("obsVector")
    if not isinstance(vector, list) or len(vector) != size:
        raise RuntimeError(f"obsVector has {len(vector) if isinstance(vector, list) else 'no'} values, expected {size}")
    return vector
