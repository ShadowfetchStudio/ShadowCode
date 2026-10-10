#!/usr/bin/env python3
"""Exercise the installed host bridge, including cancellation with a deadline."""
import argparse
import json
import os
from pathlib import Path
import select
import signal
import subprocess
import time


def alive(pid):
    try:
        state = Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()[0]
        return state != "Z"
    except FileNotFoundError:
        return False


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("app_id")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    command = ["flatpak", "run", "--command=/app/libexec/shadowcode-host", args.app_id]
    evidence = []
    completed = subprocess.run(command + ["/bin/sh", "-c", 'read value; printf "%s:%s\\n" "$1" "$value"; exit 7', "test", "quoted ' $ spaces"], input="stdin value\n", capture_output=True, text=True, timeout=10)
    assert completed.returncode == 7, completed
    assert completed.stdout == "quoted ' $ spaces:stdin value\n", completed
    evidence.append({"case": "arguments, stdin, stdout, exit status", "passed": True})
    for detached, stop_signal in ((False, signal.SIGTERM), (True, signal.SIGTERM), (True, signal.SIGHUP), (True, signal.SIGINT), (True, signal.SIGKILL)):
        shell = "setsid sleep 60 &" if detached else "sleep 60 &"
        shell = "trap '' TERM; " + shell + ' printf "%s %s\\n" "$$" "$!"; wait'
        process = subprocess.Popen(command + ["/bin/sh", "-c", shell], stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
        pids = []
        try:
            assert select.select([process.stdout], [], [], 10)[0], "Host command did not start"
            line = process.stdout.readline().decode().strip()
            pids = [int(value) for value in line.split()]
            assert len(pids) == 2 and all(alive(pid) for pid in pids), line
            start = time.monotonic()
            os.killpg(process.pid, stop_signal)
            deadline = start + 3
            while time.monotonic() < deadline and any(alive(pid) for pid in pids):
                time.sleep(0.025)
            stopped = not any(alive(pid) for pid in pids)
            elapsed = time.monotonic() - start
            evidence.append({"case": "cancel detached child" if detached else "cancel child ignoring TERM", "signal": stop_signal.name, "pids": pids, "elapsed_seconds": elapsed, "passed": stopped})
            assert stopped, f"Host command still alive after 3 seconds: {pids}"
            process.communicate(timeout=3)
        finally:
            for pid in pids:
                if alive(pid):
                    os.kill(pid, signal.SIGKILL)
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGKILL)
                process.communicate(timeout=3)
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(json.dumps({"app_id": args.app_id, "results": evidence}, indent=2) + "\n")
    completed = subprocess.run(command + ["/bin/sh", "-c", 'setsid sleep 60 & printf "%s\\n" "$!"; exit 0'], capture_output=True, text=True, timeout=5)
    pid = int(completed.stdout.strip())
    assert completed.returncode == 0 and not alive(pid), "Background child survived natural exit"
    evidence.append({"case": "natural exit cleans detached background child", "pid": pid, "passed": True})
    args.output.write_text(json.dumps({"app_id": args.app_id, "results": evidence}, indent=2) + "\n")
    print(json.dumps(evidence, indent=2))


if __name__ == "__main__":
    main()
