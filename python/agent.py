import json
import subprocess
import sys
import time


def send(proc, payload):
    proc.stdin.write(json.dumps(payload) + "\n")
    proc.stdin.flush()
    line = proc.stdout.readline()
    if not line:
        raise RuntimeError("Server closed")
    return json.loads(line)


def choose_weights(obs):
    ratios = obs.get("stockpileRatio", {}) or {}
    weights = {}

    for resource, ratio in ratios.items():
        value = float(ratio)
        if value < 0.4:
            weights[resource] = 2.0
        elif value < 0.7:
            weights[resource] = 1.5
        else:
            weights[resource] = 1.0

    return weights


def main():
    max_steps = 2000
    step_ticks = 10

    proc = subprocess.Popen(
        ["node", "ai_server.js"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        text=True,
        bufsize=1,
    )

    try:
        response = send(proc, {"cmd": "reset"})
        for step in range(max_steps):
            obs = response.get("obs", {})
            action = {
                "weights": choose_weights(obs),
                "festivalIntent": 0.0,
                "ticks": step_ticks,
            }
            response = send(proc, {"cmd": "step", "action": action})
            reward = response.get("reward", 0)
            info = response.get("info", {})
            if step % 50 == 0:
                print(
                    f"step={step} tick={info.get('tick')} "
                    f"pop={info.get('population')} reward={reward:.3f}"
                )
            if response.get("done"):
                print("done:", response.get("info", {}))
                break
            time.sleep(0.0)
    finally:
        try:
            send(proc, {"cmd": "close"})
        except Exception:
            pass
        proc.terminate()


if __name__ == "__main__":
    main()
