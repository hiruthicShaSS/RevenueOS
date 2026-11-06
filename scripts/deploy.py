#!/usr/bin/env python3
"""Deploy RevenueOS to the home server.

Builds the Docker image locally (the server should not run heavy builds), streams it to the
server over ssh, uploads deploy/docker-compose.yml and deploy/restart.py to ~/services/revenueos,
creates the server .env if it does not exist yet, and restarts the stack.

  python scripts/deploy.py                 build, ship, restart
  python scripts/deploy.py --seed-memory   also load the demo history into Hindsight (first deploy)
  python scripts/deploy.py --new-env       rebuild the server .env from server/.env (keeps POSTGRES_PASSWORD)
  python scripts/deploy.py --skip-build    reuse the image already built locally

The server .env is the source of truth once created; this script never overwrites it unless --new-env.
"""

import argparse
import os
import secrets
import subprocess
import sys
import tempfile
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
IMAGE = "revenueos/app:latest"

# Keys copied from the local server/.env into the production .env.
COPIED_KEYS = ["LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL", "LLM_FALLBACK_MODEL", "HINDSIGHT_BASE_URL", "HINDSIGHT_API_KEY"]


def run(cmd: list[str], **kw) -> subprocess.CompletedProcess:
    print("$", " ".join(cmd))
    return subprocess.run(cmd, check=True, **kw)


def ssh(host: str, command: str, capture: bool = False) -> str:
    r = subprocess.run(["ssh", host, command], check=True, capture_output=capture, text=True)
    return r.stdout if capture else ""


def parse_env(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.exists():
        return out
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip()
    return out


def build_env(existing_remote: dict[str, str]) -> str:
    local = parse_env(ROOT / "server" / ".env")
    missing = [k for k in ("LLM_API_KEY", "HINDSIGHT_API_KEY") if not local.get(k)]
    if missing:
        sys.exit(f"error: {', '.join(missing)} missing from server/.env")
    lines = []
    for line in (ROOT / "deploy" / ".env.example").read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            k, v = line.split("=", 1)
            if k == "POSTGRES_PASSWORD":
                v = existing_remote.get(k) or secrets.token_urlsafe(24)
            elif k in COPIED_KEYS and local.get(k):
                v = local[k]
            elif k in existing_remote:
                v = existing_remote[k]
            line = f"{k}={v}"
        lines.append(line)
    return "\n".join(lines) + "\n"


def ship_image(host: str) -> None:
    print(f"Streaming {IMAGE} to {host} ...")
    save = subprocess.Popen(["docker", "save", IMAGE], stdout=subprocess.PIPE)
    load = subprocess.Popen(["ssh", host, "gunzip | docker load"], stdin=subprocess.PIPE)
    gz = zlib.compressobj(6, zlib.DEFLATED, 31)
    assert save.stdout and load.stdin
    sent = 0
    while chunk := save.stdout.read(1 << 20):
        data = gz.compress(chunk)
        load.stdin.write(data)
        sent += len(data)
    load.stdin.write(gz.flush())
    load.stdin.close()
    if save.wait() != 0 or load.wait() != 0:
        sys.exit("error: shipping the image failed")
    print(f"  sent {sent / 1e6:.0f} MB compressed")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="hosted-apps@maadu")
    ap.add_argument("--dir", default="services/revenueos", help="directory on the server, relative to ~")
    ap.add_argument("--skip-build", action="store_true")
    ap.add_argument("--new-env", action="store_true")
    ap.add_argument("--seed-memory", action="store_true")
    a = ap.parse_args()

    if not a.skip_build:
        run(["docker", "build", "-t", IMAGE, "."], cwd=ROOT)
    ship_image(a.host)

    ssh(a.host, f"mkdir -p ~/{a.dir}")
    run(["scp", str(ROOT / "deploy" / "docker-compose.yml"), str(ROOT / "deploy" / "restart.py"), f"{a.host}:{a.dir}/"])

    has_env = ssh(a.host, f"test -f ~/{a.dir}/.env && echo yes || echo no", capture=True).strip() == "yes"
    if not has_env or a.new_env:
        remote = parse_env_text(ssh(a.host, f"cat ~/{a.dir}/.env", capture=True)) if has_env else {}
        fd, tmp = tempfile.mkstemp(suffix=".env")
        try:
            with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
                f.write(build_env(remote))
            run(["scp", tmp, f"{a.host}:{a.dir}/.env"])
            ssh(a.host, f"chmod 600 ~/{a.dir}/.env")
        finally:
            os.remove(tmp)
        print("Server .env written (secrets copied from server/.env, not printed).")
    else:
        print("Server .env exists; leaving it unchanged.")

    ssh(a.host, f"cd ~/{a.dir} && python3 restart.py" + (" --seed-memory" if a.seed_memory else ""))
    print("Done.")


def parse_env_text(text: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for line in text.splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip()
    return out


if __name__ == "__main__":
    main()
