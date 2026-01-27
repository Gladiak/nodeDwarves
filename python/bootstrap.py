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


def get_missing_packages(python_bin, packages):
    if not packages:
        return []
    check_code = (
        "import importlib.util, sys\n"
        "missing = [name for name in sys.argv[1:] "
        "if importlib.util.find_spec(name) is None]\n"
        "print('\\n'.join(missing))\n"
    )
    output = subprocess.check_output(
        [python_bin, "-c", check_code, *packages],
        text=True,
    ).strip()
    if not output:
        return []
    return [line.strip() for line in output.splitlines() if line.strip()]


def ensure_packages(python_bin, packages):
    missing = get_missing_packages(python_bin, packages)
    if not missing:
        print("ai:bootstrap: dependencies already installed")
        return
    subprocess.check_call([python_bin, "-m", "pip", "install", "-U", "pip", "setuptools", "wheel"])
    subprocess.check_call([python_bin, "-m", "pip", "install", "-U", *missing])


def main():
    project_root = get_project_root()
    venv_dir = os.path.join(project_root, ".venv")
    ensure_venv(venv_dir)
    python_bin = venv_python(venv_dir)
    ensure_packages(python_bin, ["torch", "numpy"])


if __name__ == "__main__":
    main()
