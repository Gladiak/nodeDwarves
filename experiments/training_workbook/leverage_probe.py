"""Action-leverage probe: how much can each governor group move long-horizon outcomes?

Plays the same 20,000-tick plan (12 episodes, endgame config) with the game's defaults, with one
governor group pushed to an extreme (others on defaults), and with inverted job weights, then prints
a paired table against the no-policy default. Resumable: probes whose output already exists are
skipped, so it can be stopped (Ctrl+C) and relaunched at any time. ~3.5 min per probe, ~1 h total.

Example:
  .venv/bin/python experiments/training_workbook/leverage_probe.py \
    --out experiments/training_workbook/runs/2026-11-24_vs_default
  .venv/bin/python experiments/training_workbook/leverage_probe.py --out <session> --report-only
"""
import argparse
import json
import math
import os
import statistics as st
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
EVAL = os.path.join(ROOT, "experiments", "training_workbook", "eval_paired.py")
GROUPS = ["festival", "building", "trade", "contracts", "ruins", "underrealm", "externalCamps", "warriors"]
PROBES = ["default", "jobs:inv"] + [f"group:{group}:{value}" for group in GROUPS for value in (0, 2)]
# Extra players reported when present (written by earlier E14/E15 runs).
REFERENCE = ["best", "latest", "const0", "const2", "random"]


# Output file name for one probe inside the session folder.
def output_path(out, probe):
    return os.path.join(out, "long_" + probe.replace(":", "_") + ".json")


# Run every probe whose output is missing, in a fixed order.
def run_missing(out, workers):
    config = os.path.join(out, "configs", "config_endgame.json")
    if not os.path.exists(config):
        sys.exit(f"missing {config}: create the session first (WORKBOOK.md section 1)")
    pending = [probe for probe in PROBES if not os.path.exists(output_path(out, probe))]
    print(f"[leverage] {len(PROBES) - len(pending)}/{len(PROBES)} done, {len(pending)} to run (~{len(pending) * 3.5:.0f} min)")
    for index, probe in enumerate(pending, 1):
        print(f"[leverage] {index}/{len(pending)} {probe}", flush=True)
        target = output_path(out, probe)
        partial = target + ".partial"
        subprocess.run([sys.executable, EVAL, "--policy", probe, "--config", config, "--max-steps", "10000",
                        "--episodes", "12", "--workers", str(workers), "--out", partial], cwd=ROOT, check=True)
        os.replace(partial, target)


# Print the paired table of every available player against the no-policy default.
def report(out):
    base_file = output_path(out, "default")
    if not os.path.exists(base_file):
        sys.exit("default run missing: nothing to compare against yet")
    base = json.load(open(base_file))["episodes_detail"]
    names = ["default"] + [name for name in REFERENCE + PROBES[1:] if os.path.exists(output_path(out, name))]
    header = f"{'player':22s} {'score':>6s} {'delta':>7s} {'z':>6s} {'pop':>6s} {'deaths':>7s} {'starv':>6s} {'raid':>6s} {'deepR':>6s} {'stkMin':>6s} {'ext':>3s}"
    print(header)
    for name in names:
        rows = json.load(open(output_path(out, name)))["episodes_detail"]
        diffs = [a["score"] - b["score"] for a, b in zip(rows, base)]
        delta = st.mean(diffs)
        se = st.stdev(diffs) / math.sqrt(len(diffs)) if any(diffs) else 0.0
        cause = lambda key: sum((row["deaths_by_cause"] or {}).get(key, 0) for row in rows) / len(rows)
        mean = lambda key: st.mean(row[key] for row in rows)
        extinctions = sum(row["done_reason"] == "extinction" for row in rows)
        print(f"{name:22s} {mean('score'):6.3f} {delta:+7.3f} {(delta / se if se else 0):+6.2f} {mean('pop'):6.0f} "
              f"{mean('deaths'):7.1f} {cause('starvation'):6.1f} {cause('raid'):6.1f} {cause('deepRaid'):6.1f} "
              f"{mean('stock_min'):6.3f} {extinctions:3d}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True, help="workbook session folder with configs/")
    parser.add_argument("--workers", type=int, default=7)
    parser.add_argument("--report-only", action="store_true")
    args = parser.parse_args()
    if not args.report_only:
        run_missing(args.out, args.workers)
    report(args.out)


if __name__ == "__main__":
    main()
