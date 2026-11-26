import os
import subprocess
import sys


def get_project_root():
    return os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def venv_python(venv_dir):
    if os.name == "nt":
        return os.path.join(venv_dir, "Scripts", "python.exe")
    return os.path.join(venv_dir, "bin", "python")


def ensure_venv(venv_dir):
    if os.path.isdir(venv_dir):
        return
    subprocess.check_call([sys.executable, "-m", "venv", venv_dir])


# Pinned versions: training is deterministic for a given torch build, so every machine that should
# reproduce a run (or join its replicates) needs the same versions.
PINNED_PACKAGES = {"torch": "2.10.0", "numpy": "2.4.3"}


def get_mismatched_packages(python_bin, pinned):
    check_code = (
        "import importlib.metadata as md, sys, json\n"
        "pins = json.loads(sys.argv[1])\n"
        "out = []\n"
        "for name, version in pins.items():\n"
        "    try:\n"
        "        if md.version(name) != version: out.append(name)\n"
        "    except md.PackageNotFoundError:\n"
        "        out.append(name)\n"
        "print('\\n'.join(out))\n"
    )
    import json
    output = subprocess.check_output([python_bin, "-c", check_code, json.dumps(pinned)], text=True).strip()
    return [line.strip() for line in output.splitlines() if line.strip()]


def ensure_packages(python_bin, pinned):
    mismatched = get_mismatched_packages(python_bin, pinned)
    if not mismatched:
        print("ai:bootstrap: dependencies already installed at the pinned versions")
        return
    subprocess.check_call([python_bin, "-m", "pip", "install", "-U", "pip", "setuptools", "wheel"])
    subprocess.check_call([python_bin, "-m", "pip", "install", *[f"{name}=={pinned[name]}" for name in mismatched]])


def main():
    project_root = get_project_root()
    venv_dir = os.path.join(project_root, ".venv")
    ensure_venv(venv_dir)
    python_bin = venv_python(venv_dir)
    ensure_packages(python_bin, PINNED_PACKAGES)


if __name__ == "__main__":
    main()
