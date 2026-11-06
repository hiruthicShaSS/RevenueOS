#!/usr/bin/env python3
"""(Re)start the RevenueOS stack. Runs on the server, from ~/services/revenueos.

  python3 restart.py               start / update the stack
  python3 restart.py --seed-memory load the demo accounts' history and playbook into Hindsight (once)
"""

import shutil
import subprocess
import sys
from pathlib import Path

COMPOSE_FILE = "docker-compose.yml"


def find_compose_command() -> list[str]:
    if shutil.which("docker"):
        if subprocess.run(["docker", "compose", "version"], capture_output=True).returncode == 0:
            return ["docker", "compose"]
    if shutil.which("docker-compose"):
        return ["docker-compose"]
    sys.exit("error: docker compose (or docker-compose) not found on PATH")


def main() -> None:
    root = Path(__file__).resolve().parent
    for name in (COMPOSE_FILE, ".env"):
        if not (root / name).exists():
            sys.exit(f"error: {name} not found in {root}")
    compose = [*find_compose_command(), "-f", COMPOSE_FILE]

    if "--seed-memory" in sys.argv:
        print("Seeding Hindsight memory for the demo accounts...")
        subprocess.run([*compose, "up", "-d", "--wait", "db"], cwd=root, check=True)
        subprocess.run(
            [*compose, "run", "--rm", "--no-deps", "app", "node", "--import", "tsx", "src/index.ts", "--seed-memory"],
            cwd=root,
            check=True,
        )

    print("Starting RevenueOS...")
    subprocess.run([*compose, "up", "-d", "--remove-orphans"], cwd=root, check=True)
    subprocess.run([*compose, "ps"], cwd=root, check=True)


if __name__ == "__main__":
    main()
