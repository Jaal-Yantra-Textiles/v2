"""
Staggered, resumable orchestrator: crawl one state per worker, starting a new
state every --gap seconds, up to --parallel at once. Survives restarts (skips
states already marked complete).

  python orchestrate.py --gap 7200 --parallel 1 --states-file states.txt

--gap 7200 --parallel 1  → one state every 2h, sequential.
--gap 1800 --parallel 4  → a new state every 30m, 4 concurrent.

A state is 'complete' when its crawl_state.py exits 0 (checkpoint fully drained).
Politeness: more --parallel = more simultaneous load on the portal; keep it low.
"""

import subprocess
import sys
import time
from pathlib import Path

import typer

cli = typer.Typer()
HERE = Path(__file__).resolve().parent
STATUS = HERE.parent / "data" / "live" / "_orchestrator_status.json"


@cli.command()
def run(
    gap: float = typer.Option(7200, "--gap", help="seconds between starting states"),
    parallel: int = typer.Option(1, "--parallel", help="max concurrent state workers"),
    delay: float = typer.Option(0.3, "--delay", help="per-request politeness delay"),
    states_file: Path = typer.Option(HERE / "states.txt", "--states-file"),
):
    import json
    states = [s.strip().upper() for s in states_file.read_text().splitlines() if s.strip() and not s.startswith("#")]
    STATUS.parent.mkdir(parents=True, exist_ok=True)
    status = json.loads(STATUS.read_text()) if STATUS.exists() else {}

    pending = [s for s in states if status.get(s) != "done"]
    typer.echo(f"orchestrator: {len(pending)}/{len(states)} states pending (gap={gap}s parallel={parallel})")

    running: dict[str, subprocess.Popen] = {}
    while pending or running:
        # reap finished
        for st, proc in list(running.items()):
            if proc.poll() is not None:
                status[st] = "done" if proc.returncode == 0 else f"error:{proc.returncode}"
                STATUS.write_text(json.dumps(status, indent=0))
                typer.echo(f"  {st} finished → {status[st]}")
                del running[st]
        # launch if slot + gap allows
        if pending and len(running) < parallel:
            st = pending.pop(0)
            log = STATUS.parent / f"{st}.log"
            typer.echo(f"  launching {st} (log: {log})")
            running[st] = subprocess.Popen(
                [sys.executable, str(HERE / "crawl_state.py"), st, "--delay", str(delay)],
                stdout=log.open("a"), stderr=subprocess.STDOUT,
            )
            status[st] = "running"
            STATUS.write_text(json.dumps(status, indent=0))
            if pending:
                time.sleep(gap)   # stagger the next start
        else:
            time.sleep(30)        # wait for a slot to free
    typer.echo("orchestrator: all states complete")


if __name__ == "__main__":
    cli()
