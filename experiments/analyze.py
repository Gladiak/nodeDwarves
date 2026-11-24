"""Summarize exp_run.js experiments: paired deltas vs the frozen start policy and vs a reference variant.

Each run folder <name>_r<rep> may hold eval_final.json (canonical) and long_final.json (long horizon).
Chained runs (--chain k) may also hold eval_link<k>.json: the canonical eval of the snapshot taken
after link k (1-based). Those produce a learning curve per variant, with cumulative training minutes
and an estimated production wall time that adds --link-overhead-min per link (promote check and
process start-up, which exp_run.js does not run).
Deltas are paired by eval seed; "pooled" averages replicates episode-by-episode before pairing.

Example:
  python3 experiments/analyze.py --out experiments/runs/current --ref f640
"""
import argparse
import glob
import json
import math
import os
import re
import statistics as st


# Mean and standard error of paired per-episode differences.
def paired(a, b):
    diffs = [x - y for x, y in zip(a, b)]
    mean = st.mean(diffs)
    se = st.stdev(diffs) / math.sqrt(len(diffs)) if len(diffs) > 1 else float("nan")
    return mean, se


# Format "delta (z)" safely when the standard error is zero or undefined.
def fmt_delta(mean, se):
    z = mean / se if se and not math.isnan(se) else float("nan")
    return f"{mean:+.4f} ({z:+.2f})"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "runs", "current"))
    parser.add_argument("--ref", default=None, help="Reference variant name for head-to-head deltas")
    parser.add_argument("--link-overhead-min", type=float, default=1.0,
                        help="Production overhead per run (promote + start-up) added to curve wall time")
    args = parser.parse_args()
    print_link_curves(args)
    for kind, start_file, run_file in (("canonical", "eval_start.json", "eval_final.json"),
                                       ("long", "long_start.json", "long_final.json")):
        start_path = os.path.join(args.out, start_file)
        if not os.path.exists(start_path):
            continue
        start = json.load(open(start_path))["scores"]
        groups = {}
        for run_dir in sorted(glob.glob(os.path.join(args.out, "*_r*"))):
            path = os.path.join(run_dir, run_file)
            if not os.path.exists(path):
                continue
            name = os.path.basename(run_dir).rsplit("_r", 1)[0]
            timing = json.load(open(os.path.join(run_dir, "timing.json")))
            seconds = sum(item["seconds"] for item in timing["timing"])
            entropy = re.findall(r"ent=([0-9.]+)", timing["timing"][-1]["ppo"]) if timing["timing"] else []
            groups.setdefault(name, []).append({
                "scores": json.load(open(path))["scores"],
                "seconds": seconds,
                "entropy": float(entropy[-1]) if entropy else float("nan"),
            })
        if not groups:
            continue
        pooled = {name: [st.mean(v) for v in zip(*[run["scores"] for run in runs])] for name, runs in groups.items()}
        print(f"\n== {kind} (start mean {st.mean(start):.4f}) ==")
        print(f"{'variant':16s} {'n':>2s} {'per-replicate delta':28s} {'pooled delta (z)':20s} "
              f"{'vs ref (z)':18s} {'train min':>9s} {'gain/min':>9s} {'entropy':>8s}")
        for name, runs in groups.items():
            reps = " ".join(f"{paired(run['scores'], start)[0]:+.3f}" for run in runs)
            mean, se = paired(pooled[name], start)
            minutes = st.mean(run["seconds"] for run in runs) / 60
            ref = ""
            if args.ref and args.ref in pooled and name != args.ref:
                rmean, rse = paired(pooled[name], pooled[args.ref])
                ref = fmt_delta(rmean, rse)
            print(f"{name:16s} {len(runs):2d} {reps:28s} {fmt_delta(mean, se):20s} {ref:18s} "
                  f"{minutes:9.1f} {mean / minutes:+9.4f} {st.mean(run['entropy'] for run in runs):8.2f}")


# Learning curves from eval_link<k>.json snapshots of chained runs.
def print_link_curves(args):
    start_path = os.path.join(args.out, "eval_start.json")
    if not os.path.exists(start_path):
        return
    start = json.load(open(start_path))["scores"]
    points = {}
    for run_dir in sorted(glob.glob(os.path.join(args.out, "*_r*"))):
        name = os.path.basename(run_dir).rsplit("_r", 1)[0]
        timing_path = os.path.join(run_dir, "timing.json")
        if not os.path.exists(timing_path):
            continue
        timing = json.load(open(timing_path))["timing"]
        for path in glob.glob(os.path.join(run_dir, "eval_link*.json")):
            link = int(re.findall(r"eval_link(\d+)\.json$", path)[0])
            seconds = sum(item["seconds"] for item in timing if item["link"] < link)
            points.setdefault((name, link), []).append({"scores": json.load(open(path))["scores"], "seconds": seconds})
    if not points:
        return
    print(f"\n== learning curves (canonical, +{args.link_overhead_min:.1f} min production overhead per link) ==")
    print(f"{'variant':16s} {'link':>4s} {'n':>2s} {'pooled delta (z)':20s} {'train min':>9s} {'prod min':>8s} {'gain/prod min':>13s}")
    for (name, link) in sorted(points):
        runs = points[(name, link)]
        pooled = [st.mean(v) for v in zip(*[run["scores"] for run in runs])]
        mean, se = paired(pooled, start)
        train_min = st.mean(run["seconds"] for run in runs) / 60
        prod_min = train_min + link * args.link_overhead_min
        print(f"{name:16s} {link:4d} {len(runs):2d} {fmt_delta(mean, se):20s} {train_min:9.1f} {prod_min:8.1f} {mean / prod_min:+13.4f}")


if __name__ == "__main__":
    main()
